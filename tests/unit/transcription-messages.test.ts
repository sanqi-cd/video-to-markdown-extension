import { describe, expect, it } from 'vitest'
import { offsetTranscriptionCues } from '../../src/transcription/messages'

describe('offsetTranscriptionCues', () => {
  it('keeps chunk cue timestamps monotonic on the full video timeline', () => {
    expect(offsetTranscriptionCues('task', 2, 60_000, [
      { startMs: 500, endMs: 2_000, text: '第三段内容' },
    ])).toEqual([{
      id: 'asr-task-2-0',
      startMs: 60_500,
      endMs: 62_000,
      text: '第三段内容',
    }])
  })
})
