import { describe, expect, it, vi } from 'vitest'
import { processHighFidelity } from '../../src/processors/high-fidelity'
import type { SubtitleParagraph } from '../../src/processors/paragraphs'
import type {
  ModelCallContext,
  ModelProvider,
  ModelResponse,
} from '../../src/core/contracts'

function paragraph(
  overrides: Partial<SubtitleParagraph> & { id: string; text: string },
): SubtitleParagraph {
  return {
    cueIds: [overrides.id],
    startMs: 0,
    endMs: 1000,
    ...overrides,
  }
}

function providerReturning(response: ModelResponse): ModelProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
    testConnection: vi.fn().mockResolvedValue(undefined),
  }
}

function providerReturningJson(obj: unknown): ModelProvider {
  return providerReturning({ content: JSON.stringify(obj) })
}

function streamingProvider(chunks: string[]): ModelProvider {
  return {
    complete: vi.fn().mockImplementation(async (_request, _signal, context) => {
      let content = ''
      context?.onActivity?.({ type: 'connected' })
      for (const chunk of chunks) {
        content += chunk
        context?.onActivity?.({
          type: 'delta',
          text: chunk,
          receivedChars: content.length,
        })
      }
      return { content }
    }),
    testConnection: vi.fn().mockResolvedValue(undefined),
  }
}

describe('processHighFidelity', () => {
  const chineseParagraphs = [
    paragraph({ id: 'p1', text: '这是第一段。' }),
    paragraph({ id: 'p2', text: '这是第二段。' }),
  ]

  const englishParagraphs = [
    paragraph({ id: 'p1', startMs: 100, endMs: 500, text: 'Hello world.' }),
    paragraph({ id: 'p2', startMs: 600, endMs: 1200, text: 'How are you?' }),
  ]

  it('returns Chinese paragraphs unchanged without calling the model', async () => {
    const complete = vi.fn()
    const result = await processHighFidelity(chineseParagraphs, 'zh', {
      complete,
    } as unknown as ModelProvider)

    expect(result.map((item) => item.text)).toEqual(
      chineseParagraphs.map((item) => item.text),
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('also skips model for zh-CN and zh-TW', async () => {
    const complete = vi.fn()
    await processHighFidelity(chineseParagraphs, 'zh-CN', {
      complete,
    } as unknown as ModelProvider)
    expect(complete).not.toHaveBeenCalled()

    await processHighFidelity(chineseParagraphs, 'zh-TW', {
      complete,
    } as unknown as ModelProvider)
    expect(complete).not.toHaveBeenCalled()
  })

  it('translates English paragraphs via the model', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: '你好世界。' },
        { id: 'p2', text: '你好吗？' },
      ],
    })

    const result = await processHighFidelity(englishParagraphs, 'en', provider)
    expect(result).toEqual([
      { id: 'p1', startMs: 100, endMs: 500, text: '你好世界。' },
      { id: 'p2', startMs: 600, endMs: 1200, text: '你好吗？' },
    ])
    expect(provider.complete).toHaveBeenCalledTimes(1)
  })

  it('keeps English subtitles unchanged when English output is selected', async () => {
    const complete = vi.fn()
    const result = await processHighFidelity(
      englishParagraphs,
      'en-US',
      { complete } as unknown as ModelProvider,
      undefined,
      undefined,
      undefined,
      'en',
    )

    expect(result.map((item) => item.text)).toEqual(
      englishParagraphs.map((item) => item.text),
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('requests English when Chinese subtitles use English output', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: 'This is the first paragraph.' },
        { id: 'p2', text: 'This is the second paragraph.' },
      ],
    })

    await processHighFidelity(
      chineseParagraphs,
      'zh',
      provider,
      undefined,
      undefined,
      undefined,
      'en',
    )

    const request = vi.mocked(provider.complete).mock.calls[0]?.[0]
    expect(request?.messages[0]?.content).toContain('English')
  })

  it('rejects translated output with a missing paragraph ID', async () => {
    const provider = providerReturningJson({
      paragraphs: [{ id: 'p1', text: '你好世界。' }],
    })

    await expect(
      processHighFidelity(englishParagraphs, 'en', provider),
    ).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('rejects translated output with an extra paragraph ID', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: '你好世界。' },
        { id: 'p2', text: '你好吗？' },
        { id: 'p3', text: '多余段落。' },
      ],
    })

    await expect(
      processHighFidelity([englishParagraphs[0]!, englishParagraphs[1]!], 'en', provider),
    ).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('rejects translated output with a duplicate paragraph ID', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: '你好世界。' },
        { id: 'p1', text: '重复了。' },
      ],
    })

    await expect(
      processHighFidelity(englishParagraphs, 'en', provider),
    ).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('rejects non-JSON model response', async () => {
    const provider = providerReturning({ content: 'not valid json' })

    await expect(
      processHighFidelity(englishParagraphs, 'en', provider),
    ).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('rejects when model response lacks paragraphs field', async () => {
    const provider = providerReturningJson({ notParagraphs: [] })

    await expect(
      processHighFidelity(englishParagraphs, 'en', provider),
    ).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })

  it('passes AbortSignal to the model provider', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: '你好世界。' },
        { id: 'p2', text: '你好吗？' },
      ],
    })
    const controller = new AbortController()

    await processHighFidelity(englishParagraphs, 'en', provider, () => {}, controller.signal)
    expect(provider.complete).toHaveBeenCalledWith(
      expect.anything(),
      controller.signal,
    )
  })

  it('calls onProgress with translation progress', async () => {
    const provider = providerReturningJson({
      paragraphs: [
        { id: 'p1', text: '你好世界。' },
        { id: 'p2', text: '你好吗？' },
      ],
    })
    const onProgress = vi.fn()

    await processHighFidelity(englishParagraphs, 'en', provider, onProgress)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'translate' }),
    )
  })

  it('仅在 NDJSON 行完整且按原顺序时增量提交可读段落', async () => {
    const line1 = '{"type":"paragraph","id":"p1","text":"你好世界。"}\n'
    const line2 = '{"type":"paragraph","id":"p2","text":"你好吗？"}\n'
    const onValidatedContent = vi.fn()
    const context: ModelCallContext = {
      taskId: 'task-1',
      chunkIndex: 0,
      onValidatedContent,
    }

    const result = await processHighFidelity(
      englishParagraphs,
      'en',
      streamingProvider([line1.slice(0, 24), line1.slice(24) + line2]),
      undefined,
      undefined,
      context,
    )

    expect(onValidatedContent).toHaveBeenCalledTimes(2)
    expect(onValidatedContent.mock.calls[0]?.[0]).toEqual([
      { id: 'p1', startMs: 100, endMs: 500, text: '你好世界。' },
    ])
    expect(onValidatedContent.mock.calls[1]?.[0]).toEqual(result)
  })

  it.each([
    [
      '重复 ID',
      '{"type":"paragraph","id":"p1","text":"一"}\n'
        + '{"type":"paragraph","id":"p1","text":"二"}\n',
    ],
    [
      '未知 ID',
      '{"type":"paragraph","id":"unknown","text":"错误"}\n',
    ],
    [
      '缺失 ID',
      '{"type":"paragraph","id":"p1","text":"只有一段"}\n',
    ],
  ])('拒绝流式结果中的%s', async (_label, content) => {
    await expect(processHighFidelity(
      englishParagraphs,
      'en',
      streamingProvider([content]),
      undefined,
      undefined,
      { taskId: 'task-1', chunkIndex: 0, onValidatedContent: vi.fn() },
    )).rejects.toMatchObject({ code: 'MODEL_RESPONSE_INVALID' })
  })
})
