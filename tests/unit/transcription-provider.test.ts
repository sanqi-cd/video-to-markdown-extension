import { describe, expect, it, vi } from 'vitest'
import { transcribeAudioChunk } from '../../src/transcription/provider'
import type { TranscriptionConfig } from '../../src/transcription/contracts'

const config: TranscriptionConfig = {
  version: 1,
  endpoint: 'https://speech.example.com/v1/audio/transcriptions',
  apiKey: 'secret-key',
  model: 'whisper-1',
  language: 'en',
  chunkSeconds: 30,
}

describe('transcribeAudioChunk', () => {
  it('does not echo server error bodies containing credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('echo secret-key audio-base64', { status: 400 }))
    const error = await transcribeAudioChunk(new Blob(['audio']), config, 30000, fetchImpl).catch((cause: Error) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('secret-key')
    expect((error as Error).message).not.toContain('audio-base64')
  })
  it('keeps the deadline active while waiting for the response body', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ({
        ok: true,
        status: 200,
        text: () => new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      } as Response))
      const pending = transcribeAudioChunk(new Blob(['audio']), config, 30_000, fetchImpl)
      const assertion = expect(pending).rejects.toThrow('超过 2 分钟')
      await vi.advanceTimersByTimeAsync(120_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('requests verbose segment timestamps and maps seconds to milliseconds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello world',
      language: 'english',
      segments: [{ start: 0.25, end: 1.75, text: ' Hello world ' }],
    }), { status: 200 }))

    await expect(transcribeAudioChunk(
      new Blob(['audio'], { type: 'audio/webm' }),
      config,
      30_000,
      fetchImpl,
    )).resolves.toEqual({
      text: 'Hello world',
      language: 'english',
      segments: [{ startMs: 250, endMs: 1750, text: 'Hello world' }],
    })
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    const body = init.body as FormData
    expect(body.get('model')).toBe('whisper-1')
    expect(body.get('language')).toBe('en')
    expect(body.get('response_format')).toBe('verbose_json')
  })

  it('accepts a successful silent chunk', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: '',
      language: 'english',
      segments: [],
    }), { status: 200 }))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, fetchImpl))
      .resolves.toEqual({ text: '', language: 'english', segments: [] })
  })

  it('maps authentication failures to an actionable config error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('invalid key', { status: 401 }))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, fetchImpl))
      .rejects.toMatchObject({ code: 'INVALID_TRANSCRIPTION_CONFIG', retryable: false })
  })

  it('marks server errors and rate limits as retryable with Retry-After', async () => {
    const serverError = vi.fn().mockResolvedValue(new Response('down', { status: 503 }))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, serverError))
      .rejects.toMatchObject({ retryable: true, retryAfterMs: undefined })

    const limited = vi.fn().mockResolvedValue(new Response('slow down', {
      status: 429,
      headers: { 'Retry-After': '7' },
    }))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, limited))
      .rejects.toMatchObject({ retryable: true, retryAfterMs: 7_000 })
  })

  it('treats network failures as retryable but caller aborts and client errors as final', async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, offline))
      .rejects.toMatchObject({ retryable: true })

    const controller = new AbortController()
    const aborted = vi.fn(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, aborted, controller.signal))
      .rejects.toMatchObject({ retryable: false })

    const badRequest = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }))
    await expect(transcribeAudioChunk(new Blob(['audio']), config, 30_000, badRequest))
      .rejects.toMatchObject({ retryable: false })
  })
})
