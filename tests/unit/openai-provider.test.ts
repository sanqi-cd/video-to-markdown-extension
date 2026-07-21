import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/model/openai-provider'
import type { ModelConfig } from '../../src/model/config-store'
import type { ModelRequest } from '../../src/core/contracts'

const config: ModelConfig = {
  version: 2,
  providerId: 'custom',
  apiKey: 'sk-test-key-12345',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
  streamMode: 'auto',
}

const request: ModelRequest = {
  messages: [
    { role: 'system', content: 'You are a translator.' },
    { role: 'user', content: 'Hello world' },
  ],
  responseFormat: 'json',
}

function mockResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })
}

describe('OpenAICompatibleProvider', () => {
  it('posts chat completions to the correct endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await provider.complete(request)

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('returns parsed content from a valid response', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    const result = await provider.complete(request)
    expect(result).toEqual({ content: '{"ok":true}' })
  })

  it('sends the API key in the Authorization header', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ choices: [{ message: { content: 'ok' } }] }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await provider.complete(request)

    const init = fetcher.mock.calls[0]![1] as RequestInit
    expect(init.headers).toBeDefined()
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test-key-12345')
  })

  it.each([
    [401, 'MODEL_AUTH_FAILED'],
    [429, 'MODEL_RATE_LIMITED'],
    [413, 'MODEL_CONTEXT_EXCEEDED'],
  ])('maps HTTP %s to error code %s', async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse({}, status))
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await expect(provider.complete(request)).rejects.toMatchObject({ code })
  })

  it('maps a 5xx error to NETWORK_FAILED', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse({}, 502))
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await expect(provider.complete(request)).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    })
  })

  it('maps a network error to NETWORK_FAILED', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await expect(provider.complete(request)).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    })
  })

  it('maps invalid JSON in response to MODEL_RESPONSE_INVALID', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await expect(provider.complete(request)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('does not expose the API key in error messages', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse({}, 401))
    const provider = new OpenAICompatibleProvider(config, fetcher)

    let message = ''
    try {
      await provider.complete(request)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain('sk-test-key-12345')
  })

  it('calls test connection with a minimal ping message', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ choices: [{ message: { content: 'pong' } }] }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await provider.testConnection()

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.max_tokens).toBe(16)
  })

  it('times out connection tests after 15 seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>(
        (_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        },
      ))
      const provider = new OpenAICompatibleProvider(config, fetcher as typeof fetch)
      const result = expect(provider.testConnection()).rejects.toThrow('请求超时（15 秒）')

      await vi.advanceTimersByTimeAsync(15_000)
      await result
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the request when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new OpenAICompatibleProvider(config, vi.fn())
    await expect(provider.complete(request, controller.signal)).rejects.toMatchObject({
      code: 'TASK_CANCELLED',
    })
  })

  it('rejects empty choices response', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockResponse({ choices: [] }))
    const provider = new OpenAICompatibleProvider(config, fetcher)
    await expect(provider.complete(request)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('parses OpenAI SSE deltas and reports cumulative activity', async () => {
    const fetcher = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]))
    const provider = new OpenAICompatibleProvider(config, fetcher)
    const onConnected = vi.fn()
    const onDelta = vi.fn()

    const result = await provider.completeStream(request, { onConnected, onDelta })

    expect(result).toEqual({ content: '你好' })
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenNthCalledWith(1, '你', 1)
    expect(onDelta).toHaveBeenNthCalledWith(2, '好', 2)
    const body = JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.stream).toBe(true)
  })

  it('accepts a non-SSE JSON response without exposing unvalidated deltas', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockResponse({ choices: [{ message: { content: '{"ok":true}' } }] }),
    )
    const provider = new OpenAICompatibleProvider(config, fetcher)
    const onDelta = vi.fn()

    await expect(provider.completeStream(request, {
      onConnected: vi.fn(),
      onDelta,
    })).resolves.toEqual({ content: '{"ok":true}' })
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('falls back to a non-stream request before receiving any delta in auto mode', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockResponse({}, 400))
      .mockResolvedValueOnce(mockResponse({ choices: [{ message: { content: 'fallback' } }] }))
    const provider = new OpenAICompatibleProvider(config, fetcher)

    await expect(provider.completeStream(request, {
      onConnected: vi.fn(),
      onDelta: vi.fn(),
    })).resolves.toEqual({ content: 'fallback' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const fallbackBody = JSON.parse((fetcher.mock.calls[1]![1] as RequestInit).body as string)
    expect(fallbackBody.stream).toBe(false)
  })

  it('does not fall back after an SSE stream has emitted a delta and then disconnects', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        ))
        controller.error(new Error('connection lost'))
      },
    }), { headers: { 'content-type': 'text/event-stream' } })
    const fetcher = vi.fn().mockResolvedValue(response)
    const provider = new OpenAICompatibleProvider(config, fetcher)
    const onDelta = vi.fn()

    await expect(provider.completeStream(request, {
      onConnected: vi.fn(),
      onDelta,
    })).rejects.toMatchObject({ code: 'NETWORK_FAILED' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
