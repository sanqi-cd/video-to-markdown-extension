import type { ProcessedDocument } from '../core/orchestrator'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'
import type { Platform } from '../core/contracts'

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  bilibili: '哔哩哔哩',
}

const MODE_LABELS = {
  'high-fidelity': '高保真',
  refined: 'AI 精炼',
} as const

export function sanitizeFilename(name: string): string {
  return name
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
}

export function timestampUrl(platform: Platform, videoId: string, ms: number): string {
  const seconds = Math.floor(ms / 1000)
  switch (platform) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`
    case 'bilibili':
      return `https://www.bilibili.com/video/${videoId}?t=${seconds}`
  }
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

export type RenderOptions = {
  includeTimestamps: boolean
  generatedAt: Date
}

function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
}

function renderMetadata(
  doc: ProcessedDocument,
  opts: RenderOptions,
): string {
  const { metadata, mode } = doc
  const lines: string[] = [
    `# ${escapeMarkdown(metadata.title)}`,
    '',
    `> 来源：${PLATFORM_LABELS[metadata.platform]}`,
  ]

  if (metadata.author) {
    lines.push(`> 作者：${escapeMarkdown(metadata.author)}`)
  }

  lines.push(
    `> 视频：${metadata.canonicalUrl}`,
    `> 处理模式：${MODE_LABELS[mode]}`,
    `> 生成时间：${formatLocalISO(opts.generatedAt)}`,
    '',
  )

  return lines.join('\n')
}

function renderHighFidelity(
  content: TranslatedParagraph[],
  platform: Platform,
  videoId: string,
  opts: RenderOptions,
): string {
  const parts: string[] = []

  for (const p of content) {
    if (opts.includeTimestamps) {
      const url = timestampUrl(platform, videoId, p.startMs)
      parts.push(`[${formatTimestamp(p.startMs)}](${url})`, '')
    }
    parts.push(p.text, '')
  }

  return parts.join('\n')
}

function renderRefined(
  content: RefinedDocument,
  platform: Platform,
  videoId: string,
  opts: RenderOptions,
): string {
  const lines: string[] = [
    '## 内容概览',
    '',
    content.overview,
    '',
  ]

  if (content.coreIdeas.length > 0) {
    lines.push('## 核心观点', '')
    for (const idea of content.coreIdeas) {
      lines.push(`- ${idea}`)
    }
    lines.push('')
  }

  if (content.chapters.length > 0) {
    lines.push('## 章节笔记', '')
    for (const ch of content.chapters) {
      lines.push(`### ${escapeMarkdown(ch.title)}`, '', ch.body, '')
    }
  }

  if (content.importantFacts.length > 0) {
    lines.push('## 重要案例与数据', '')
    for (const fact of content.importantFacts) {
      lines.push(`- ${fact.text}`)
    }
    lines.push('')
  }

  if (content.conclusion) {
    lines.push('## 结论与启发', '', content.conclusion, '')
  }

  return lines.join('\n')
}

export function renderMarkdown(
  doc: ProcessedDocument,
  opts: RenderOptions,
): string {
  const header = renderMetadata(doc, opts)
  let body: string

  if (doc.mode === 'high-fidelity') {
    body = renderHighFidelity(
      doc.content as TranslatedParagraph[],
      doc.metadata.platform,
      doc.metadata.videoId,
      opts,
    )
  } else {
    body = renderRefined(
      doc.content as RefinedDocument,
      doc.metadata.platform,
      doc.metadata.videoId,
      opts,
    )
  }

  return header + body
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
  )
  chrome.downloads.download(
    { url, filename: `${sanitizeFilename(filename)}.md`, saveAs: true },
    () => {
      URL.revokeObjectURL(url)
    },
  )
}
