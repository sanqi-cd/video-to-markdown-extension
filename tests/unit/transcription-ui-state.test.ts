import { describe, expect, it } from 'vitest'
import { applyTranscriptionEvent, isTranscriptionActive } from '../../src/transcription/ui-state'
import type { TranscriptionUiState } from '../../src/transcription/contracts'
import type { SubtitleCue, VideoMetadata } from '../../src/core/contracts'

const cue = (id: string, text: string): SubtitleCue => ({ id, startMs: 0, endMs: 1_000, text })
const metadata = {} as VideoMetadata

describe('applyTranscriptionEvent', () => {
  it('accumulates incremental cues for the same task', () => {
    let state: TranscriptionUiState = { status: 'starting' }
    state = applyTranscriptionEvent(state, { type: 'started', taskId: 't', metadata })
    state = applyTranscriptionEvent(state, {
      type: 'progress', taskId: 't', recordedMs: 10, transcribedMs: 10, chunkIndex: 1,
      newCues: [cue('a', '一')],
    })
    state = applyTranscriptionEvent(state, {
      type: 'progress', taskId: 't', recordedMs: 20, transcribedMs: 20, chunkIndex: 2,
      newCues: [cue('b', '二')],
    })
    expect(state).toMatchObject({ status: 'running', recordedMs: 20, chunkIndex: 2 })
    expect(state.status === 'running' && state.cues.map((item) => item.text)).toEqual(['一', '二'])
  })

  it('does not carry cues across tasks', () => {
    const previous: TranscriptionUiState = {
      status: 'running', taskId: 'old', recordedMs: 5, transcribedMs: 5, chunkIndex: 1,
      cues: [cue('x', 'old')],
    }
    const next = applyTranscriptionEvent(previous, {
      type: 'progress', taskId: 'new', recordedMs: 1, transcribedMs: 1, chunkIndex: 1,
      newCues: [cue('y', 'new')],
    })
    expect(next.status === 'running' && next.cues.map((item) => item.text)).toEqual(['new'])
  })

  it('updates the recorded time on heartbeats without dropping cues', () => {
    const running: TranscriptionUiState = {
      status: 'running', taskId: 't', recordedMs: 5, transcribedMs: 5, chunkIndex: 1,
      cues: [cue('a', '一')],
    }
    expect(applyTranscriptionEvent(running, { type: 'capturing', taskId: 't', recordedMs: 9 }))
      .toEqual({ ...running, recordedMs: 9 })
    expect(applyTranscriptionEvent({ status: 'starting' }, { type: 'capturing', taskId: 't', recordedMs: 3 }))
      .toMatchObject({ status: 'running', recordedMs: 3, cues: [] })
  })

  it('switches to failed with the preserved cues', () => {
    const error = { code: 'TRANSCRIPTION_FAILED' as const, message: 'x' }
    expect(applyTranscriptionEvent({ status: 'starting' }, {
      type: 'failed', taskId: 't', error, cues: [cue('a', '一')],
    })).toEqual({ status: 'failed', error, cues: [cue('a', '一')] })
  })
})

describe('isTranscriptionActive', () => {
  it('is true only while starting or running', () => {
    expect(isTranscriptionActive({ status: 'starting' })).toBe(true)
    expect(isTranscriptionActive({
      status: 'running', taskId: 't', recordedMs: 0, transcribedMs: 0, chunkIndex: 0, cues: [],
    })).toBe(true)
    expect(isTranscriptionActive({ status: 'idle' })).toBe(false)
    expect(isTranscriptionActive({
      status: 'failed', error: { code: 'TRANSCRIPTION_FAILED', message: 'x' }, cues: [],
    })).toBe(false)
  })
})
