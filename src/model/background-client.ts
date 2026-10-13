import { AppError, isErrorCode } from '../errors/app-error'
import type {
  ModelCallContext,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from '../core/contracts'
import {
  MODEL_STREAM_PORT,
  parseStreamEvent,
  type RuntimePortLike,
  type StreamCommand,
} from './stream-port'

type BackgroundClientDeps = {
  connect: () => RuntimePortLike
  sendMessage: (message: unknown) => Promise<unknown>
  randomUUID: () => string
  runtimeLastError?: () => string | undefined
}

const defaultDeps: BackgroundClientDeps = {
  connect: () => chrome.runtime.connect({ name: MODEL_STREAM_PORT }) as unknown as RuntimePortLike,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  randomUUID: () => crypto.randomUUID(),
  runtimeLastError: () => chrome.runtime.lastError?.message,
}

const PING_INTERVAL_MS = 15_000

export class BackgroundModelClient implements ModelProvider {
  private readonly deps: BackgroundClientDeps
  private port: RuntimePortLike | null = null

  constructor(deps: Partial<BackgroundClientDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  async testConnection(): Promise<void> {
    const response = await this.deps.sendMessage({ type: 'MODEL_TEST_REQUEST' }) as {
      success?: boolean
      error?: string
      code?: string
    } | undefined
    if (!response?.success) {
      throw new AppError(
        isErrorCode(response?.code) ? response.code : 'NETWORK_FAILED',
        response?.error ?? '连接测试失败',
      )
    }
  }

  async complete(
    request: ModelRequest,
    signal?: AbortSignal,
    context?: ModelCallContext,
  ): Promise<ModelResponse> {
    if (signal?.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')

    try {
      return await this.completeViaPort(request, signal, context)
    } catch (error) {
      if (!isRecoverablePortFailure(error) || signal?.aborted) throw error
      return this.completeViaMessage(request, signal, context)
    }
  }

  private completeViaPort(
    request: ModelRequest,
    signal: AbortSignal | undefined,
    context: ModelCallContext | undefined,
  ): Promise<ModelResponse> {
    const taskId = context?.taskId ?? this.deps.randomUUID()
    const requestId = this.deps.randomUUID()
    const port = this.ensurePort()

    return new Promise<ModelResponse>((resolve, reject) => {
      let settled = false
      let receivedStarted = false
      let receivedDelta = false
      let pingTimer: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (pingTimer) clearInterval(pingTimer)
        signal?.removeEventListener('abort', onAbort)
        port.onMessage.removeListener?.(onMessage)
        port.onDisconnect.removeListener?.(onDisconnect)
      }
      const finish = (result: { content: string } | AppError) => {
        if (settled) return
        settled = true
        cleanup()
        if (result instanceof AppError) reject(result)
        else resolve(result)
      }
      const onMessage = (raw: unknown) => {
        let event
        try {
          event = parseStreamEvent(raw)
        } catch {
          return
        }
        if (event.type === 'PONG') return
        if (event.taskId !== taskId || event.requestId !== requestId) return
        switch (event.type) {
          case 'STARTED':
            receivedStarted = true
            break
          case 'CONNECTED':
            context?.onActivity?.({ type: 'connected' })
            break
          case 'DELTA':
            receivedDelta = true
            context?.onActivity?.({
              type: 'delta',
              text: event.text,
              receivedChars: event.receivedChars,
            })
            break
          case 'DONE':
            finish({ content: event.content })
            break
          case 'ERROR':
            finish(new AppError(event.error.code, event.error.message))
            break
        }
      }
      const onDisconnect = () => {
        this.port = null
        if (settled) return
        const lastError = this.deps.runtimeLastError?.()
        if (receivedDelta) {
          finish(new AppError('NETWORK_FAILED', '模型流连接中断，未验证内容已丢弃'))
          return
        }
        if (!receivedStarted) {
          finish(new AppError(
            'NETWORK_FAILED',
            lastError
              ? `模型连接意外断开：${lastError}`
              : '模型连接意外断开。后台脚本可能被浏览器回收，请保持侧边栏打开后重试',
          ))
          return
        }
        finish(new AppError(
          'NETWORK_FAILED',
          '等待模型首包时连接中断。请检查网络、模型服务或稍后重试',
        ))
      }
      const onAbort = () => {
        const command: StreamCommand = { type: 'CANCEL', taskId, requestId }
        try {
          port.postMessage(command)
        } catch {
          // Port may already be gone.
        }
        finish(new AppError('TASK_CANCELLED', '任务已取消'))
      }

      port.onMessage.addListener(onMessage)
      port.onDisconnect.addListener(onDisconnect)
      signal?.addEventListener('abort', onAbort, { once: true })
      pingTimer = setInterval(() => {
        try {
          port.postMessage({ type: 'PING' } satisfies StreamCommand)
        } catch {
          // The disconnect handler will settle the request.
        }
      }, PING_INTERVAL_MS)

      const command: StreamCommand = {
        type: 'START',
        taskId,
        requestId,
        messages: request.messages,
      }
      try {
        port.postMessage(command)
        const postError = this.deps.runtimeLastError?.()
        if (postError) {
          finish(new AppError('NETWORK_FAILED', `模型连接意外断开：${postError}`))
        }
      } catch (error) {
        finish(new AppError(
          'NETWORK_FAILED',
          error instanceof Error ? error.message : '无法向后台发送模型请求',
        ))
      }
    })
  }

  private async completeViaMessage(
    request: ModelRequest,
    signal: AbortSignal | undefined,
    context: ModelCallContext | undefined,
  ): Promise<ModelResponse> {
    if (signal?.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')
    const requestId = this.deps.randomUUID()
    const onAbort = () => {
      void this.deps.sendMessage({ type: 'MODEL_CANCEL_REQUEST', requestId })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      context?.onActivity?.({ type: 'connected' })
      const response = await this.deps.sendMessage({
        type: 'MODEL_COMPLETE_REQUEST',
        requestId,
        messages: request.messages,
      }) as {
        success?: boolean
        data?: { content?: string }
        error?: string
        code?: string
      } | undefined
      if (!response?.success || typeof response.data?.content !== 'string') {
        throw new AppError(
          isErrorCode(response?.code) ? response.code : 'NETWORK_FAILED',
          response?.error ?? '模型请求失败，请重试',
        )
      }
      return { content: response.data.content }
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private ensurePort(): RuntimePortLike {
    if (this.port) return this.port
    const port = this.deps.connect()
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null
    })
    this.port = port
    return port
  }
}

function isRecoverablePortFailure(error: unknown): boolean {
  return error instanceof AppError
    && error.code === 'NETWORK_FAILED'
    && (
      error.message.includes('意外断开')
      || error.message.includes('无法向后台发送')
    )
}
