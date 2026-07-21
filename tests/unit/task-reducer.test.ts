import { describe, expect, it } from 'vitest'
import { createTaskSnapshot, taskReducer } from '../../src/core/task-reducer'
import type { TaskEvent, TaskSnapshot } from '../../src/core/task-events'

function start(taskId = 'task-current'): TaskSnapshot {
  return taskReducer(createTaskSnapshot(), {
    type: 'TASK_STARTED',
    taskId,
    startedAt: 100,
    mode: 'high-fidelity',
  })
}

function reduce(state: TaskSnapshot, ...events: TaskEvent[]): TaskSnapshot {
  return events.reduce(taskReducer, state)
}

describe('taskReducer', () => {
  it('keeps validated content chunks in source order even when events arrive out of order', () => {
    const state = reduce(
      start(),
      {
        type: 'PARAGRAPHS_READY',
        taskId: 'task-current',
        paragraphCount: 2,
        chunkCount: 2,
      },
      {
        type: 'CONTENT_APPENDED',
        taskId: 'task-current',
        chunkId: 'chunk-1',
        chunkIndex: 1,
        content: [{ id: 'p2', startMs: 2, endMs: 3, text: '第二段' }],
      },
      {
        type: 'CONTENT_APPENDED',
        taskId: 'task-current',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        content: [{ id: 'p1', startMs: 0, endMs: 1, text: '第一段' }],
      },
      {
        type: 'CHUNK_COMPLETED',
        taskId: 'task-current',
        chunkId: 'chunk-0',
        chunkIndex: 0,
      },
      {
        type: 'CHUNK_COMPLETED',
        taskId: 'task-current',
        chunkId: 'chunk-1',
        chunkIndex: 1,
      },
    )

    expect(state.completedChunks.map((chunk) => chunk.id)).toEqual(['chunk-0', 'chunk-1'])
    expect(state.metrics.completedChunks).toBe(2)
  })

  it('ignores every non-start event from an old task', () => {
    const current = start('task-new')
    const stale = taskReducer(current, {
      type: 'CONTENT_APPENDED',
      taskId: 'task-old',
      chunkId: 'chunk-9',
      chunkIndex: 9,
      content: ['stale'],
    })

    expect(stale).toBe(current)
    expect(stale.completedChunks).toEqual([])
  })

  it('does not let a delayed older TASK_STARTED replace the active task', () => {
    const current = taskReducer(createTaskSnapshot(), {
      type: 'TASK_STARTED',
      taskId: 'task-new',
      startedAt: 200,
      mode: 'refined',
    })
    const stale = taskReducer(current, {
      type: 'TASK_STARTED',
      taskId: 'task-old',
      startedAt: 100,
      mode: 'high-fidelity',
    })

    expect(stale).toBe(current)
    expect(stale.taskId).toBe('task-new')
  })

  it('tracks completed map chunks without exposing their internal content', () => {
    const refined = taskReducer(createTaskSnapshot(), {
      type: 'TASK_STARTED',
      taskId: 'task-refined',
      startedAt: 100,
      mode: 'refined',
    })
    const state = reduce(
      refined,
      {
        type: 'PARAGRAPHS_READY',
        taskId: 'task-refined',
        paragraphCount: 4,
        chunkCount: 2,
      },
      {
        type: 'CHUNK_COMPLETED',
        taskId: 'task-refined',
        chunkId: 'chunk-0',
        chunkIndex: 0,
      },
    )

    expect(state.completedChunks).toEqual([{ id: 'chunk-0', index: 0 }])
    expect(state.completedChunks[0]?.content).toBeUndefined()
  })

  it('preserves only completed chunks named by cancellation', () => {
    const withContent = reduce(
      start(),
      {
        type: 'CONTENT_APPENDED',
        taskId: 'task-current',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        content: ['keep'],
      },
      {
        type: 'CONTENT_APPENDED',
        taskId: 'task-current',
        chunkId: 'chunk-1',
        chunkIndex: 1,
        content: ['drop'],
      },
    )
    const cancelled = taskReducer(withContent, {
      type: 'TASK_CANCELLED',
      taskId: 'task-current',
      preservedChunkIds: ['chunk-0'],
    })

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.completedChunks.map((chunk) => chunk.id)).toEqual(['chunk-0'])
  })

  it('resets connection activity when a new chunk starts', () => {
    const active = reduce(
      start(),
      { type: 'MODEL_CONNECTED', taskId: 'task-current', chunkIndex: 0 },
      { type: 'STREAM_ACTIVITY', taskId: 'task-current', receivedChars: 120 },
      {
        type: 'CHUNK_STARTED',
        taskId: 'task-current',
        chunkId: 'chunk-1',
        chunkIndex: 1,
        totalChunks: 2,
      },
    )

    expect(active.modelConnectedChunkIndex).toBeUndefined()
    expect(active.metrics.receivedChars).toBe(0)
  })
})
