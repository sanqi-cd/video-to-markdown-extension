import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/errors/app-error'
import {
  CaptureSession,
  CHUNK_RETRY_POLICY,
  isRetryableTranscriptionError,
  type CaptureSessionDeps,
  type RecorderLike,
} from '../../src/transcription/capture-session'
import type {
  TabTranscriptionEvent,
  TranscriptionConfig,
  TranscriptionResult,
} from '../../src/transcription/contracts'
import type { VideoMetadata } from '../../src/core/contracts'

const config: TranscriptionConfig = {
  version: 1,
  endpoint: 'https://speech.example.com/v1/audio/transcriptions',
  apiKey: 'secret-key',
  model: 'whisper-1',
  language: 'auto',
  chunkSeconds: 10,
}

const metadata = { platform: 'bilibili', videoId: 'BV1', title: 'demo' } as unknown as VideoMetadata

class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive'
  readonly mimeType = 'audio/webm'
  session: CaptureSession | null = null

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    // MediaRecorder delivers the final data and the stop event asynchronously.
    queueMicrotask(() => {
      this.session?.handleData(new Blob(['audio']))
      void this.session?.handleRecorderStopped()
    })
  }
}

function result(text: string, startMs = 0, endMs = 1_000): TranscriptionResult {
  return { text, language: 'zh', segments: [{ startMs, endMs, text }] }
}

function setup(transcribe: CaptureSessionDeps['transcribe']) {
  const recorder = new FakeRecorder()
  const events: TabTranscriptionEvent[] = []
  const releaseMedia = vi.fn()
  const onClosed = vi.fn()
  const sleep = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const transcribeMock = vi.fn(transcribe)
  const session = new CaptureSession(
    { taskId: 'task-1', config, recorder, releaseMedia },
    {
      transcribe: transcribeMock,
      emit: async (event) => { events.push(event) },
      onClosed,
      now: () => Date.now(),
      sleep,
    },
  )
  recorder.session = session
  const ofType = <T extends TabTranscriptionEvent['type']>(type: T) =>
    events.filter((event): event is Extract<TabTranscriptionEvent, { type: T }> => event.type === type)
  return { session, recorder, events, ofType, releaseMedia, onClosed, sleep, transcribe: transcribeMock }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CaptureSession', () => {
  it('emits only new cues per chunk and the full list on completion', async () => {
    let call = 0
    const s = setup(async () => {
      call += 1
      return result(`第${call}段`)
    })

    await s.session.start(metadata)
    expect(s.ofType('started')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    s.session.stop(true)
    await vi.runAllTimersAsync()

    const progress = s.ofType('progress')
    expect(progress.map((event) => event.newCues.map((cue) => cue.text))).toEqual([
      ['第1段'],
      ['第2段'],
    ])
    expect(progress[1]!.newCues[0]!.startMs).toBe(10_000)

    const [completed] = s.ofType('completed')
    expect(completed?.cues.map((cue) => cue.text)).toEqual(['第1段', '第2段'])
    expect(completed?.stoppedEarly).toBe(true)
    expect(completed?.language).toBe('zh')
    expect(s.releaseMedia).toHaveBeenCalledTimes(1)
    expect(s.onClosed).toHaveBeenCalledTimes(1)
  })

  it('retries a transient chunk failure and keeps going', async () => {
    const s = setup(vi.fn<CaptureSessionDeps['transcribe']>()
      .mockRejectedValueOnce(new AppError('TRANSCRIPTION_FAILED', 'HTTP 503', { retryable: true }))
      .mockResolvedValue(result('恢复')))

    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(5_000)
    s.session.stop(false)
    await vi.runAllTimersAsync()

    expect(s.sleep).toHaveBeenCalledWith(CHUNK_RETRY_POLICY.baseDelayMs, expect.any(AbortSignal))
    expect(s.ofType('failed')).toHaveLength(0)
    expect(s.ofType('completed')[0]?.cues.map((cue) => cue.text)).toEqual(['恢复', '恢复'])
  })

  it('honours Retry-After and caps the delay', async () => {
    const s = setup(vi.fn<CaptureSessionDeps['transcribe']>()
      .mockRejectedValueOnce(new AppError('TRANSCRIPTION_FAILED', '429', {
        retryable: true,
        retryAfterMs: 60_000,
      }))
      .mockResolvedValue(result('ok')))

    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(1_000)
    s.session.stop(false)
    await vi.runAllTimersAsync()

    expect(s.sleep).toHaveBeenCalledWith(CHUNK_RETRY_POLICY.maxDelayMs, expect.any(AbortSignal))
  })

  it('fails after exhausting retries and preserves earlier cues', async () => {
    const transient = new AppError('TRANSCRIPTION_FAILED', '网络错误', { retryable: true })
    const s = setup(vi.fn<CaptureSessionDeps['transcribe']>()
      .mockResolvedValueOnce(result('第一段'))
      .mockRejectedValue(transient))

    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(s.transcribe).toHaveBeenCalledTimes(1 + CHUNK_RETRY_POLICY.maxAttempts)
    const [failed] = s.ofType('failed')
    expect(failed?.cues.map((cue) => cue.text)).toEqual(['第一段'])
    expect(s.ofType('completed')).toHaveLength(0)
    expect(s.releaseMedia).toHaveBeenCalledTimes(1)
    expect(s.onClosed).toHaveBeenCalledTimes(1)
    expect(s.recorder.state).toBe('inactive')
  })

  it('does not retry non-transient errors and redacts the API key', async () => {
    const s = setup(async () => {
      throw new AppError('INVALID_TRANSCRIPTION_CONFIG', 'bad key secret-key')
    })

    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(s.transcribe).toHaveBeenCalledTimes(1)
    expect(s.sleep).not.toHaveBeenCalled()
    const [failed] = s.ofType('failed')
    expect(failed?.error.code).toBe('INVALID_TRANSCRIPTION_CONFIG')
    expect(failed?.error.message).not.toContain('secret-key')
  })

  it('wraps unknown errors as transcription failures', async () => {
    const s = setup(async () => {
      throw new Error('boom')
    })

    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(1_000)
    s.session.stop(false)
    await vi.runAllTimersAsync()

    expect(s.ofType('failed')[0]?.error).toEqual({ code: 'TRANSCRIPTION_FAILED', message: 'boom' })
  })

  it('emits capturing heartbeats while recording and stops them after finishing', async () => {
    const s = setup(async () => result('x'))
    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(3_000)

    const heartbeats = s.ofType('capturing')
    expect(heartbeats).toHaveLength(3)
    expect(heartbeats.at(-1)?.recordedMs).toBe(3_000)

    s.session.stop(true)
    await vi.runAllTimersAsync()
    const count = s.ofType('capturing').length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(s.ofType('capturing')).toHaveLength(count)
  })

  it('finishes directly when stopped while the recorder is idle', async () => {
    const s = setup(async () => result('x'))
    s.session.stop(true)
    await vi.runAllTimersAsync()

    expect(s.ofType('completed')).toEqual([expect.objectContaining({
      cues: [],
      language: 'unknown',
      stoppedEarly: true,
    })])
    s.session.stop(false)
    await vi.runAllTimersAsync()
    expect(s.ofType('completed')).toHaveLength(1)
  })

  it('discards chunks that are too short to contain speech', async () => {
    const s = setup(async () => result('x'))
    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(100)
    s.session.stop(false)
    await vi.runAllTimersAsync()

    expect(s.transcribe).not.toHaveBeenCalled()
    expect(s.ofType('completed')[0]?.cues).toEqual([])
  })

  it('dispose releases resources without emitting events', async () => {
    const s = setup(async () => result('x'))
    await s.session.start(metadata)
    const before = s.events.length
    s.session.dispose()
    await vi.runAllTimersAsync()

    expect(s.events).toHaveLength(before)
    expect(s.releaseMedia).toHaveBeenCalledTimes(1)
    expect(s.onClosed).toHaveBeenCalledTimes(1)
    expect(s.session.isStopping).toBe(true)
  })

  it('aborts an in-flight request when the session fails', async () => {
    let seenSignal: AbortSignal | undefined
    const s = setup((_blob, _config, _ms, signal) => {
      seenSignal = signal
      return new Promise(() => undefined)
    })
    await s.session.start(metadata)
    await vi.advanceTimersByTimeAsync(10_000)
    await s.session.fail(new Error('recorder error'))

    expect(seenSignal?.aborted).toBe(true)
    expect(s.ofType('failed')).toHaveLength(1)
  })
})

describe('isRetryableTranscriptionError', () => {
  it('only accepts AppErrors flagged as retryable', () => {
    expect(isRetryableTranscriptionError(new AppError('TRANSCRIPTION_FAILED', 'x', { retryable: true }))).toBe(true)
    expect(isRetryableTranscriptionError(new AppError('TRANSCRIPTION_FAILED', 'x'))).toBe(false)
    expect(isRetryableTranscriptionError(new Error('x'))).toBe(false)
  })
})
