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

/** Abort when no bytes / progress arrive for this long. */
const DEFAULT_IDLE_TIMEOUT_MS = 90_000
/** Hard cap for a single non-stream completion. */
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000
/** Hard cap for a single streamed completion (idle timeout still applies). */
const DEFAULT_STREAM_ABSOLUTE_TIMEOUT_MS = 600_000

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
  timeout: RequestTimeout
  cleanup: () => void
}

class StreamUnsupportedError extends Error {
  constructor(readonly status: number) {
    super(`stream unsupported (${status})`)
    this.name = 'StreamUnsupportedError'
  }
}

class RequestTimeout {
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private absoluteTimer: ReturnType<typeof setTimeout> | null = null
  private readonly controller = new AbortController()
  private cleared = false
  private idleSuspended = false
  private abortReason: 'idle' | 'absolute' | null = null

  constructor(
    private readonly idleMs: number,
    private readonly absoluteMs: number,
  ) {
    this.absoluteTimer = setTimeout(() => this.abort('absolute'), absoluteMs)
    this.bump()
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  get idleMsValue(): number {
    return this.idleMs
  }

  get absoluteMsValue(): number {
    return this.absoluteMs
  }

  get reason(): 'idle' | 'absolute' | null {
    return this.abortReason
  }

  bump(): void {
    if (this.cleared || this.idleSuspended || this.controller.signal.aborted) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.abort('idle'), this.idleMs)
  }

  /** Keep the absolute cap, but do not idle-abort while reading a large body. */
  suspendIdle(): void {
    this.idleSuspended = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  clear(): void {
    this.cleared = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.absoluteTimer) clearTimeout(this.absoluteTimer)
    this.idleTimer = null
    this.absoluteTimer = null
  }

  private abort(reason: 'idle' | 'absolute'): void {
    if (this.controller.signal.aborted) return
    this.abortReason = reason
    this.controller.abort()
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
      { idleTimeoutMs: 15_000, absoluteTimeoutMs: 60_000, maxTokens: 16 },
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
      idleTimeoutMs?: number
      absoluteTimeoutMs?: number
      maxTokens?: number
      onConnected?: () => void
    } = {},
  ): Promise<ModelResponse> {
    const opened = await this.openRequest(messages, signal, {
      idleTimeoutMs: options.idleTimeoutMs,
      absoluteTimeoutMs: options.absoluteTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxTokens: options.maxTokens,
      stream: false,
    })
    try {
      this.assertResponseOk(opened.response)
      options.onConnected?.()
      opened.timeout.suspendIdle()
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
    const opened = await this.openRequest(messages, signal, {
      absoluteTimeoutMs: DEFAULT_STREAM_ABSOLUTE_TIMEOUT_MS,
      stream: true,
    })
    try {
      if (!opened.response.ok && STREAM_UNSUPPORTED_STATUSES.has(opened.response.status)) {
        throw new StreamUnsupportedError(opened.response.status)
      }
      this.assertResponseOk(opened.response)
      opened.timeout.bump()
      callbacks.onConnected()

      const contentType = opened.response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/event-stream')) {
        opened.timeout.suspendIdle()
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
        for await (const data of parseSSEStream(
          opened.response.body,
          signal,
          () => opened.timeout.bump(),
        )) {
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
    options: {
      idleTimeoutMs?: number
      absoluteTimeoutMs?: number
      maxTokens?: number
      stream: boolean
    },
  ): Promise<OpenRequest> {
    if (signal?.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')

    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    const absoluteTimeoutMs = options.absoluteTimeoutMs
      ?? (options.stream ? DEFAULT_STREAM_ABSOLUTE_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS)
    const timeout = new RequestTimeout(idleTimeoutMs, absoluteTimeoutMs)
    const combined = signal
      ? combineSignals(signal, timeout.signal)
      : { signal: timeout.signal, cleanup: () => {} }
    const cleanup = () => {
      timeout.clear()
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
      timeout.bump()
      return { response, timeout, cleanup }
    } catch (error) {
      cleanup()
      this.throwFetchError(error, timeout, signal)
    }
  }

  private assertResponseOk(response: Response): void {
    if (response.ok) return
    const code: ErrorCode = STATUS_ERROR_MAP[response.status] ?? 'NETWORK_FAILED'
    throw new AppError(code, this.statusMessage(response.status), {
      retryAfterMs: code === 'MODEL_RATE_LIMITED'
        ? parseRetryAfterMs(response.headers.get('retry-after'))
        : undefined,
    })
  }

  private throwIfAborted(
    error: unknown,
    opened: OpenRequest,
    signal?: AbortSignal,
  ): void {
    if ((error instanceof DOMException && error.name === 'AbortError')
      || opened.timeout.signal.aborted
      || signal?.aborted) {
      this.throwFetchError(error, opened.timeout, signal)
    }
  }

  private throwFetchError(
    _error: unknown,
    timeout: RequestTimeout,
    signal: AbortSignal | undefined,
  ): never {
    if (timeout.signal.aborted && !signal?.aborted) {
      if (timeout.reason === 'absolute') {
        throw new AppError(
          'NETWORK_FAILED',
          `请求总时长超过上限（${Math.round(timeout.absoluteMsValue / 1000)} 秒），请减小分块或稍后重试`,
        )
      }
      throw new AppError(
        'NETWORK_FAILED',
        `请求空闲超时（${Math.round(timeout.idleMsValue / 1000)} 秒无响应），请检查 Base URL、网络连接或减小分块大小`,
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

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const trimmed = header.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < 0) return undefined
    return Math.round(seconds * 1000)
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  return Math.max(0, dateMs - Date.now())
}
