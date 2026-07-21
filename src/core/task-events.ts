import type { PublicAppError } from '../errors/app-error'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'
import type { VideoMetadata } from './contracts'
import type { OutputLanguage } from './language'

export type TaskMode = 'high-fidelity' | 'refined'

export type TaskStage =
  | 'idle'
  | 'preparing'
  | 'loading-subtitles'
  | 'building-paragraphs'
  | 'processing-high-fidelity'
  | 'processing-refined-map'
  | 'processing-refined-reduce'

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  idle: '等待开始',
  preparing: '准备视频信息',
  'loading-subtitles': '提取字幕',
  'building-paragraphs': '恢复自然段落',
  'processing-high-fidelity': '高保真处理',
  'processing-refined-map': 'AI 理解内容',
  'processing-refined-reduce': 'AI 精炼汇总',
}

export type ProcessedChunk = {
  id: string
  index: number
  /** 仅保存已经通过校验、允许展示的领域对象。 */
  content?: unknown
}

export type FailedChunk = {
  id: string
  index: number
  error: PublicAppError
}

export type ProcessedDocument = {
  metadata: VideoMetadata
  mode: TaskMode
  outputLanguage?: OutputLanguage
  content: TranslatedParagraph[] | RefinedDocument
  /** 文档首次形成时的固定时间，保证预览、复制和下载内容一致。 */
  generatedAt: number
  partial?: {
    incompleteChunkCount: number
  }
  paragraphTimestamps?: Record<string, number>
}

export type TaskMetrics = {
  cueCount: number
  paragraphCount: number
  totalChunks: number
  completedChunks: number
  currentChunkIndex: number | null
  receivedChars: number
  sourceLanguage: string | null
}

type TaskSnapshotBase = {
  taskId: string | null
  status: 'idle' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled'
  mode: TaskMode | null
  stage: TaskStage
  startedAt: number | null
  metrics: TaskMetrics
  completedChunks: ProcessedChunk[]
  failedChunks: FailedChunk[]
  retry?: { chunkId: string; attempt: number; retryAt: number }
  modelConnectedChunkIndex?: number
}

export type TaskSnapshot =
  | (TaskSnapshotBase & { status: 'idle' })
  | (TaskSnapshotBase & { status: 'running' })
  | (TaskSnapshotBase & { status: 'partial' })
  | (TaskSnapshotBase & { status: 'completed'; document: ProcessedDocument })
  | (TaskSnapshotBase & { status: 'failed'; error: PublicAppError })
  | (TaskSnapshotBase & { status: 'cancelled' })

type TaskEventBase = { taskId: string }

export type TaskEvent =
  | (TaskEventBase & {
      type: 'TASK_STARTED'
      startedAt: number
      mode: TaskMode
    })
  | (TaskEventBase & {
      type: 'SUBTITLE_LOADED'
      cueCount: number
      language: string
    })
  | (TaskEventBase & {
      type: 'PARAGRAPHS_READY'
      paragraphCount: number
      chunkCount: number
    })
  | (TaskEventBase & {
      type: 'CHUNK_STARTED'
      chunkId: string
      chunkIndex: number
      totalChunks: number
    })
  | (TaskEventBase & {
      type: 'MODEL_CONNECTED'
      chunkIndex: number
    })
  | (TaskEventBase & {
      type: 'STREAM_ACTIVITY'
      receivedChars: number
    })
  | (TaskEventBase & {
      type: 'CONTENT_APPENDED'
      chunkId: string
      chunkIndex: number
      content: unknown
    })
  | (TaskEventBase & {
      type: 'CHUNK_RETRYING'
      chunkId: string
      chunkIndex: number
      attempt: number
      retryAt: number
    })
  | (TaskEventBase & {
      type: 'CHUNK_COMPLETED'
      chunkId: string
      chunkIndex: number
    })
  | (TaskEventBase & {
      type: 'REDUCE_STARTED'
      totalInputs: number
    })
  | (TaskEventBase & {
      type: 'TASK_PARTIAL'
      failedChunks: FailedChunk[]
    })
  | (TaskEventBase & {
      type: 'TASK_COMPLETED'
      document: ProcessedDocument
    })
  | (TaskEventBase & {
      type: 'TASK_FAILED'
      error: PublicAppError
    })
  | (TaskEventBase & {
      type: 'TASK_CANCELLED'
      preservedChunkIds: string[]
    })

export function taskStageLabel(stage: TaskStage): string {
  return TASK_STAGE_LABELS[stage]
}
