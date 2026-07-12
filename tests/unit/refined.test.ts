import { describe, expect, it, vi } from 'vitest'
import { processRefined } from '../../src/processors/refined'
import type { SubtitleParagraph } from '../../src/processors/paragraphs'
import type { ParagraphChunk } from '../../src/processors/chunk'
import type { ModelProvider, ModelResponse } from '../../src/core/contracts'

function paragraph(id: string, text: string): SubtitleParagraph {
  return { id, cueIds: [id], startMs: 0, endMs: 1000, text }
}

function chunk(
  id: string,
  paragraphs: SubtitleParagraph[],
  extraChars = 0,
): ParagraphChunk {
  return {
    id,
    paragraphs,
    inputChars: paragraphs.reduce((s, p) => s + p.text.length, 0) + extraChars,
  }
}

function providerReturning(responses: ModelResponse[]): ModelProvider {
  let callIndex = 0
  return {
    complete: vi.fn().mockImplementation(() => {
      const r = responses[callIndex]!
      callIndex += 1
      return Promise.resolve(r)
    }),
    testConnection: vi.fn().mockResolvedValue(undefined),
  }
}

const p1 = paragraph('p1', 'Today we discuss artificial intelligence.')
const p2 = paragraph('p2', 'AI has transformed many industries in recent years.')
const p3 = paragraph('p3', 'The future of AI looks promising.')

const chunks = [chunk('chunk-0', [p1, p2]), chunk('chunk-1', [p3])]

const validMapResponse: ModelResponse = {
  content: JSON.stringify({
    chapterCandidates: [{ title: 'AI Overview', sourceParagraphIds: ['p1', 'p2'] }],
    claims: [
      {
        text: 'AI has transformed many industries',
        sourceParagraphIds: ['p2'],
      },
    ],
    facts: [{ text: 'AI is a technology', sourceParagraphIds: ['p1'] }],
    people: [],
    examples: [],
    conclusions: [
      {
        text: 'AI future is promising',
        sourceParagraphIds: ['p3'],
      },
    ],
  }),
}

const validReduceResponse: ModelResponse = {
  content: JSON.stringify({
    overview: 'A discussion about artificial intelligence.',
    coreIdeas: ['AI transforms industries', 'AI has a bright future'],
    chapters: [
      {
        title: 'Introduction to AI',
        body: 'AI has transformed many industries.',
        sourceParagraphIds: ['p1', 'p2'],
      },
    ],
    importantFacts: [{ text: 'AI transforms industries', sourceParagraphIds: ['p2'] }],
    conclusion: 'The future of AI is promising.',
  }),
}

describe('processRefined', () => {
  it('runs map and reduce phases to produce a refined document', async () => {
    const provider = providerReturning([validMapResponse, validMapResponse, validReduceResponse])

    const result = await processRefined(chunks, provider)

    expect(result.overview).toBe('A discussion about artificial intelligence.')
    expect(result.coreIdeas).toHaveLength(2)
    expect(result.chapters).toHaveLength(1)
    expect(result.importantFacts).toHaveLength(1)
    expect(result.conclusion).toBe('The future of AI is promising.')
    expect(provider.complete).toHaveBeenCalledTimes(3) // 2 map + 1 reduce
  })

  it('calls onProgress with map and reduce stage updates', async () => {
    const provider = providerReturning([validMapResponse, validMapResponse, validReduceResponse])
    const onProgress = vi.fn()

    await processRefined(chunks, provider, onProgress)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'map' }),
    )
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'reduce' }),
    )
  })

  it('omits empty facts and chapters sections', async () => {
    const emptyExtras = {
      ...JSON.parse(validMapResponse.content),
      people: [],
      examples: [],
    }
    const reduceEmpty: ModelResponse = {
      content: JSON.stringify({
        overview: 'No facts.',
        coreIdeas: [],
        chapters: [],
        importantFacts: [],
        conclusion: 'Nothing.',
      }),
    }
    const provider = providerReturning([
      { content: JSON.stringify(emptyExtras) },
      { content: JSON.stringify(emptyExtras) },
      reduceEmpty,
    ])

    const result = await processRefined(chunks, provider)
    expect(result.importantFacts).toEqual([])
    expect(result.chapters).toEqual([])
    expect(result.coreIdeas).toEqual([])
  })

  it('rejects reduce output with missing required fields', async () => {
    const provider = providerReturning([
      validMapResponse,
      validMapResponse,
      { content: JSON.stringify({ overview: 'Missing fields' }) },
    ])

    await expect(processRefined(chunks, provider)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('rejects map output that is not valid JSON', async () => {
    const provider = providerReturning([
      { content: 'not json' },
      validMapResponse,
      validReduceResponse,
    ])

    await expect(processRefined(chunks, provider)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('passes AbortSignal to model calls', async () => {
    const provider = providerReturning([validMapResponse, validMapResponse, validReduceResponse])
    const controller = new AbortController()

    await processRefined(chunks, provider, () => {}, controller.signal)
    // All calls should have received the signal
    for (const call of vi.mocked(provider.complete).mock.calls) {
      expect(call[1]).toBe(controller.signal)
    }
  })
})
