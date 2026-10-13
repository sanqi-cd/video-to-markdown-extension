import type { SubtitleCue } from '../../core/contracts'

const INITIAL_STATE_PREFIX = 'window.__INITIAL_STATE__='
const OPUS_URL_PATTERN = /https:\/\/(?:www\.)?bilibili\.com\/opus\/(\d+)/giu

type UnknownRecord = Record<string, unknown>

export type ParsedPublisherTranscript = {
  status: 'available'
  opusId: string
  title: string
  authorMid: number
  paragraphs: string[]
} | {
  status: 'locked'
  opusId: string
  title: string
  authorMid: number
  message: string
}

export type PublisherTranscriptDiscovery = {
  status: 'loaded'
} | {
  status: 'locked'
  url: string
  message: string
} | {
  status: 'not-found'
  message: string
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export function extractBilibiliOpusIds(value: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(OPUS_URL_PATTERN)) {
    const id = match[1]
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

function extractInitialState(html: string): unknown {
  const start = html.indexOf(INITIAL_STATE_PREFIX)
  if (start < 0) return null
  const jsonStart = start + INITIAL_STATE_PREFIX.length
  if (html[jsonStart] !== '{') return null
  let depth = 0
  let inString = false
  let escaped = false
  let jsonEnd = -1
  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        jsonEnd = index + 1
        break
      }
    }
  }
  if (jsonEnd < 0) return null
  try {
    return JSON.parse(html.slice(jsonStart, jsonEnd)) as unknown
  } catch {
    return null
  }
}

function moduleList(state: unknown): UnknownRecord[] {
  const root = record(state)
  const detail = record(root?.detail)
  return Array.isArray(detail?.modules)
    ? detail.modules.map(record).filter((item): item is UnknownRecord => item !== null)
    : []
}

function textFromNode(value: unknown): string {
  const node = record(value)
  if (!node) return ''
  const word = record(node.word)
  const rich = record(node.rich)
  const formula = record(node.formula)
  return text(word?.words)
    || text(rich?.orig_text)
    || text(rich?.text)
    || text(formula?.latex)
}

function collectParagraphText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectParagraphText)
  const item = record(value)
  if (!item) return []

  const directNodeText = textFromNode(item)
  if (directNodeText) return [directNodeText]

  const results: string[] = []
  for (const key of ['nodes', 'items', 'paragraphs', 'text', 'heading', 'blockquote', 'list', 'code']) {
    if (key in item) results.push(...collectParagraphText(item[key]))
  }
  return results
}

function normalizedParagraphs(content: unknown): string[] {
  const contentRecord = record(content)
  if (!Array.isArray(contentRecord?.paragraphs)) return []
  return contentRecord.paragraphs
    .map((paragraph) => collectParagraphText(paragraph).join(' ').replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
}

export function parseBilibiliOpusHtml(
  html: string,
  opusId: string,
  expectedAuthorMid: number,
): ParsedPublisherTranscript | null {
  const modules = moduleList(extractInitialState(html))
  if (modules.length === 0) return null

  const titleModule = modules.find((item) => item.module_type === 'MODULE_TYPE_TITLE')
  const authorModule = modules.find((item) => item.module_type === 'MODULE_TYPE_AUTHOR')
  const contentModule = modules.find((item) => item.module_type === 'MODULE_TYPE_CONTENT')
  const blockedModule = modules.find((item) => (
    item.module_type === 'MODULE_TYPE_BLOCKED'
    || item.module_type === 'MODULE_TYPE_PAYWALL'
  ))
  const title = text(record(titleModule?.module_title)?.text) || '发布者文稿'
  const author = record(authorModule?.module_author)
  const authorMid = number(author?.mid)
  if (authorMid === null || authorMid !== expectedAuthorMid) return null

  if (blockedModule) {
    const blocked = record(blockedModule.module_blocked)
      ?? record(blockedModule.module_paywall)
    return {
      status: 'locked',
      opusId,
      title,
      authorMid,
      message: text(blocked?.hint_message)
        || text(blocked?.title)
        || '该发布者文稿当前需要在 B 站获取访问权限',
    }
  }

  const paragraphs = normalizedParagraphs(contentModule?.module_content)
  if (paragraphs.length === 0) return null
  return { status: 'available', opusId, title, authorMid, paragraphs }
}

export function publisherTranscriptMinimumChars(durationMs?: number): number {
  if (!durationMs || durationMs <= 0) return 600
  const durationMinutes = durationMs / 60_000
  return Math.max(600, Math.ceil(durationMinutes * 40))
}

export function publisherTranscriptTextChars(paragraphs: string[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + paragraph.replace(/\s+/g, '').length, 0)
}

export function isCompletePublisherTranscript(
  paragraphs: string[],
  durationMs?: number,
): boolean {
  return publisherTranscriptTextChars(paragraphs) >= publisherTranscriptMinimumChars(durationMs)
}

export function looksLikeEmbeddedTranscript(value: string): boolean {
  return /(?:完整)?(?:视频)?(?:文稿|逐字稿|转录)[：:\s]/u.test(value.slice(0, 160))
}

export function documentParagraphsToCues(
  paragraphs: string[],
  durationMs?: number,
): SubtitleCue[] {
  const nonEmptyParagraphs = paragraphs.filter((paragraph) => paragraph.trim().length > 0)
  const totalChars = Math.max(1, publisherTranscriptTextChars(nonEmptyParagraphs))
  const totalDuration = Math.max(
    durationMs ?? nonEmptyParagraphs.length * 1_000,
    nonEmptyParagraphs.length,
  )
  let consumedChars = 0
  return nonEmptyParagraphs.map((paragraph, index) => {
    const paragraphChars = Math.max(1, paragraph.replace(/\s+/g, '').length)
    const startMs = Math.round(totalDuration * (consumedChars / totalChars))
    consumedChars += paragraphChars
    const endMs = Math.max(startMs + 1, Math.round(totalDuration * (consumedChars / totalChars)))
    return {
      id: `publisher-${index}`,
      startMs,
      endMs,
      text: paragraph,
    }
  })
}
