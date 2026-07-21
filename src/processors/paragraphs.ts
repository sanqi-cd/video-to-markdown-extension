import type { SubtitleCue } from '../core/contracts'

export type SubtitleParagraph = {
  id: string
  startMs: number
  endMs: number
  cueIds: string[]
  text: string
}

const SENTENCE_ENDING = new Set(['.', '!', '?', '。', '！', '？', '…', '…'])

function isSentenceEnding(text: string): boolean {
  const trimmed = text.trimEnd()
  if (trimmed.length === 0) return false
  return SENTENCE_ENDING.has(trimmed[trimmed.length - 1]!)
}

const MAX_GAP_MS = 1500
export const MAX_PARAGRAPH_CHARS = 600

export function buildParagraphs(cues: SubtitleCue[]): SubtitleParagraph[] {
  if (cues.length === 0) return []

  const expandedCues = cues.flatMap(splitLongCue)

  const paragraphs: SubtitleParagraph[] = []
  let currentCues: SubtitleCue[] = [expandedCues[0]!]

  for (let i = 1; i < expandedCues.length; i += 1) {
    const prev = expandedCues[i - 1]!
    const curr = expandedCues[i]!
    const gap = curr.startMs - prev.endMs
    const lastInGroup = currentCues[currentCues.length - 1]!

    const shouldSplit =
      isSentenceEnding(lastInGroup.text) ||
      gap > MAX_GAP_MS ||
      paragraphLength(currentCues) + 1 + curr.text.length > MAX_PARAGRAPH_CHARS

    if (shouldSplit) {
      paragraphs.push(createParagraph(currentCues))
      currentCues = [curr]
    } else {
      currentCues.push(curr)
    }
  }

  // Flush remaining cues
  if (currentCues.length > 0) {
    paragraphs.push(createParagraph(currentCues))
  }

  return paragraphs
}

function paragraphLength(cues: SubtitleCue[]): number {
  return cues.reduce((length, cue, index) => length + cue.text.length + (index > 0 ? 1 : 0), 0)
}

function splitLongCue(cue: SubtitleCue): SubtitleCue[] {
  if (cue.text.length <= MAX_PARAGRAPH_CHARS) return [cue]
  const parts: SubtitleCue[] = []
  let remaining = cue.text
  let index = 0
  while (remaining.length > 0) {
    let splitAt = Math.min(MAX_PARAGRAPH_CHARS, remaining.length)
    if (splitAt < remaining.length) {
      const whitespace = remaining.lastIndexOf(' ', splitAt)
      if (whitespace >= Math.floor(MAX_PARAGRAPH_CHARS * 0.6)) splitAt = whitespace
    }
    const text = remaining.slice(0, splitAt).trim()
    if (text) {
      const ratioStart = parts.reduce((sum, part) => sum + part.text.length, 0) / cue.text.length
      const ratioEnd = Math.min(1, (ratioStart * cue.text.length + text.length) / cue.text.length)
      parts.push({
        ...cue,
        id: `${cue.id}#${index}`,
        startMs: Math.round(cue.startMs + (cue.endMs - cue.startMs) * ratioStart),
        endMs: Math.round(cue.startMs + (cue.endMs - cue.startMs) * ratioEnd),
        text,
      })
      index += 1
    }
    remaining = remaining.slice(splitAt).trimStart()
  }
  return parts
}

function createParagraph(cues: SubtitleCue[]): SubtitleParagraph {
  const first = cues[0]!
  const last = cues[cues.length - 1]!
  return {
    id: `${first.id}-${last.id}`,
    startMs: first.startMs,
    endMs: last.endMs,
    cueIds: cues.map((c) => c.id),
    text: cues.map((c) => c.text).join(' '),
  }
}
