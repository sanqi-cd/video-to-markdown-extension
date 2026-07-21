import type {
  FailedChunk,
  ProcessedChunk,
  TaskEvent,
  TaskMetrics,
  TaskSnapshot,
} from './task-events'

const EMPTY_METRICS: TaskMetrics = {
  cueCount: 0,
  paragraphCount: 0,
  totalChunks: 0,
  completedChunks: 0,
  currentChunkIndex: null,
  receivedChars: 0,
  sourceLanguage: null,
}

export function createTaskSnapshot(): TaskSnapshot {
  return {
    taskId: null,
    status: 'idle',
    mode: null,
    stage: 'idle',
    startedAt: null,
    metrics: { ...EMPTY_METRICS },
    completedChunks: [],
    failedChunks: [],
  }
}

function orderedChunks(chunks: ProcessedChunk[]): ProcessedChunk[] {
  return [...chunks].sort((left, right) => left.index - right.index)
}

function orderedFailures(chunks: FailedChunk[]): FailedChunk[] {
  return [...chunks].sort((left, right) => left.index - right.index)
}

function upsertChunk(
  chunks: ProcessedChunk[],
  next: ProcessedChunk,
): ProcessedChunk[] {
  const existing = chunks.find((chunk) => chunk.id === next.id)
  const merged = existing ? { ...existing, ...next } : next
  return orderedChunks([
    ...chunks.filter((chunk) => chunk.id !== next.id),
    merged,
  ])
}

export function taskReducer(state: TaskSnapshot, event: TaskEvent): TaskSnapshot {
  if (event.type === 'TASK_STARTED') {
    if (state.startedAt !== null && event.startedAt < state.startedAt) return state
    return {
      taskId: event.taskId,
      status: 'running',
      mode: event.mode,
      stage: 'preparing',
      startedAt: event.startedAt,
      metrics: { ...EMPTY_METRICS },
      completedChunks: [],
      failedChunks: [],
    }
  }

  if (state.taskId !== event.taskId) return state

  switch (event.type) {
    case 'SUBTITLE_LOADED':
      return {
        ...state,
        status: 'running',
        stage: 'building-paragraphs',
        metrics: {
          ...state.metrics,
          cueCount: event.cueCount,
          sourceLanguage: event.language,
        },
      }
    case 'PARAGRAPHS_READY':
      return {
        ...state,
        status: 'running',
        stage: state.mode === 'refined'
          ? 'processing-refined-map'
          : 'processing-high-fidelity',
        metrics: {
          ...state.metrics,
          paragraphCount: event.paragraphCount,
          totalChunks: event.chunkCount,
        },
      }
    case 'CHUNK_STARTED':
      return {
        ...state,
        status: 'running',
        stage: state.mode === 'refined'
          ? 'processing-refined-map'
          : 'processing-high-fidelity',
        retry: undefined,
        modelConnectedChunkIndex: undefined,
        failedChunks: state.failedChunks.filter((chunk) => chunk.id !== event.chunkId),
        metrics: {
          ...state.metrics,
          currentChunkIndex: event.chunkIndex,
          totalChunks: event.totalChunks,
          receivedChars: 0,
        },
      }
    case 'MODEL_CONNECTED':
      return { ...state, modelConnectedChunkIndex: event.chunkIndex }
    case 'STREAM_ACTIVITY':
      return {
        ...state,
        metrics: { ...state.metrics, receivedChars: event.receivedChars },
      }
    case 'CONTENT_APPENDED':
      return {
        ...state,
        completedChunks: upsertChunk(state.completedChunks, {
          id: event.chunkId,
          index: event.chunkIndex,
          content: event.content,
        }),
      }
    case 'CHUNK_RETRYING':
      return {
        ...state,
        retry: {
          chunkId: event.chunkId,
          attempt: event.attempt,
          retryAt: event.retryAt,
        },
      }
    case 'CHUNK_COMPLETED': {
      const completedChunks = upsertChunk(state.completedChunks, {
        id: event.chunkId,
        index: event.chunkIndex,
      })
      return {
        ...state,
        retry: undefined,
        completedChunks,
        failedChunks: state.failedChunks.filter((chunk) => chunk.id !== event.chunkId),
        metrics: {
          ...state.metrics,
          completedChunks: completedChunks.filter(
            (chunk) => chunk.index < state.metrics.totalChunks,
          ).length,
        },
      }
    }
    case 'REDUCE_STARTED':
      return {
        ...state,
        status: 'running',
        stage: 'processing-refined-reduce',
        modelConnectedChunkIndex: undefined,
        metrics: {
          ...state.metrics,
          currentChunkIndex: null,
          completedChunks: event.totalInputs,
          receivedChars: 0,
        },
      }
    case 'TASK_PARTIAL':
      return {
        ...state,
        status: 'partial',
        retry: undefined,
        failedChunks: orderedFailures(event.failedChunks),
      }
    case 'TASK_COMPLETED':
      return {
        ...state,
        status: 'completed',
        retry: undefined,
        failedChunks: [],
        document: event.document,
      }
    case 'TASK_FAILED':
      return {
        ...state,
        status: 'failed',
        retry: undefined,
        error: event.error,
      }
    case 'TASK_CANCELLED': {
      const preservedIds = new Set(event.preservedChunkIds)
      return {
        ...state,
        status: 'cancelled',
        retry: undefined,
        completedChunks: state.completedChunks.filter((chunk) => preservedIds.has(chunk.id)),
      }
    }
  }
}
