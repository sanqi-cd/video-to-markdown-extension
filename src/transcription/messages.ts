import type { SubtitleCue, VideoMetadata } from '../core/contracts'
import type { TranscriptionConfig, TabTranscriptionEvent } from './contracts'

export type StartTabTranscriptionMessage = {
  type: 'TRANSCRIPTION_START_REQUEST'
  taskId: string
  tabId: number
  metadata: VideoMetadata
}

export type StopTabTranscriptionMessage = {
  type: 'TRANSCRIPTION_STOP_REQUEST'
  taskId: string
}

export type OffscreenStartMessage = {
  type: 'TRANSCRIPTION_OFFSCREEN_START'
  target: 'offscreen'
  taskId: string
  streamId: string
  metadata: VideoMetadata
  config: TranscriptionConfig
}

export type OffscreenStopMessage = {
  type: 'TRANSCRIPTION_OFFSCREEN_STOP'
  target: 'offscreen'
  taskId: string
  stoppedEarly: boolean
}

export type OffscreenEventMessage = {
  type: 'TRANSCRIPTION_EVENT'
  event: TabTranscriptionEvent
}

export type PlaybackPrepareMessage = {
  type: 'TRANSCRIPTION_PREPARE_PLAYBACK'
  taskId: string
}

export type PlaybackStopMessage = {
  type: 'TRANSCRIPTION_STOP_PLAYBACK'
  taskId: string
}

export type PlaybackEndedMessage = {
  type: 'TRANSCRIPTION_PLAYBACK_ENDED'
  taskId: string
}

export type TranscriptionRuntimeMessage =
  | StartTabTranscriptionMessage
  | StopTabTranscriptionMessage
  | OffscreenStartMessage
  | OffscreenStopMessage
  | OffscreenEventMessage
  | PlaybackPrepareMessage
  | PlaybackStopMessage
  | PlaybackEndedMessage

export function isTranscriptionRuntimeMessage(
  value: unknown,
): value is TranscriptionRuntimeMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  return typeof (value as { type?: unknown }).type === 'string'
    && (value as { type: string }).type.startsWith('TRANSCRIPTION_')
}

export function offsetTranscriptionCues(
  taskId: string,
  chunkIndex: number,
  offsetMs: number,
  segments: Array<{ startMs: number; endMs: number; text: string }>,
): SubtitleCue[] {
  return segments.map((segment, index) => ({
    id: `asr-${taskId}-${chunkIndex}-${index}`,
    startMs: offsetMs + segment.startMs,
    endMs: offsetMs + segment.endMs,
    text: segment.text,
  }))
}
