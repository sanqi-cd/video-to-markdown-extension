import { describe, expect, it, vi } from 'vitest'
import {
  downloadMarkdown,
  renderMarkdown,
  timestampUrl,
  sanitizeFilename,
} from '../../src/markdown/render-markdown'
import type { ProcessedDocument } from '../../src/core/orchestrator'
import type { TranslatedParagraph } from '../../src/processors/high-fidelity'

const highFidelityDoc: ProcessedDocument = {
  metadata: {
    platform: 'youtube',
    videoId: 'video123',
    title: 'AI 智能体如何工作',
    author: 'Tech Channel',
    canonicalUrl: 'https://www.youtube.com/watch?v=video123',
    durationMs: 204000,
  },
  mode: 'high-fidelity',
  generatedAt: new Date('2026-07-12T12:00:00+08:00').getTime(),
  content: [
    {
      id: 'p1',
      startMs: 0,
      endMs: 5000,
      text: '这是一段关于AI的介绍。',
    },
    {
      id: 'p2',
      startMs: 204000,
      endMs: 209000,
      text: 'AI 智能体可以自主完成任务。',
    },
  ] as TranslatedParagraph[],
}

function generatedAtFromMarkdown(markdown: string): string {
  const match = markdown.match(/^> 生成时间：(.+)$/m)
  const generatedAt = match?.[1]
  if (!generatedAt) {
    throw new Error('Markdown metadata is missing the generation time')
  }
  return generatedAt
}

describe('timestampUrl', () => {
  it('generates YouTube timestamp URLs', () => {
    expect(timestampUrl('youtube', 'video123', 204000)).toBe(
      'https://www.youtube.com/watch?v=video123&t=204s',
    )
  })

  it('generates Bilibili timestamp URLs', () => {
    expect(timestampUrl('bilibili', 'BV123', 1500)).toBe(
      'https://www.bilibili.com/video/BV123?t=1',
    )
  })
})

describe('sanitizeFilename', () => {
  it('removes filesystem-illegal characters', () => {
    expect(sanitizeFilename('AI: 智能体/如何\\工作?')).toBe('AI 智能体如何工作')
  })

  it('trims whitespace and periods', () => {
    expect(sanitizeFilename('  标题...  ')).toBe('标题')
  })

  it('uses a stable fallback when the title contains only illegal characters', () => {
    expect(sanitizeFilename('  <>:"/\\|?*...  ')).toBe('video-to-markdown')
  })
})

describe('downloadMarkdown', () => {
  it('rejects when Chrome reports a download error and always revokes the object URL', async () => {
    const originalDownload = chrome.downloads.download
    const lastErrorDescriptor = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError')
    const createObjectURL = vi.fn().mockReturnValue('blob:test-markdown')
    const revokeObjectURL = vi.fn()
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    Object.defineProperty(chrome.runtime, 'lastError', {
      configurable: true,
      value: { message: 'download denied' },
    })
    chrome.downloads.download = vi.fn((_options, callback) => {
      callback?.(0)
    }) as unknown as typeof chrome.downloads.download

    try {
      await expect(downloadMarkdown('标题', '# 正文')).rejects.toThrow(
        '下载失败：download denied',
      )
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-markdown')
    } finally {
      chrome.downloads.download = originalDownload
      if (lastErrorDescriptor) Object.defineProperty(chrome.runtime, 'lastError', lastErrorDescriptor)
      else delete (chrome.runtime as unknown as Record<string, unknown>).lastError
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
      else delete (URL as Partial<typeof URL>).createObjectURL
      if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
      else delete (URL as Partial<typeof URL>).revokeObjectURL
    }
  })
})

describe('renderMarkdown', () => {
  it('renders the video title as H1', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
    })
    expect(md).toContain('# AI 智能体如何工作')
  })

  it('includes metadata block with source and author', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
    })
    expect(md).toContain('> 来源：YouTube')
    expect(md).toContain('> 作者：Tech Channel')
    expect(md).toContain('> 视频：https://www.youtube.com/watch?v=video123')
    expect(md).toContain('> 处理模式：高保真')
    const generatedAt = generatedAtFromMarkdown(md)
    expect(generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
    expect(new Date(generatedAt).getTime()).toBe(highFidelityDoc.generatedAt)
  })

  it('omits author line when author is missing', () => {
    const doc = {
      ...highFidelityDoc,
      metadata: { ...highFidelityDoc.metadata, author: undefined },
    }
    const md = renderMarkdown(doc, {
      includeTimestamps: false,
    })
    expect(md).not.toContain('> 作者')
  })

  it('renders YouTube timestamps when enabled', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: true,
    })
    expect(md).toContain('[00:03:24](https://www.youtube.com/watch?v=video123&t=204s)')
    expect(md).not.toContain('How AI agents work')
  })

  it('omits timestamp lines when disabled', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
    })
    expect(md).not.toContain('[00:03:24]')
  })

  it('converts milliseconds to mm:ss or hh:mm:ss format', () => {
    const url = timestampUrl('youtube', 'v123', 3661000) // 1h 1min 1s
    expect(url).toContain('t=3661s')
  })

  it('renders source timestamps for refined chapters when enabled', () => {
    const document: ProcessedDocument = {
      metadata: highFidelityDoc.metadata,
      mode: 'refined',
      generatedAt: highFidelityDoc.generatedAt,
      paragraphTimestamps: { p1: 65_000 },
      content: {
        overview: '概览',
        coreIdeas: [],
        chapters: [{ title: '章节', body: '内容', sourceParagraphIds: ['p1'] }],
        importantFacts: [],
        conclusion: '',
      },
    }
    const markdown = renderMarkdown(document, {
      includeTimestamps: true,
    })

    expect(markdown).toContain('[来源 00:01:05](https://www.youtube.com/watch?v=video123&t=65s)')
  })

  it('uses the fixed document generation time across repeated renders', () => {
    const first = renderMarkdown(highFidelityDoc, { includeTimestamps: false })
    const second = renderMarkdown(highFidelityDoc, { includeTimestamps: false })

    expect(first).toBe(second)
    expect(new Date(generatedAtFromMarkdown(first)).getTime()).toBe(
      highFidelityDoc.generatedAt,
    )
  })

  it('marks a partial export with its incomplete chunk count', () => {
    const markdown = renderMarkdown({
      ...highFidelityDoc,
      partial: { incompleteChunkCount: 2 },
    }, { includeTimestamps: false })

    expect(markdown).toContain('> 结果状态：不完整结果')
    expect(markdown).toContain('> 未完成分块：2')
  })

  it('renders English metadata and refined section headings for English output', () => {
    const document: ProcessedDocument = {
      metadata: highFidelityDoc.metadata,
      mode: 'refined',
      outputLanguage: 'en',
      generatedAt: highFidelityDoc.generatedAt,
      content: {
        overview: 'An overview.',
        coreIdeas: ['A core idea.'],
        chapters: [],
        importantFacts: [],
        conclusion: 'A conclusion.',
      },
    }

    const markdown = renderMarkdown(document, { includeTimestamps: false })

    expect(markdown).toContain('> Source: YouTube')
    expect(markdown).toContain('> Output language: English')
    expect(markdown).toContain('## Overview')
    expect(markdown).toContain('## Core Ideas')
    expect(markdown).toContain('## Conclusion and Takeaways')
    expect(markdown).not.toContain('## 内容概览')
  })
})
