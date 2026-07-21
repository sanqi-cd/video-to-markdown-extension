import type { SubtitleCue } from '../core/contracts'

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp|#160);/g,
    (match) => ENTITY_MAP[match] ?? match,
  )
}

function normalizeText(text: string): string {
  let result = decodeEntities(text)
  result = result.replace(/\s+/g, ' ')
  result = result.trim()
  return result
}

function removeWordOverlap(prev: string, curr: string): string {
  const prevWords = prev.split(/\s+/)
  const currWords = curr.split(/\s+/)
  const maxOverlap = Math.min(prevWords.length, currWords.length)

  for (let len = maxOverlap; len > 0; len -= 1) {
    const prevSuffix = prevWords.slice(-len)
    const currPrefix = currWords.slice(0, len)
    if (prevSuffix.length === currPrefix.length &&
        prevSuffix.every((w, i) => w === currPrefix[i])) {
      return currWords.slice(len).join(' ')
    }
  }

  return curr
}

export function normalizeCues(cues: SubtitleCue[]): SubtitleCue[] {
  if (cues.length === 0) return []

  // Step 1: Normalize text (decode entities, whitespace, trim)
  const cleaned = cues.map((cue) => ({
    ...cue,
    text: normalizeText(cue.text),
  }))

  // Step 2: Remove empty cues
  const nonEmpty = cleaned.filter((cue) => cue.text.length > 0)

  // Step 3: Remove only adjacent/overlapping duplicates. Repeated phrases much
  // later in the video are legitimate content and must be preserved.
  const deduped: SubtitleCue[] = []
  for (const cue of nonEmpty) {
    const previous = deduped[deduped.length - 1]
    const isNearbyDuplicate = previous?.text === cue.text
      && cue.startMs <= previous.endMs + 1_500
    if (!isNearbyDuplicate) deduped.push(cue)
  }

  if (deduped.length <= 1) return deduped

  // Step 4: Remove rolling caption overlap
  const result: SubtitleCue[] = [deduped[0]!]
  for (let i = 1; i < deduped.length; i += 1) {
    const prev = result[result.length - 1]!
    const curr = deduped[i]!
    const isRollingWindow = curr.startMs <= prev.endMs + 1_500
    const dedupedText = isRollingWindow
      ? removeWordOverlap(prev.text, curr.text)
      : curr.text
    if (dedupedText.length > 0) {
      result.push({ ...curr, text: dedupedText })
    }
    // If overlap removed everything, skip this cue entirely
  }

  return result
}
