import { AppError, type ErrorCode } from '../errors/app-error'
import type { ModelConfig } from './config-store'
import type { ModelProvider, ModelRequest, ModelResponse } from '../core/contracts'

const STATUS_ERROR_MAP: Partial<Record<number, ErrorCode>> = {
  401: 'MODEL_AUTH_FAILED',
  403: 'MODEL_AUTH_FAILED',
  429: 'MODEL_RATE_LIMITED',
  413: 'MODEL_CONTEXT_EXCEEDED',
}

export class OpenAICompatibleProvider implements ModelProvider {
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
    )
  }

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
    return this.sendRequest(request.messages, signal)
  }

  private async sendRequest(
    messages: ModelRequest['messages'],
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    if (signal?.aborted) {
      throw new AppError('TASK_CANCELLED', '任务已取消')
    }

    // Create a timeout signal merged with the caller's signal
    const timeoutMs = 30_000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
    const mergedSignal = signal
      ? combineSignals(signal, timeoutController.signal)
      : timeoutController.signal

    let response: Response
    try {
      response = await this.fetchImpl(
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
          }),
          signal: mergedSignal,
        },
      )
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (timeoutController.signal.aborted && !signal?.aborted) {
          throw new AppError('NETWORK_FAILED', '请求超时（30 秒），请检查 Base URL 是否正确')
        }
        throw new AppError('TASK_CANCELLED', '任务已取消')
      }
      throw new AppError('NETWORK_FAILED', '网络请求失败，请检查 Base URL 和网络连接')
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const code: ErrorCode =
        STATUS_ERROR_MAP[response.status] ?? 'NETWORK_FAILED'
      throw new AppError(code, this.statusMessage(response.status))
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new AppError('MODEL_RESPONSE_INVALID', '模型返回格式异常，请检查 Base URL 是否指向正确的 API 地址')
    }

    const content = extractContent(body)
    if (content === null) {
      throw new AppError('MODEL_RESPONSE_INVALID', '模型返回数据不完整，请检查模型名称是否正确')
    }

    return { content }
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

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  if (a.aborted || b.aborted) controller.abort()
  return controller.signal
}

function hasChoices(
  body: unknown,
): body is { choices: ChoiceMessage[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'choices' in body &&
    Array.isArray((body as Record<string, unknown>).choices)
  )
}

function extractContent(body: unknown): string | null {
  if (hasChoices(body) && body.choices.length > 0) {
    const choice = body.choices[0]!
    if (
      choice.message &&
      typeof choice.message.content === 'string'
    ) {
      return choice.message.content
    }
  }
  return null
}
