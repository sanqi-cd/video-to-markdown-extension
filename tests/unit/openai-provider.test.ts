import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider } from '../../src/model/openai-provider'
import type { ModelConfig } from '../../src/model/config-store'
import type { ModelRequest } from '../../src/core/contracts'

const config: ModelConfig = {
  apiKey: 'sk-test-key-12345',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
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
})
