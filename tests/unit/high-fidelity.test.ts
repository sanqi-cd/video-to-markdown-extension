import { describe, expect, it, vi } from 'vitest'
import { processHighFidelity } from '../../src/processors/high-fidelity'
import type { SubtitleParagraph } from '../../src/processors/paragraphs'
import type { ModelProvider, ModelResponse } from '../../src/core/contracts'

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
})
