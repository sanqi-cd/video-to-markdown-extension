import { describe, expect, it } from 'vitest'
import {
  buildPartialDocument,
  buildRefinedAnalysisPreview,
  visibleCompletedChunks,
} from '../../src/markdown/partial-document'
import type { ProcessedChunk } from '../../src/core/task-events'
import type { VideoMetadata } from '../../src/core/contracts'

const metadata: VideoMetadata = {
  platform: 'youtube',
  videoId: 'partial-video',
  title: 'Partial Video',
  canonicalUrl: 'https://www.youtube.com/watch?v=partial-video',
}

describe('partial-document', () => {
  it('builds an ordered high-fidelity document from visible validated chunks', () => {
    const chunks: ProcessedChunk[] = [
      {
        id: 'chunk-1',
        index: 1,
        content: [{ id: 'p2', startMs: 2_000, endMs: 3_000, text: '第二段' }],
      },
      {
        id: 'chunk-0',
        index: 0,
        content: [{ id: 'p1', startMs: 0, endMs: 1_000, text: '第一段' }],
      },
    ]

    const document = buildPartialDocument({
      metadata,
      mode: 'high-fidelity',
      completedChunks: chunks,
      generatedAt: 123,
      incompleteChunkCount: 1,
    })

    expect(document?.mode).toBe('high-fidelity')
    expect(document?.content).toEqual([
      { id: 'p1', startMs: 0, endMs: 1_000, text: '第一段' },
      { id: 'p2', startMs: 2_000, endMs: 3_000, text: '第二段' },
    ])
  })

  it('does not expose AI map structures as a partial document', () => {
    const chunks: ProcessedChunk[] = [{
      id: 'chunk-0',
      index: 0,
      content: {
        chapterCandidates: [],
        claims: [{ text: 'internal map data', sourceParagraphIds: ['p1'] }],
      },
    }]

    expect(buildPartialDocument({
      metadata,
      mode: 'refined',
      completedChunks: chunks,
      generatedAt: 123,
      incompleteChunkCount: 1,
    })).toBeNull()
  })

  it('builds a deduplicated live analysis preview from validated Map results', () => {
    const chunks: ProcessedChunk[] = [
      {
        id: 'chunk-0',
        index: 0,
        content: {
          chapterCandidates: [{ title: '产品能力', sourceParagraphIds: ['p1'] }],
          claims: [{ text: '核心观点', sourceParagraphIds: ['p1'] }],
          facts: [],
          people: [{ name: 'Tina Huang', sourceParagraphIds: ['p1'] }],
          examples: [],
          conclusions: [],
        },
      },
      {
        id: 'chunk-1',
        index: 1,
        content: {
          chapterCandidates: [{ title: '产品能力', sourceParagraphIds: ['p2'] }],
          claims: [{ text: '核心观点', sourceParagraphIds: ['p2'] }],
          facts: [{ text: '重要事实', sourceParagraphIds: ['p2'] }],
          people: [],
          examples: [],
          conclusions: [{ text: '初步结论', sourceParagraphIds: ['p2'] }],
        },
      },
    ]

    expect(buildRefinedAnalysisPreview(chunks)).toEqual({
      analyzedChunks: 2,
      chapterCandidates: ['产品能力'],
      claims: ['核心观点'],
      facts: ['重要事实'],
      people: ['Tina Huang'],
      examples: [],
      conclusions: ['初步结论'],
    })
  })

  it('uses a validated refined reduce result when one becomes available', () => {
    const result = {
      overview: '概览',
      coreIdeas: ['观点'],
      chapters: [],
      importantFacts: [],
      conclusion: '结论',
    }
    const chunks: ProcessedChunk[] = [
      { id: 'chunk-0', index: 0 },
      { id: 'reduce', index: 1, content: result },
    ]

    const document = buildPartialDocument({
      metadata,
      mode: 'refined',
      completedChunks: chunks,
      generatedAt: 123,
      incompleteChunkCount: 1,
    })
    expect(document?.content).toEqual(result)
    expect(document?.generatedAt).toBe(123)
    expect(document?.partial).toEqual({ incompleteChunkCount: 1 })
    expect(visibleCompletedChunks(chunks).map((chunk) => chunk.id)).toEqual(['reduce'])
  })
})
