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

export function buildParagraphs(cues: SubtitleCue[]): SubtitleParagraph[] {
  if (cues.length === 0) return []

  const paragraphs: SubtitleParagraph[] = []
  let currentCues: SubtitleCue[] = [cues[0]!]

  for (let i = 1; i < cues.length; i += 1) {
    const prev = cues[i - 1]!
    const curr = cues[i]!
    const gap = curr.startMs - prev.endMs
    const lastInGroup = currentCues[currentCues.length - 1]!

    const shouldSplit =
      isSentenceEnding(lastInGroup.text) ||
      gap > MAX_GAP_MS

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
