import { AppError, type ErrorCode } from '../errors/app-error'
import type { ModelConfig } from './config-store'
import { parseSSEStream } from './sse-parser'
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from '../core/contracts'

const STATUS_ERROR_MAP: Partial<Record<number, ErrorCode>> = {
  401: 'MODEL_AUTH_FAILED',
  403: 'MODEL_AUTH_FAILED',
  429: 'MODEL_RATE_LIMITED',
  413: 'MODEL_CONTEXT_EXCEEDED',
}

const STREAM_UNSUPPORTED_STATUSES = new Set([400, 404, 405, 415, 422, 501])

export type StreamCallbacks = {
  onConnected: () => void
  onDelta: (text: string, receivedChars: number) => void
}

export interface StreamingModelProvider extends ModelProvider {
  completeStream(
    request: ModelRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<ModelResponse>
}

type OpenRequest = {
  response: Response
  timeoutController: AbortController
  timeoutMs: number
  cleanup: () => void
}

class StreamUnsupportedError extends Error {
  constructor(readonly status: number) {
    super(`stream unsupported (${status})`)
    this.name = 'StreamUnsupportedError'
  }
}

export class OpenAICompatibleProvider implements StreamingModelProvider {
  private readonly config: ModelConfig
  private readonly fetchImpl: typeof fetch

  constructor(
    config: ModelConfig,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    await this.sendRequest(
      [{ role: 'user', content: 'ping' }],
      signal,
      { timeoutMs: 15_000, maxTokens: 16 },
    )
  }

  async complete(
    request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    return this.sendRequest(request.messages, signal)
  }

  async completeStream(
    request: ModelRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    if (this.config.streamMode === 'off') {
      return this.sendRequest(request.messages, signal, { onConnected: callbacks.onConnected })
    }

    try {
      return await this.sendStreamRequest(request.messages, callbacks, signal)
    } catch (error) {
      if (error instanceof StreamUnsupportedError) {
        if (this.config.streamMode === 'auto') {
          return this.sendRequest(request.messages, signal, { onConnected: callbacks.onConnected })
        }
        throw new AppError(
          'NETWORK_FAILED',
          `当前服务不支持流式响应 (${error.status})，请将流式模式设为“自动”或“关闭”`,
        )
      }
      throw error
    }
  }

  private async sendRequest(
    messages: ModelRequest['messages'],
    signal?: AbortSignal,
    options: {
      timeoutMs?: number
      maxTokens?: number
      onConnected?: () => void
    } = {},
  ): Promise<ModelResponse> {
    const opened = await this.openRequest(messages, signal, {
      timeoutMs: options.timeoutMs,
      maxTokens: options.maxTokens,
      stream: false,
    })
    try {
      this.assertResponseOk(opened.response)
      options.onConnected?.()
      let body: unknown
      try {
        body = await opened.response.json()
      } catch (error) {
        this.throwIfAborted(error, opened, signal)
        throw new AppError(
          'MODEL_RESPONSE_INVALID',
          '模型返回格式异常，请检查 Base URL 是否指向正确的 API 地址',
        )
      }

      const content = extractContent(body)
      if (content === null) {
        throw new AppError('MODEL_RESPONSE_INVALID', '模型返回数据不完整，请检查模型名称是否正确')
      }
      return { content }
    } finally {
      opened.cleanup()
    }
  }

  private async sendStreamRequest(
    messages: ModelRequest['messages'],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    const opened = await this.openRequest(messages, signal, { stream: true })
    try {
      if (!opened.response.ok && STREAM_UNSUPPORTED_STATUSES.has(opened.response.status)) {
        throw new StreamUnsupportedError(opened.response.status)
      }
      this.assertResponseOk(opened.response)
      callbacks.onConnected()

      const contentType = opened.response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream')) {
        let body: unknown
        try {
          body = await opened.response.json()
        } catch (error) {
          this.throwIfAborted(error, opened, signal)
          throw new AppError('MODEL_RESPONSE_INVALID', '模型没有返回有效的流式或 JSON 响应')
        }
        const content = extractContent(body)
        if (content === null) {
          throw new AppError('MODEL_RESPONSE_INVALID', '模型返回数据不完整，请检查模型名称是否正确')
        }
        return { content }
      }

      if (!opened.response.body) {
        throw new AppError('MODEL_RESPONSE_INVALID', '模型返回了空的流式响应')
      }

      let content = ''
      let receivedChars = 0
      try {
        for await (const data of parseSSEStream(opened.response.body, signal)) {
          if (data === '[DONE]') break
          const delta = extractDelta(data)
          if (delta.length === 0) continue
          content += delta
          receivedChars += delta.length
          callbacks.onDelta(delta, receivedChars)
        }
      } catch (error) {
        this.throwIfAborted(error, opened, signal)
        if (error instanceof AppError) throw error
        throw new AppError('NETWORK_FAILED', '模型流连接中断，未验证内容已丢弃')
      }

      if (content.length === 0) {
        throw new AppError('MODEL_RESPONSE_INVALID', '模型流未返回正文内容')
      }
      return { content }
    } finally {
      opened.cleanup()
    }
  }

  private async openRequest(
    messages: ModelRequest['messages'],
    signal: AbortSignal | undefined,
    options: { timeoutMs?: number; maxTokens?: number; stream: boolean },
  ): Promise<OpenRequest> {
    if (signal?.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')

    const timeoutMs = options.timeoutMs ?? 90_000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
    const combined = signal
      ? combineSignals(signal, timeoutController.signal)
      : { signal: timeoutController.signal, cleanup: () => {} }
    const cleanup = () => {
      clearTimeout(timeoutId)
      combined.cleanup()
    }

    try {
      const response = await this.fetchImpl(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: 0,
            stream: options.stream,
            ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
          }),
          signal: combined.signal,
        },
      )
      return { response, timeoutController, timeoutMs, cleanup }
    } catch (error) {
      cleanup()
      this.throwFetchError(error, timeoutController, signal, timeoutMs)
    }
  }

  private assertResponseOk(response: Response): void {
    if (response.ok) return
    const code: ErrorCode = STATUS_ERROR_MAP[response.status] ?? 'NETWORK_FAILED'
    throw new AppError(code, this.statusMessage(response.status))
  }

  private throwIfAborted(
    error: unknown,
    opened: OpenRequest,
    signal?: AbortSignal,
  ): void {
    if ((error instanceof DOMException && error.name === 'AbortError')
      || opened.timeoutController.signal.aborted
      || signal?.aborted) {
      this.throwFetchError(error, opened.timeoutController, signal, opened.timeoutMs)
    }
  }

  private throwFetchError(
    _error: unknown,
    timeoutController: AbortController,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): never {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new AppError(
        'NETWORK_FAILED',
        `请求超时（${Math.round(timeoutMs / 1000)} 秒），请检查 Base URL 和网络连接`,
      )
    }
    if (signal?.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')
    throw new AppError('NETWORK_FAILED', '网络请求失败，请检查 Base URL 和网络连接')
  }

  private statusMessage(status: number): string {
    switch (status) {
      case 401:
      case 403:
        return '认证失败，请检查 API Key'
      case 429:
        return '请求频率过高，请稍后重试'
      case 413:
        return '输入内容超出模型上下文窗口'
      default:
        return `服务端错误 (${status})`
    }
  }
}

interface ChoiceMessage {
  message?: { content?: string }
}

function combineSignals(a: AbortSignal, b: AbortSignal): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  if (a.aborted || b.aborted) controller.abort()
  return {
    signal: controller.signal,
    cleanup: () => {
      a.removeEventListener('abort', onAbort)
      b.removeEventListener('abort', onAbort)
    },
  }
}

function hasChoices(body: unknown): body is { choices: ChoiceMessage[] } {
  return typeof body === 'object'
    && body !== null
    && 'choices' in body
    && Array.isArray((body as Record<string, unknown>).choices)
}

function extractContent(body: unknown): string | null {
  if (!hasChoices(body) || body.choices.length === 0) return null
  const content = body.choices[0]?.message?.content
  return typeof content === 'string' ? content : null
}

function extractDelta(data: string): string {
  let body: unknown
  try {
    body = JSON.parse(data)
  } catch {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型流事件格式异常')
  }
  if (typeof body !== 'object' || body === null) return ''
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const delta = choices[0]?.delta?.content
  return typeof delta === 'string' ? delta : ''
}
