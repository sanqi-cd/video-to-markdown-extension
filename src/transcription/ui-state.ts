import type { TabTranscriptionEvent, TranscriptionUiState } from './contracts'

type NonTerminalEvent = Exclude<TabTranscriptionEvent, { type: 'completed' }>

function runningState(taskId: string, recordedMs = 0): Extract<TranscriptionUiState, { status: 'running' }> {
  return {
    status: 'running',
    taskId,
    recordedMs,
    transcribedMs: 0,
    chunkIndex: 0,
    cues: [],
  }
}

/** Applies a live transcription event to the side panel state; `completed` is handled by the caller. */
export function applyTranscriptionEvent(
  state: TranscriptionUiState,
  event: NonTerminalEvent,
): TranscriptionUiState {
  const current = state.status === 'running' && state.taskId === event.taskId ? state : null
  switch (event.type) {
    case 'started':
      return runningState(event.taskId)
    case 'capturing':
      return current
        ? { ...current, recordedMs: event.recordedMs }
        : runningState(event.taskId, event.recordedMs)
    case 'progress':
      return {
        status: 'running',
        taskId: event.taskId,
        recordedMs: event.recordedMs,
        transcribedMs: event.transcribedMs,
        chunkIndex: event.chunkIndex,
        cues: [...(current?.cues ?? []), ...event.newCues],
      }
    case 'failed':
      return { status: 'failed', error: event.error, cues: event.cues }
  }
}

export function isTranscriptionActive(state: TranscriptionUiState): boolean {
  return state.status === 'starting' || state.status === 'running'
}
