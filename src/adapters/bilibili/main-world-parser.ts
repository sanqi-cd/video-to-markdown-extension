import {
  isNonnegativeInteger,
  isOptionalString,
  isRecord,
} from '../shared/value-guards'

export interface BilibiliMainWorldContext {
  bvid: string
  aid: number
  cid: number
  title: string
  author?: string
  durationMs?: number
}

export function parseBilibiliMainWorldContext(value: unknown): BilibiliMainWorldContext | null {
  if (
    !isRecord(value)
    || typeof value.bvid !== 'string'
    || value.bvid.length === 0
    || !isNonnegativeInteger(value.aid)
    || !isNonnegativeInteger(value.cid)
    || typeof value.title !== 'string'
    || !isOptionalString(value.author)
    || (value.durationMs !== undefined && !isNonnegativeInteger(value.durationMs))
  ) {
    return null
  }

  return {
    bvid: value.bvid,
    aid: value.aid,
    cid: value.cid,
    title: value.title,
    author: value.author,
    durationMs: value.durationMs,
  }
}
