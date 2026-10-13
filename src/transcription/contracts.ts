import type { SubtitleCue, VideoMetadata } from '../core/contracts'
import type { PublicAppError } from '../errors/app-error'

export type TranscriptionLanguage = 'auto' | 'zh' | 'en'

export type TranscriptionConfig = {
  version: 1
  protocol?: 'openai-transcription' | 'ark-responses'
  endpoint: string
  apiKey: string
  model: string
  language: TranscriptionLanguage
  chunkSeconds: number
}

export type TranscriptionSegment = {
  startMs: number
  endMs: number
  text: string
}

export type TranscriptionResult = {
  text: string
  language?: string
  segments: TranscriptionSegment[]
}

export type TabTranscriptionEvent =
  | {
      type: 'started'
      taskId: string
      metadata: VideoMetadata
    }
  | {
      type: 'progress'
      taskId: string
      recordedMs: number
      transcribedMs: number
      chunkIndex: number
      /** Only the cues produced by this chunk; the final `completed` event carries the full list. */
      newCues: SubtitleCue[]
    }
  | {
      type: 'capturing'
      taskId: string
      recordedMs: number
    }
  | {
      type: 'completed'
      taskId: string
      recordedMs: number
      cues: SubtitleCue[]
      language: string
      stoppedEarly: boolean
    }
  | {
      type: 'failed'
      taskId: string
      error: PublicAppError
      cues: SubtitleCue[]
    }

export type TranscriptionUiState =
  | { status: 'idle' }
  | { status: 'starting' }
  | {
      status: 'running'
      taskId: string
      recordedMs: number
      transcribedMs: number
      chunkIndex: number
      cues: SubtitleCue[]
    }
  | {
      status: 'failed'
      error: PublicAppError
      cues: SubtitleCue[]
    }
