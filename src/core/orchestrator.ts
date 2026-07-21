import { AppError, type PublicAppError } from '../errors/app-error'
import { normalizeCues } from '../processors/normalize'
import { buildParagraphs, type SubtitleParagraph } from '../processors/paragraphs'
import { chunkParagraphs, type ParagraphChunk } from '../processors/chunk'
import { processHighFidelity, type TranslatedParagraph } from '../processors/high-fidelity'
import {
  processRefinedMapChunk,
  reduceRefinedMapResults,
  type MapResult,
} from '../processors/refined'
import { withRetry } from '../model/retry'
import { createTaskSnapshot, taskReducer } from './task-reducer'
import type {
  FailedChunk,
  ProcessedDocument,
  TaskEvent,
  TaskSnapshot,
} from './task-events'
import type {
  ModelCallContext,
  SubtitleAdapter,
  ModelProvider,
  VideoMetadata,
} from './contracts'
import type { OutputLanguage } from './language'

export type {
  FailedChunk,
  ProcessedChunk,
  ProcessedDocument,
  TaskEvent,
  TaskMetrics,
  TaskMode,
  TaskSnapshot,
  TaskStage,
} from './task-events'

export type TaskState = TaskSnapshot

export type StartRequest = {
  trackId: string
  mode: 'high-fidelity' | 'refined'
  sourceLanguage: string
  outputLanguage?: OutputLanguage
  includeTimestamps: boolean
  maxInputChars?: number
}

type ResolvedStartRequest = StartRequest & { outputLanguage: OutputLanguage }

type StateListener = (state: TaskState) => void
type EventListener = (event: TaskEvent) => void

type TaskSession = {
  taskId: string
  metadata: VideoMetadata
  request: ResolvedStartRequest
  paragraphs: SubtitleParagraph[]
  chunks: ParagraphChunk[]
  completed: Map<string, TranslatedParagraph[] | MapResult>
  failed: Map<string, PublicAppError>
  incrementalChunks: Set<string>
  startedAt: number
}

const RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
}

export class TaskOrchestrator {
  private state: TaskState = createTaskSnapshot()
  private listeners: StateListener[] = []
  private eventListeners: EventListener[] = []
  private readonly adapter: SubtitleAdapter
  private readonly provider: ModelProvider
  private controller: AbortController | null = null
  private session: TaskSession | null = null

  constructor(adapter: SubtitleAdapter, provider: ModelProvider) {
    this.adapter = adapter
    this.provider = provider
  }

  getState(): TaskState {
    return this.state
  }

  onStateChange(fn: StateListener): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== fn)
    }
  }

  onEvent(fn: EventListener): () => void {
    this.eventListeners.push(fn)
    return () => {
      this.eventListeners = this.eventListeners.filter((listener) => listener !== fn)
    }
  }

  cancel(): void {
    this.controller?.abort()
  }

  async start(request: StartRequest): Promise<void> {
    this.controller?.abort()
    this.controller = new AbortController()
    const signal = this.controller.signal
    const taskId = crypto.randomUUID()
    const startedAt = Date.now()
    let session: TaskSession | null = null
    this.session = null
    this.dispatch({ type: 'TASK_STARTED', taskId, startedAt, mode: request.mode })

    try {
      const metadata = await this.adapter.getVideoMetadata()
      this.throwIfAborted(signal)
      const tracks = await this.adapter.getSubtitleTracks()
      this.throwIfAborted(signal)
      const track = tracks.find((item) => item.id === request.trackId)
      if (!track) {
        throw new AppError('SUBTITLE_EXTRACTION_FAILED', '未找到所选字幕轨道')
      }

      const rawCues = await this.adapter.getCues(track)
      this.throwIfAborted(signal)
      const cues = normalizeCues(rawCues)
      if (cues.length === 0) {
        throw new AppError(
          'SUBTITLE_EXTRACTION_FAILED',
          '字幕轨道没有可提取的文字内容，请切换字幕或刷新页面后重试',
        )
      }
      this.dispatch({
        type: 'SUBTITLE_LOADED',
        taskId,
        cueCount: cues.length,
        language: track.language,
      })

      const paragraphs = buildParagraphs(cues)
      const chunks = chunkParagraphs(paragraphs, {
        maxInputChars: request.maxInputChars ?? 8_000,
        overlapParagraphs: request.mode === 'refined' ? 1 : 0,
      })
      this.dispatch({
        type: 'PARAGRAPHS_READY',
        taskId,
        paragraphCount: paragraphs.length,
        chunkCount: chunks.length,
      })

      session = {
        taskId,
        metadata,
        request: {
          ...request,
          outputLanguage: request.outputLanguage ?? 'zh',
        },
        paragraphs,
        chunks,
        completed: new Map(),
        failed: new Map(),
        incrementalChunks: new Set(),
        startedAt,
      }
      this.session = session
      await this.processSession(session, signal)
    } catch (error) {
      this.handleTerminalError(error, signal, taskId, session)
    }
  }

  async retryFailed(): Promise<void> {
    if (!this.session || this.state.status !== 'partial') return
    this.controller = new AbortController()
    const signal = this.controller.signal
    const session = this.session
    session.failed.clear()
    try {
      await this.processSession(session, signal)
    } catch (error) {
      this.handleTerminalError(error, signal, session.taskId, session)
    }
  }

  private async processSession(session: TaskSession, signal: AbortSignal): Promise<void> {
    const pendingChunks = session.chunks.filter((chunk) => !session.completed.has(chunk.id))

    for (const chunk of pendingChunks) {
      this.throwIfAborted(signal)
      const chunkIndex = session.chunks.findIndex((item) => item.id === chunk.id)
      this.dispatch({
        type: 'CHUNK_STARTED',
        taskId: session.taskId,
        chunkId: chunk.id,
        chunkIndex,
        totalChunks: session.chunks.length,
      })
      try {
        const content = await withRetry(
          () => {
            session.incrementalChunks.delete(chunk.id)
            return this.processChunk(session, chunk, signal)
          },
          RETRY_POLICY,
          (ms) => this.sleep(ms, signal),
          ({ nextAttempt, delayMs }) => {
            this.dispatch({
              type: 'CHUNK_RETRYING',
              taskId: session.taskId,
              chunkId: chunk.id,
              chunkIndex,
              attempt: nextAttempt,
              retryAt: Date.now() + delayMs,
            })
          },
        )
        this.throwIfAborted(signal)
        session.completed.set(chunk.id, content)
        session.failed.delete(chunk.id)
        if (
          session.request.mode === 'refined'
          || !session.incrementalChunks.has(chunk.id)
        ) {
          this.dispatch({
            type: 'CONTENT_APPENDED',
            taskId: session.taskId,
            chunkId: chunk.id,
            chunkIndex,
            content,
          })
        }
        this.dispatch({
          type: 'CHUNK_COMPLETED',
          taskId: session.taskId,
          chunkId: chunk.id,
          chunkIndex,
        })
      } catch (error) {
        this.throwIfAborted(signal)
        session.failed.set(chunk.id, this.toPublicError(error))
      }
    }

    if (session.failed.size > 0) {
      this.setPartial(session)
      return
    }

    if (session.request.mode === 'high-fidelity') {
      const content = session.chunks.flatMap(
        (chunk) => session.completed.get(chunk.id) as TranslatedParagraph[],
      )
      this.dispatch({
        type: 'TASK_COMPLETED',
        taskId: session.taskId,
        document: this.buildDocument(session, content),
      })
      return
    }

    this.dispatch({
      type: 'REDUCE_STARTED',
      taskId: session.taskId,
      totalInputs: session.chunks.length,
    })
    try {
      const mapResults = session.chunks.map(
        (chunk) => session.completed.get(chunk.id) as MapResult,
      )
      const content = await withRetry(
        () => {
          session.incrementalChunks.delete('reduce')
          return reduceRefinedMapResults(
            mapResults,
            session.paragraphs.map((paragraph) => paragraph.id),
            this.provider,
            signal,
            this.modelContext(session, session.chunks.length, 'reduce'),
            session.request.outputLanguage,
          )
        },
        RETRY_POLICY,
        (ms) => this.sleep(ms, signal),
        ({ nextAttempt, delayMs }) => {
          this.dispatch({
            type: 'CHUNK_RETRYING',
            taskId: session.taskId,
            chunkId: 'reduce',
            chunkIndex: session.chunks.length,
            attempt: nextAttempt,
            retryAt: Date.now() + delayMs,
          })
        },
      )
      this.throwIfAborted(signal)
      session.failed.delete('reduce')
      if (!session.incrementalChunks.has('reduce')) {
        this.dispatch({
          type: 'CONTENT_APPENDED',
          taskId: session.taskId,
          chunkId: 'reduce',
          chunkIndex: session.chunks.length,
          content,
        })
      }
      const document = this.buildDocument(session, content)
      this.dispatch({ type: 'TASK_COMPLETED', taskId: session.taskId, document })
    } catch (error) {
      this.throwIfAborted(signal)
      session.failed.set('reduce', this.toPublicError(error))
      this.setPartial(session)
    }
  }

  private processChunk(
    session: TaskSession,
    chunk: ParagraphChunk,
    signal: AbortSignal,
  ): Promise<TranslatedParagraph[] | MapResult> {
    if (session.request.mode === 'high-fidelity') {
      return processHighFidelity(
        chunk.paragraphs,
        session.request.sourceLanguage,
        this.provider,
        undefined,
        signal,
        this.modelContext(
          session,
          session.chunks.findIndex((item) => item.id === chunk.id),
          chunk.id,
        ),
        session.request.outputLanguage,
      )
    }
    return processRefinedMapChunk(
      chunk,
      this.provider,
      signal,
      this.modelContext(session, session.chunks.findIndex((item) => item.id === chunk.id)),
      session.request.outputLanguage,
    )
  }

  private modelContext(
    session: TaskSession,
    chunkIndex: number,
    visibleChunkId?: string,
  ): ModelCallContext {
    return {
      taskId: session.taskId,
      chunkIndex,
      onActivity: (activity) => {
        if (activity.type === 'connected') {
          this.dispatch({
            type: 'MODEL_CONNECTED',
            taskId: session.taskId,
            chunkIndex,
          })
          return
        }
        this.dispatch({
          type: 'STREAM_ACTIVITY',
          taskId: session.taskId,
          receivedChars: activity.receivedChars,
        })
      },
      ...(visibleChunkId
        ? {
            onValidatedContent: (content: unknown) => {
              session.incrementalChunks.add(visibleChunkId)
              this.dispatch({
                type: 'CONTENT_APPENDED',
                taskId: session.taskId,
                chunkId: visibleChunkId,
                chunkIndex,
                content: content as ProcessedDocument['content'],
              })
            },
          }
        : {}),
    }
  }

  private buildDocument(
    session: TaskSession,
    content: ProcessedDocument['content'],
  ): ProcessedDocument {
    return {
      metadata: session.metadata,
      mode: session.request.mode,
      outputLanguage: session.request.outputLanguage,
      content,
      generatedAt: Date.now(),
      paragraphTimestamps: this.paragraphTimestamps(session.paragraphs),
    }
  }

  private setPartial(session: TaskSession): void {
    const failedChunks: FailedChunk[] = [...session.failed].map(([id, error]) => ({
      id,
      index: id === 'reduce'
        ? session.chunks.length
        : session.chunks.findIndex((chunk) => chunk.id === id),
      error,
    }))
    this.dispatch({
      type: 'TASK_PARTIAL',
      taskId: session.taskId,
      failedChunks,
    })
  }

  private paragraphTimestamps(paragraphs: SubtitleParagraph[]): Record<string, number> {
    return Object.fromEntries(paragraphs.map((paragraph) => [paragraph.id, paragraph.startMs]))
  }

  private handleTerminalError(
    error: unknown,
    signal: AbortSignal,
    taskId: string,
    session: TaskSession | null,
  ): void {
    if (signal.aborted) {
      this.dispatch({
        type: 'TASK_CANCELLED',
        taskId,
        preservedChunkIds: session ? [...session.completed.keys()] : [],
      })
      return
    }
    this.dispatch({ type: 'TASK_FAILED', taskId, error: this.toPublicError(error) })
  }

  private toPublicError(error: unknown): PublicAppError {
    if (error instanceof AppError) return error.toJSON()
    return {
      code: 'NETWORK_FAILED',
      message: error instanceof Error ? error.message : '未知错误',
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new AppError('TASK_CANCELLED', '任务已取消')
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new AppError('TASK_CANCELLED', '任务已取消'))
      }, { once: true })
    })
  }

  private dispatch(event: TaskEvent): void {
    const next = taskReducer(this.state, event)
    if (next === this.state) return
    this.state = next
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch {
        // A diagnostic event listener must never terminate the processing task.
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch {
        // A UI listener must never terminate the processing task.
      }
    }
  }
}
