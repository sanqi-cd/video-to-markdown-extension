import { describe, expect, it } from 'vitest'
import { renderMarkdown, timestampUrl, sanitizeFilename } from '../../src/markdown/render-markdown'
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
})

describe('renderMarkdown', () => {
  it('renders the video title as H1', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
      generatedAt: new Date('2026-07-12T12:00:00+08:00'),
    })
    expect(md).toContain('# AI 智能体如何工作')
  })

  it('includes metadata block with source and author', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
      generatedAt: new Date('2026-07-12T12:00:00+08:00'),
    })
    expect(md).toContain('> 来源：YouTube')
    expect(md).toContain('> 作者：Tech Channel')
    expect(md).toContain('> 视频：https://www.youtube.com/watch?v=video123')
    expect(md).toContain('> 处理模式：高保真')
    expect(md).toContain('> 生成时间：2026-07-12T12:00:00+08:00')
  })

  it('omits author line when author is missing', () => {
    const doc = {
      ...highFidelityDoc,
      metadata: { ...highFidelityDoc.metadata, author: undefined },
    }
    const md = renderMarkdown(doc, {
      includeTimestamps: false,
      generatedAt: new Date('2026-07-12T12:00:00+08:00'),
    })
    expect(md).not.toContain('> 作者')
  })

  it('renders YouTube timestamps when enabled', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: true,
      generatedAt: new Date('2026-07-12T12:00:00+08:00'),
    })
    expect(md).toContain('[00:03:24](https://www.youtube.com/watch?v=video123&t=204s)')
    expect(md).not.toContain('How AI agents work')
  })

  it('omits timestamp lines when disabled', () => {
    const md = renderMarkdown(highFidelityDoc, {
      includeTimestamps: false,
      generatedAt: new Date('2026-07-12T12:00:00+08:00'),
    })
    expect(md).not.toContain('[00:03:24]')
  })

  it('converts milliseconds to mm:ss or hh:mm:ss format', () => {
    const url = timestampUrl('youtube', 'v123', 3661000) // 1h 1min 1s
    expect(url).toContain('t=3661s')
  })
})
