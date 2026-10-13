import { AppError } from '../errors/app-error'
import type { SubtitleCue, VideoMetadata } from '../core/contracts'
import { offsetTranscriptionCues } from './messages'
import type {
  TabTranscriptionEvent,
  TranscriptionConfig,
  TranscriptionResult,
} from './contracts'

export type RecorderLike = {
  readonly state: 'inactive' | 'recording' | 'paused'
  readonly mimeType: string
  start(): void
  stop(): void
}

export type CaptureSessionOptions = {
  taskId: string
  config: TranscriptionConfig
  recorder: RecorderLike
  /** Stops the media tracks and audio graph. Called at most once. */
  releaseMedia: () => void
}

export type CaptureSessionDeps = {
  transcribe: (
    blob: Blob,
    config: TranscriptionConfig,
    durationMs: number,
    signal: AbortSignal,
  ) => Promise<TranscriptionResult>
  emit: (event: TabTranscriptionEvent) => Promise<void>
  /** Called once the session no longer owns the capture, so a new one may start. */
  onClosed?: () => void
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** Chunks shorter than this carry no usable speech and are discarded. */
const MIN_CHUNK_MS = 250
const HEARTBEAT_INTERVAL_MS = 1_000

export const CHUNK_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 15_000,
}

export function isRetryableTranscriptionError(error: unknown): error is AppError {
  return error instanceof AppError && error.retryable
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AppError('TRANSCRIPTION_FAILED', '转录已取消'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new AppError('TRANSCRIPTION_FAILED', '转录已取消'))
    }, { once: true })
  })
}

export class CaptureSession {
  readonly taskId: string
  private readonly config: TranscriptionConfig
  private readonly recorder: RecorderLike
  private readonly releaseMedia: () => void
  private readonly deps: Required<Omit<CaptureSessionDeps, 'onClosed'>>
    & Pick<CaptureSessionDeps, 'onClosed'>
  private readonly abortController = new AbortController()

  private chunkTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private chunkStartedAt = 0
  private capturedMs = 0
  private transcribedMs = 0
  private chunkIndex = 0
  private parts: Blob[] = []
  private readonly cues: SubtitleCue[] = []
  private language: string
  private uploadQueue: Promise<void> = Promise.resolve()
  private finishing = false
  private failed = false
  private stoppedEarly = false
  private released = false
  private closed = false
  private finishPromise: Promise<void> | null = null

  constructor(options: CaptureSessionOptions, deps: CaptureSessionDeps) {
    this.taskId = options.taskId
    this.config = options.config
    this.recorder = options.recorder
    this.releaseMedia = options.releaseMedia
    this.language = options.config.language === 'auto' ? '' : options.config.language
    this.deps = {
      now: () => performance.now(),
      sleep: abortableSleep,
      ...deps,
    }
  }

  get isStopping(): boolean {
    return this.finishing || this.failed
  }

  async start(metadata: VideoMetadata): Promise<void> {
    this.startChunk()
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_INTERVAL_MS)
    await this.deps.emit({ type: 'started', taskId: this.taskId, metadata })
  }

  handleData(blob: Blob): void {
    if (blob.size > 0) this.parts.push(blob)
  }

  async handleRecorderStopped(): Promise<void> {
    this.clearChunkTimer()
    const durationMs = Math.max(0, Math.round(this.deps.now() - this.chunkStartedAt))
    const parts = this.parts
    this.parts = []

    if (!this.failed && parts.length > 0 && durationMs >= MIN_CHUNK_MS) {
      this.enqueueChunk(new Blob(parts, { type: this.recorder.mimeType }), durationMs)
    }
    if (this.failed) return
    if (!this.finishing) {
      this.startChunk()
      return
    }
    await this.finish()
  }

  /** Requests a stop; returns once recording has been asked to stop, not when uploads drain. */
  stop(stoppedEarly: boolean): void {
    if (this.finishing || this.failed) return
    this.finishing = true
    this.stoppedEarly = stoppedEarly
    this.clearChunkTimer()
    if (this.recorder.state === 'inactive') {
      void this.finish()
      return
    }
    this.recorder.stop()
  }

  async fail(cause: unknown): Promise<void> {
    if (this.failed || this.closed) return
    this.failed = true
    this.finishing = true
    this.abortController.abort()
    this.releaseCapture()
    const error = cause instanceof AppError
      ? cause
      : new AppError(
          'TRANSCRIPTION_FAILED',
          cause instanceof Error ? cause.message : '音频转录失败',
          { cause },
        )
    await this.deps.emit({
      type: 'failed',
      taskId: this.taskId,
      error: error.toJSON([this.config.apiKey]),
      cues: [...this.cues],
    })
    this.close()
  }

  /** Releases resources without emitting any event (startup failure). */
  dispose(): void {
    this.failed = true
    this.finishing = true
    this.abortController.abort()
    this.releaseCapture()
    this.close()
  }

  private startChunk(): void {
    if (this.finishing || this.failed) return
    this.parts = []
    this.chunkStartedAt = this.deps.now()
    this.recorder.start()
    this.chunkTimer = setTimeout(() => {
      if (this.recorder.state === 'recording') this.recorder.stop()
    }, this.config.chunkSeconds * 1_000)
  }

  private enqueueChunk(blob: Blob, durationMs: number): void {
    const offsetMs = this.capturedMs
    const chunkIndex = this.chunkIndex
    this.capturedMs += durationMs
    this.chunkIndex += 1
    this.uploadQueue = this.uploadQueue
      .then(async () => {
        if (this.failed) return
        const result = await this.transcribeWithRetry(blob, durationMs)
        if (this.failed) return
        if (result.language) this.language = result.language
        const newCues = offsetTranscriptionCues(this.taskId, chunkIndex, offsetMs, result.segments)
        this.cues.push(...newCues)
        this.transcribedMs += durationMs
        await this.deps.emit({
          type: 'progress',
          taskId: this.taskId,
          recordedMs: this.capturedMs,
          transcribedMs: this.transcribedMs,
          chunkIndex: this.chunkIndex,
          newCues,
        })
      })
      .catch((cause) => this.fail(cause))
  }

  private async transcribeWithRetry(blob: Blob, durationMs: number): Promise<TranscriptionResult> {
    const signal = this.abortController.signal
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.deps.transcribe(blob, this.config, durationMs, signal)
      } catch (error) {
        if (
          this.failed
          || attempt >= CHUNK_RETRY_POLICY.maxAttempts
          || !isRetryableTranscriptionError(error)
        ) throw error
        const backoff = CHUNK_RETRY_POLICY.baseDelayMs * 2 ** (attempt - 1)
        const delay = Math.min(CHUNK_RETRY_POLICY.maxDelayMs, error.retryAfterMs ?? backoff)
        await this.deps.sleep(delay, signal)
      }
    }
  }

  private finish(): Promise<void> {
    this.finishPromise ??= (async () => {
      this.releaseCapture()
      await this.uploadQueue
      if (this.failed || this.closed) return
      await this.deps.emit({
        type: 'completed',
        taskId: this.taskId,
        recordedMs: this.capturedMs,
        cues: [...this.cues],
        language: this.language || 'unknown',
        stoppedEarly: this.stoppedEarly,
      })
      this.close()
    })()
    return this.finishPromise
  }

  private emitHeartbeat(): void {
    if (this.finishing || this.failed) return
    const activeChunkMs = this.recorder.state === 'recording'
      ? Math.max(0, Math.round(this.deps.now() - this.chunkStartedAt))
      : 0
    void this.deps.emit({
      type: 'capturing',
      taskId: this.taskId,
      recordedMs: this.capturedMs + activeChunkMs,
    })
  }

  private clearChunkTimer(): void {
    if (this.chunkTimer !== null) clearTimeout(this.chunkTimer)
    this.chunkTimer = null
  }

  private releaseCapture(): void {
    if (this.released) return
    this.released = true
    this.clearChunkTimer()
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    this.releaseMedia()
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    this.deps.onClosed?.()
  }
}
