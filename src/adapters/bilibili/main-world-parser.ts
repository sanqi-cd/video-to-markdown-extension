import {
  isNonnegativeInteger,
  isOptionalString,
  isRecord,
} from '../shared/value-guards'

export interface BilibiliMainWorldContext {
  bvid: string
  aid: number
  cid: number
  page: number
  title: string
  author?: string
  durationMs?: number
  description?: string
}

export function collectBilibiliDescription(videoData: unknown): string {
  if (!isRecord(videoData)) return ''
  const parts: string[] = []
  if (typeof videoData.desc === 'string') parts.push(videoData.desc)
  if (Array.isArray(videoData.desc_v2)) {
    for (const item of videoData.desc_v2) {
      if (isRecord(item) && typeof item.raw_text === 'string') {
        parts.push(item.raw_text)
      }
    }
  }
  return parts.join('\n')
}

export function resolveBilibiliPlayback(
  videoData: unknown,
  pageFromUrl: number,
): { cid: number; durationMs?: number; title: string } | null {
  if (!isRecord(videoData) || !isNonnegativeInteger(videoData.cid) || typeof videoData.title !== 'string') {
    return null
  }

  const pageIndex = Math.max(1, pageFromUrl)
  const pages = Array.isArray(videoData.pages) ? videoData.pages : []
  const matched = pages.find((item) => isRecord(item) && item.page === pageIndex)
    ?? (isRecord(pages[pageIndex - 1]) ? pages[pageIndex - 1] : undefined)

  if (isRecord(matched) && isNonnegativeInteger(matched.cid)) {
    const partTitle = typeof matched.part === 'string' ? matched.part.trim() : ''
    return {
      cid: matched.cid,
      durationMs: isNonnegativeInteger(matched.duration) ? matched.duration * 1000 : undefined,
      title: partTitle && partTitle !== videoData.title
        ? `${videoData.title} - ${partTitle}`
        : videoData.title,
    }
  }

  return {
    cid: videoData.cid,
    durationMs: isNonnegativeInteger(videoData.duration) ? videoData.duration * 1000 : undefined,
    title: videoData.title,
  }
}

export function parseBilibiliMainWorldContext(value: unknown): BilibiliMainWorldContext | null {
  if (
    !isRecord(value)
    || typeof value.bvid !== 'string'
    || value.bvid.length === 0
    || !isNonnegativeInteger(value.aid)
    || !isNonnegativeInteger(value.cid)
    || !isNonnegativeInteger(value.page)
    || value.page < 1
    || typeof value.title !== 'string'
    || !isOptionalString(value.author)
    || (value.durationMs !== undefined && !isNonnegativeInteger(value.durationMs))
    || !isOptionalString(value.description)
  ) {
    return null
  }

  return {
    bvid: value.bvid,
    aid: value.aid,
    cid: value.cid,
    page: value.page,
    title: value.title,
    author: value.author,
    durationMs: value.durationMs,
    description: value.description,
  }
}
