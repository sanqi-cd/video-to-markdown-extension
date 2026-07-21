import { describe, expect, it } from 'vitest'
import { buildParagraphs } from '../../src/processors/paragraphs'
import type { SubtitleCue } from '../../src/core/contracts'

function cue(overrides: Partial<SubtitleCue> & { id: string }): SubtitleCue {
  return {
    startMs: 0,
    endMs: 1000,
    text: 'Default text.',
    ...overrides,
  }
}

describe('buildParagraphs', () => {
  it('groups a single cue into one paragraph', () => {
    const cues = [cue({ id: '1', text: 'Hello world.' })]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('Hello world.')
    expect(result[0]!.cueIds).toEqual(['1'])
  })

  it('merges cues until a sentence-ending punctuation is found', () => {
    const cues = [
      cue({ id: '1', startMs: 0, endMs: 500, text: 'This is' }),
      cue({ id: '2', startMs: 600, endMs: 1200, text: 'a sentence.' }),
      cue({ id: '3', startMs: 1300, endMs: 2000, text: 'Another one.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('This is a sentence.')
    expect(result[1]!.text).toBe('Another one.')
  })

  it('splits on a gap larger than 1500ms', () => {
    const cues = [
      cue({ id: '1', startMs: 0, endMs: 500, text: 'First part' }),
      cue({ id: '2', startMs: 2500, endMs: 3000, text: 'Second part.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(2)
  })

  it('does not split when the gap is small', () => {
    const cues = [
      cue({ id: '1', startMs: 0, endMs: 500, text: 'First part' }),
      cue({ id: '2', startMs: 600, endMs: 1200, text: 'second part.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('First part second part.')
  })

  it('generates a stable paragraph ID from first and last cue IDs', () => {
    const cues = [
      cue({ id: 'c1', text: 'A' }),
      cue({ id: 'c2', startMs: 600, text: 'B.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result[0]!.id).toBe('c1-c2')
  })

  it('preserves startMs from first cue and endMs from last cue', () => {
    const cues = [
      cue({ id: '1', startMs: 100, endMs: 500, text: 'A' }),
      cue({ id: '2', startMs: 600, endMs: 1200, text: 'B.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result[0]!.startMs).toBe(100)
    expect(result[0]!.endMs).toBe(1200)
  })

  it('splits when a single cue ends with punctuation', () => {
    const cues = [
      cue({ id: '1', text: 'First thought.' }),
      cue({ id: '2', text: 'Second thought.' }),
    ]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(2)
  })

  it('handles Chinese period as sentence-ending punctuation', () => {
    const cues = [
      cue({ id: '1', text: '这是第一句话' }),
      cue({ id: '2', text: '继续。' }),
    ]
    const result = buildParagraphs(cues)
    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('这是第一句话 继续。')
  })

  it('limits paragraphs when subtitles have no punctuation', () => {
    const cues = Array.from({ length: 8 }, (_, index) => cue({
      id: String(index),
      startMs: index * 500,
      endMs: index * 500 + 400,
      text: 'a'.repeat(100),
    }))
    const result = buildParagraphs(cues)

    expect(result.length).toBeGreaterThan(1)
    expect(result.every((paragraph) => paragraph.text.length <= 600)).toBe(true)
  })
})
