import type { ProcessedDocument } from '../core/orchestrator'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { RefinedDocument } from '../processors/refined'
import type { Platform } from '../core/contracts'
import { outputLanguageLabel, type OutputLanguage } from '../core/language'

const ILLEGAL_FILENAME_CHARS = new Set('<>:"/\\|?*')

const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  bilibili: '哔哩哔哩',
}

export function sanitizeFilename(name: string): string {
  const sanitized = [...name]
    .filter((char) => char.charCodeAt(0) >= 32 && !ILLEGAL_FILENAME_CHARS.has(char))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return sanitized || 'video-to-markdown'
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
): string {
  const { metadata, mode } = doc
  const outputLanguage = doc.outputLanguage ?? 'zh'
  const labels = markdownLabels(outputLanguage)
  const separator = outputLanguage === 'en' ? ': ' : '：'
  const lines: string[] = [
    `# ${escapeMarkdown(metadata.title)}`,
    '',
    `> ${labels.source}${separator}${PLATFORM_LABELS[metadata.platform]}`,
  ]

  if (metadata.author) {
    lines.push(`> ${labels.author}${separator}${escapeMarkdown(metadata.author)}`)
  }

  lines.push(
    `> ${labels.video}${separator}${metadata.canonicalUrl}`,
    `> ${labels.mode}${separator}${modeLabel(mode, outputLanguage)}`,
    `> ${labels.language}${separator}${outputLanguageLabel(outputLanguage)}`,
  )

  if (doc.partial) {
    lines.push(
      `> ${labels.resultStatus}${separator}${labels.incompleteResult}`,
      `> ${labels.incompleteChunks}${separator}${doc.partial.incompleteChunkCount}`,
    )
  }

  lines.push(
    `> ${labels.generatedAt}${separator}${formatLocalISO(new Date(doc.generatedAt))}`,
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
  paragraphTimestamps: Record<string, number>,
  outputLanguage: OutputLanguage,
): string {
  const labels = refinedSectionLabels(outputLanguage)
  const lines: string[] = [
    `## ${labels.overview}`,
    '',
    content.overview,
    '',
  ]

  if (content.coreIdeas.length > 0) {
    lines.push(`## ${labels.coreIdeas}`, '')
    for (const idea of content.coreIdeas) {
      lines.push(`- ${idea}`)
    }
    lines.push('')
  }

  if (content.chapters.length > 0) {
    lines.push(`## ${labels.chapters}`, '')
    for (const ch of content.chapters) {
      lines.push(`### ${escapeMarkdown(ch.title)}`, '', ch.body, '')
      appendSourceTimestamp(
        lines,
        ch.sourceParagraphIds,
        paragraphTimestamps,
        platform,
        videoId,
        opts,
        outputLanguage,
      )
    }
  }

  if (content.importantFacts.length > 0) {
    lines.push(`## ${labels.facts}`, '')
    for (const fact of content.importantFacts) {
      lines.push(`- ${fact.text}`)
      appendSourceTimestamp(
        lines,
        fact.sourceParagraphIds,
        paragraphTimestamps,
        platform,
        videoId,
        opts,
        outputLanguage,
      )
    }
    lines.push('')
  }

  if (content.conclusion) {
    lines.push(`## ${labels.conclusion}`, '', content.conclusion, '')
  }

  return lines.join('\n')
}

function appendSourceTimestamp(
  lines: string[],
  sourceIds: string[],
  paragraphTimestamps: Record<string, number>,
  platform: Platform,
  videoId: string,
  opts: RenderOptions,
  outputLanguage: OutputLanguage = 'zh',
): void {
  if (!opts.includeTimestamps) return
  const startMs = sourceIds
    .map((id) => paragraphTimestamps[id])
    .find((value): value is number => value !== undefined)
  if (startMs === undefined) return
  const source = outputLanguage === 'zh' ? '来源' : 'Source'
  lines.push(`  - [${source} ${formatTimestamp(startMs)}](${timestampUrl(platform, videoId, startMs)})`, '')
}

export function renderMarkdown(
  doc: ProcessedDocument,
  opts: RenderOptions,
): string {
  const header = renderMetadata(doc)
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
      doc.paragraphTimestamps ?? {},
      doc.outputLanguage ?? 'zh',
    )
  }

  return header + body
}

function markdownLabels(language: OutputLanguage) {
  if (language === 'en') {
    return {
      source: 'Source',
      author: 'Author',
      video: 'Video',
      mode: 'Processing mode',
      language: 'Output language',
      resultStatus: 'Result status',
      incompleteResult: 'Incomplete result',
      incompleteChunks: 'Incomplete chunks',
      generatedAt: 'Generated at',
    }
  }
  return {
    source: '来源',
    author: '作者',
    video: '视频',
    mode: '处理模式',
    language: '输出语言',
    resultStatus: '结果状态',
    incompleteResult: '不完整结果',
    incompleteChunks: '未完成分块',
    generatedAt: '生成时间',
  }
}

function refinedSectionLabels(language: OutputLanguage) {
  return language === 'en'
    ? {
        overview: 'Overview',
        coreIdeas: 'Core Ideas',
        chapters: 'Chapter Notes',
        facts: 'Important Facts and Examples',
        conclusion: 'Conclusion and Takeaways',
      }
    : {
        overview: '内容概览',
        coreIdeas: '核心观点',
        chapters: '章节笔记',
        facts: '重要案例与数据',
        conclusion: '结论与启发',
      }
}

function modeLabel(
  mode: ProcessedDocument['mode'],
  language: OutputLanguage,
): string {
  if (language === 'en') {
    return mode === 'high-fidelity' ? 'High fidelity' : 'AI refined'
  }
  return mode === 'high-fidelity' ? '高保真' : 'AI 精炼'
}

export function downloadMarkdown(filename: string, markdown: string): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
  )
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown) => {
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve()
    }

    try {
      chrome.downloads.download(
        { url, filename: `${sanitizeFilename(filename)}.md`, saveAs: true },
        () => {
          const message = chrome.runtime.lastError?.message
          finish(message ? new Error(`下载失败：${message}`) : undefined)
        },
      )
    } catch (error) {
      finish(error)
    }
  })
}
