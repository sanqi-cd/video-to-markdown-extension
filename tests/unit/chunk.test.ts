import { describe, expect, it } from 'vitest'
import { chunkParagraphs } from '../../src/processors/chunk'
import type { SubtitleParagraph } from '../../src/processors/paragraphs'

function p(
  overrides: Partial<SubtitleParagraph> & { id: string; text: string },
): SubtitleParagraph {
  return {
    cueIds: [overrides.id],
    startMs: 0,
    endMs: 1000,
    ...overrides,
  }
}

describe('chunkParagraphs', () => {
  it('puts all paragraphs into one chunk when within budget', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'Short.' }),
      p({ id: 'p2', text: 'Also short.' }),
    ]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 500, overlapParagraphs: 0 })
    expect(result).toHaveLength(1)
    expect(result[0]!.paragraphs).toEqual(paragraphs)
  })

  it('splits paragraphs across chunks when exceeding budget', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'A'.repeat(100) }),
      p({ id: 'p2', text: 'B'.repeat(100) }),
    ]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 150, overlapParagraphs: 0 })
    expect(result).toHaveLength(2)
    expect(result[0]!.paragraphs).toEqual([paragraphs[0]])
    expect(result[1]!.paragraphs).toEqual([paragraphs[1]])
  })

  it('never splits a single paragraph across chunks', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'Short.' }),
      p({ id: 'p2', text: 'Also short.' }),
    ]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 80, overlapParagraphs: 0 })
    // Each paragraph must be wholly inside exactly one chunk
    const allParagraphs = result.flatMap((chunk) => chunk.paragraphs)
    expect(allParagraphs).toEqual(paragraphs)
  })

  it('includes overlap paragraphs from previous chunk as context', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'A'.repeat(100) }),
      p({ id: 'p2', text: 'B'.repeat(100) }),
      p({ id: 'p3', text: 'C'.repeat(100) }),
    ]
    const result = chunkParagraphs(paragraphs, {
      maxInputChars: 150,
      overlapParagraphs: 1,
    })
    expect(result.length).toBeGreaterThan(1)
    // Later chunks include overlap from previous chunk's tail
    // Each original paragraph appears in at least one chunk
    const allIds = result.flatMap((chunk) => chunk.paragraphs.map((p) => p.id))
    expect(new Set(allIds)).toEqual(new Set(['p1', 'p2', 'p3']))
  })

  it('throws MODEL_CONTEXT_EXCEEDED when a single paragraph exceeds budget', () => {
    const paragraphs = [p({ id: 'p1', text: 'X'.repeat(500) })]
    expect(() =>
      chunkParagraphs(paragraphs, { maxInputChars: 100, overlapParagraphs: 0 }),
    ).toThrow('上下文窗口')
  })

  it('generates stable chunk IDs', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'A'.repeat(100) }),
      p({ id: 'p2', text: 'B'.repeat(100) }),
    ]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 150, overlapParagraphs: 0 })
    expect(result[0]!.id).toBe('chunk-0')
    expect(result[1]!.id).toBe('chunk-1')
  })

  it('tracks input character count per chunk', () => {
    const paragraphs = [p({ id: 'p1', text: 'Hello world!' })]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 100, overlapParagraphs: 0 })
    expect(result[0]!.inputChars).toBe(12)
  })

  it('preserves original paragraph order', () => {
    const paragraphs = [
      p({ id: 'p1', text: 'A'.repeat(100) }),
      p({ id: 'p2', text: 'B'.repeat(100) }),
      p({ id: 'p3', text: 'C'.repeat(100) }),
    ]
    const result = chunkParagraphs(paragraphs, { maxInputChars: 150, overlapParagraphs: 0 })
    const allParagraphs = result.flatMap((chunk) => chunk.paragraphs)
    expect(allParagraphs.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })
})
