import { AppError, type PublicAppError, redactSecrets } from '../errors/app-error'
import { normalizeCues } from '../processors/normalize'
import { buildParagraphs } from '../processors/paragraphs'
import { processHighFidelity } from '../processors/high-fidelity'
import { processRefined } from '../processors/refined'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'
import type {
  SubtitleAdapter,
  ModelProvider,
  VideoMetadata,
} from './contracts'

export type ProcessedChunk = {
  id: string
  content: unknown
}

export type ProcessedDocument = {
  metadata: VideoMetadata
  mode: 'high-fidelity' | 'refined'
  content: TranslatedParagraph[] | RefinedDocument
}

export type StartRequest = {
  trackId: string
  mode: 'high-fidelity' | 'refined'
  sourceLanguage: string
  includeTimestamps: boolean
}

export type TaskState =
  | { status: 'idle' }
  | { status: 'running'; stage: string; completed: number; total: number; startedAt: number }
  | { status: 'partial'; completedChunks: ProcessedChunk[]; failedChunks: Array<{ id: string; error: PublicAppError }> }
  | { status: 'completed'; document: ProcessedDocument }
  | { status: 'failed'; error: PublicAppError }
  | { status: 'cancelled'; completedChunks: ProcessedChunk[] }

type StateListener = (state: TaskState) => void

const EMPTY_SECRETS: string[] = []

export class TaskOrchestrator {
  private state: TaskState = { status: 'idle' }
  private listeners: StateListener[] = []
  private readonly adapter: SubtitleAdapter
  private readonly provider: ModelProvider
  private controller: AbortController | null = null

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
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  cancel(): void {
    if (this.controller) {
      this.controller.abort()
    }
  }

  async start(request: StartRequest): Promise<void> {
    this.controller = new AbortController()
    const signal = this.controller.signal

    try {
      this.setState({ status: 'running', stage: '准备', completed: 0, total: 1, startedAt: Date.now() })

      // Step 1: Get video metadata
      const metadata = await this.adapter.getVideoMetadata()

      // Step 2: Get subtitle tracks and select the requested one
      const tracks = await this.adapter.getSubtitleTracks()
      const track = tracks.find((t) => t.id === request.trackId)
      if (!track) {
        throw new AppError('SUBTITLE_EXTRACTION_FAILED', '未找到所选字幕轨道')
      }

      // Step 3: Get and normalize cues
      this.setState({ status: 'running', stage: '字幕提取', completed: 0, total: 1, startedAt: Date.now() })
      const rawCues = await this.adapter.getCues(track)
      const cues = normalizeCues(rawCues)

      // Step 4: Build paragraphs
      this.setState({ status: 'running', stage: '段落恢复', completed: 0, total: 1, startedAt: Date.now() })
      const paragraphs = buildParagraphs(cues)

      // Step 5: Process
      let content: TranslatedParagraph[] | RefinedDocument
      if (request.mode === 'high-fidelity') {
        this.setState({ status: 'running', stage: '高保真处理', completed: 0, total: 1, startedAt: Date.now() })
        content = await processHighFidelity(
          paragraphs,
          request.sourceLanguage,
          this.provider,
          () => {},
          signal,
        )
      } else {
        this.setState({ status: 'running', stage: 'AI 精炼', completed: 0, total: 1, startedAt: Date.now() })
        // For refined mode, we need chunks first
        const { chunkParagraphs } = await import('../processors/chunk')
        const chunks = chunkParagraphs(paragraphs, {
          maxInputChars: 8000,
          overlapParagraphs: 1,
        })
        content = await processRefined(chunks, this.provider, () => {}, signal)
      }

      // Done
      this.setState({
        status: 'completed',
        document: { metadata, mode: request.mode, content },
      })
    } catch (error) {
      if (signal.aborted) {
        this.setState({ status: 'cancelled', completedChunks: [] })
        return
      }

      if (error instanceof AppError) {
        this.setState({
          status: 'failed',
          error: error.toJSON(EMPTY_SECRETS),
        })
      } else {
        const message =
          error instanceof Error ? error.message : '未知错误'
        this.setState({
          status: 'failed',
          error: { code: 'NETWORK_FAILED', message },
        })
      }
    }
  }

  private setState(next: TaskState): void {
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch {
        // Swallow listener errors
      }
    }
  }
}
