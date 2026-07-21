import { describe, expect, it, vi } from 'vitest'
import {
  processRefined,
  processRefinedMapChunk,
  reduceRefinedMapResults,
} from '../../src/processors/refined'
import type { SubtitleParagraph } from '../../src/processors/paragraphs'
import type { ParagraphChunk } from '../../src/processors/chunk'
import type {
  ModelCallContext,
  ModelProvider,
  ModelResponse,
} from '../../src/core/contracts'

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
    conclusions: [],
  }),
}

const validMapResponseP3: ModelResponse = {
  content: JSON.stringify({
    chapterCandidates: [],
    claims: [],
    facts: [],
    people: [],
    examples: [],
    conclusions: [{
      text: 'AI future is promising',
      sourceParagraphIds: ['p3'],
    }],
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
    const provider = providerReturning([validMapResponse, validMapResponseP3, validReduceResponse])

    const result = await processRefined(chunks, provider)

    expect(result.overview).toBe('A discussion about artificial intelligence.')
    expect(result.coreIdeas).toHaveLength(2)
    expect(result.chapters).toHaveLength(1)
    expect(result.importantFacts).toHaveLength(1)
    expect(result.conclusion).toBe('The future of AI is promising.')
    expect(provider.complete).toHaveBeenCalledTimes(3) // 2 map + 1 reduce
  })

  it('calls onProgress with map and reduce stage updates', async () => {
    const provider = providerReturning([validMapResponse, validMapResponseP3, validReduceResponse])
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
      validMapResponseP3,
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
      validMapResponseP3,
      { content: JSON.stringify({ overview: 'Missing fields' }) },
    ])

    await expect(processRefined(chunks, provider)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('rejects map output that is not valid JSON', async () => {
    const provider = providerReturning([
      { content: 'not json' },
      validMapResponseP3,
      validReduceResponse,
    ])

    await expect(processRefined(chunks, provider)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
  })

  it('passes AbortSignal to model calls', async () => {
    const provider = providerReturning([validMapResponse, validMapResponseP3, validReduceResponse])
    const controller = new AbortController()

    await processRefined(chunks, provider, () => {}, controller.signal)
    // All calls should have received the signal
    for (const call of vi.mocked(provider.complete).mock.calls) {
      expect(call[1]).toBe(controller.signal)
    }
  })
})

describe('refined structured streaming', () => {
  function streamingProvider(parts: string[]): ModelProvider {
    return {
      complete: vi.fn().mockImplementation(async (_request, _signal, context) => {
        let content = ''
        for (const part of parts) {
          content += part
          context?.onActivity?.({
            type: 'delta',
            text: part,
            receivedChars: content.length,
          })
        }
        return { content }
      }),
      testConnection: vi.fn().mockResolvedValue(undefined),
    }
  }

  it('adds the selected English output language to Map and Reduce prompts', async () => {
    const provider = providerReturning([
      validMapResponse,
      validMapResponseP3,
      validReduceResponse,
    ])

    await processRefined(chunks, provider, undefined, undefined, 'en')

    const calls = vi.mocked(provider.complete).mock.calls
    expect(calls[0]?.[0].messages[0]?.content).toContain('English')
    expect(calls.at(-1)?.[0].messages[0]?.content).toContain('English')
  })

  it('Reduce 按语义单元增量组装文档，分片可截断在一行中间', async () => {
    const content = [
      '{"type":"overview","text":"概览"}',
      '{"type":"core_idea","text":"核心观点"}',
      '{"type":"chapter","title":"章节","body":"正文","sourceParagraphIds":["p1"]}',
      '{"type":"fact","text":"事实","sourceParagraphIds":["p2"]}',
      '{"type":"conclusion","text":"结论"}',
    ].join('\n')
    const onValidatedContent = vi.fn()
    const context: ModelCallContext = {
      taskId: 'task-1',
      chunkIndex: 2,
      onValidatedContent,
    }

    const result = await reduceRefinedMapResults(
      [JSON.parse(validMapResponse.content)],
      ['p1', 'p2'],
      streamingProvider([content.slice(0, 31), content.slice(31)]),
      undefined,
      context,
    )

    expect(onValidatedContent).toHaveBeenCalledTimes(5)
    expect(onValidatedContent.mock.calls[0]?.[0]).toMatchObject({ overview: '概览' })
    expect(onValidatedContent.mock.calls.at(-1)?.[0]).toEqual(result)
    expect(result).toEqual({
      overview: '概览',
      coreIdeas: ['核心观点'],
      chapters: [{
        title: '章节',
        body: '正文',
        sourceParagraphIds: ['p1'],
      }],
      importantFacts: [{ text: '事实', sourceParagraphIds: ['p2'] }],
      conclusion: '结论',
    })
  })

  it('来源 ID 未通过校验的语义单元不会提交到预览', async () => {
    const onValidatedContent = vi.fn()
    const content = [
      '{"type":"overview","text":"合法概览"}',
      '{"type":"chapter","title":"错误章节","body":"正文","sourceParagraphIds":["unknown"]}',
      '{"type":"conclusion","text":"结论"}',
    ].join('\n')

    await expect(reduceRefinedMapResults(
      [JSON.parse(validMapResponse.content)],
      ['p1'],
      streamingProvider([`${content}\n`]),
      undefined,
      { taskId: 'task-1', chunkIndex: 1, onValidatedContent },
    )).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })

    expect(onValidatedContent).toHaveBeenCalledTimes(1)
    expect(onValidatedContent.mock.calls[0]?.[0]).toMatchObject({
      overview: '合法概览',
      chapters: [],
    })
  })

  it('Map 的原始 Delta 只报告活动，不提交语义预览', async () => {
    const onActivity = vi.fn()
    const onValidatedContent = vi.fn()
    const content = validMapResponse.content
    const provider = streamingProvider([content.slice(0, 20), content.slice(20)])

    await processRefinedMapChunk(chunks[0]!, provider, undefined, {
      taskId: 'task-1',
      chunkIndex: 0,
      onActivity,
      onValidatedContent,
    })

    expect(onActivity).toHaveBeenCalled()
    expect(onValidatedContent).not.toHaveBeenCalled()
  })

  it('Map 引用当前分块之外的段落 ID 时立即拒绝', async () => {
    const invalidMapResponse: ModelResponse = {
      content: JSON.stringify({
        chapterCandidates: [],
        claims: [{ text: '无依据观点', sourceParagraphIds: ['unknown'] }],
        facts: [],
        people: [],
        examples: [],
        conclusions: [],
      }),
    }
    const provider = providerReturning([invalidMapResponse])

    await expect(processRefinedMapChunk(chunks[0]!, provider)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
      message: '无效的来源段落 ID: unknown',
    })
  })

  it('Map 内容项缺少来源段落时拒绝结构', async () => {
    const invalidMapResponse: ModelResponse = {
      content: JSON.stringify({
        chapterCandidates: [],
        claims: [{ text: '无来源观点', sourceParagraphIds: [] }],
        facts: [],
        people: [],
        examples: [],
        conclusions: [],
      }),
    }

    await expect(processRefinedMapChunk(
      chunks[0]!,
      providerReturning([invalidMapResponse]),
    )).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('拒绝缺少 conclusion 的 NDJSON Reduce 最终结果', async () => {
    const content = '{"type":"overview","text":"只有概览"}\n'

    await expect(reduceRefinedMapResults(
      [JSON.parse(validMapResponse.content)],
      ['p1'],
      streamingProvider([content]),
      undefined,
      { taskId: 'task-1', chunkIndex: 1, onValidatedContent: vi.fn() },
    )).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })
})
