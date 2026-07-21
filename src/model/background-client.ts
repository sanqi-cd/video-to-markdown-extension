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
}

const defaultDeps: BackgroundClientDeps = {
  connect: () => chrome.runtime.connect({ name: MODEL_STREAM_PORT }) as unknown as RuntimePortLike,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  randomUUID: () => crypto.randomUUID(),
}

export class BackgroundModelClient implements ModelProvider {
  private readonly deps: BackgroundClientDeps

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

  complete(
    request: ModelRequest,
    signal?: AbortSignal,
    context?: ModelCallContext,
  ): Promise<ModelResponse> {
    if (signal?.aborted) return Promise.reject(new AppError('TASK_CANCELLED', '任务已取消'))

    const taskId = context?.taskId ?? this.deps.randomUUID()
    const requestId = this.deps.randomUUID()
    const port = this.deps.connect()

    return new Promise<ModelResponse>((resolve, reject) => {
      let settled = false
      let receivedDelta = false

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        port.onMessage.removeListener?.(onMessage)
        port.onDisconnect.removeListener?.(onDisconnect)
      }
      const finish = (result: { content: string } | AppError) => {
        if (settled) return
        settled = true
        cleanup()
        port.disconnect()
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
        if (event.taskId !== taskId || event.requestId !== requestId) return
        switch (event.type) {
          case 'STARTED':
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
        if (settled) return
        finish(new AppError(
          'NETWORK_FAILED',
          receivedDelta
            ? '模型流连接中断，未验证内容已丢弃'
            : '模型连接意外断开，请重试',
        ))
      }
      const onAbort = () => {
        const command: StreamCommand = { type: 'CANCEL', taskId, requestId }
        port.postMessage(command)
        finish(new AppError('TASK_CANCELLED', '任务已取消'))
      }

      port.onMessage.addListener(onMessage)
      port.onDisconnect.addListener(onDisconnect)
      signal?.addEventListener('abort', onAbort, { once: true })

      const command: StreamCommand = {
        type: 'START',
        taskId,
        requestId,
        messages: request.messages,
      }
      port.postMessage(command)
    })
  }
}
