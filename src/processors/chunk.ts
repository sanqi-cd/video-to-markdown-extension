import { AppError } from '../errors/app-error'
import type { SubtitleParagraph } from './paragraphs'

export type ParagraphChunk = {
  id: string
  paragraphs: SubtitleParagraph[]
  inputChars: number
}

export type ChunkOptions = {
  maxInputChars: number
  overlapParagraphs: number
  /** Split when a chunk's subtitle time span exceeds this, even if under the char budget. */
  maxSpanMs?: number
}

/** Default cap so a long interview is never one giant model request. */
export const DEFAULT_MAX_SPAN_MS = 180_000

export function chunkParagraphs(
  paragraphs: SubtitleParagraph[],
  options: ChunkOptions,
): ParagraphChunk[] {
  const { maxInputChars, overlapParagraphs, maxSpanMs } = options

  // Validate: no single paragraph exceeds the budget
  for (const p of paragraphs) {
    if (p.text.length > maxInputChars) {
      throw new AppError(
        'MODEL_CONTEXT_EXCEEDED',
        '单个自然段超出模型上下文窗口',
      )
    }
  }

  const chunks: ParagraphChunk[] = []
  let current: SubtitleParagraph[] = []
  let currentChars = 0

  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i]!
    const spanWouldExceed = maxSpanMs !== undefined
      && current.length > 0
      && (p.endMs - current[0]!.startMs > maxSpanMs)

    // Check if adding this paragraph would exceed budget
    if ((currentChars + p.text.length > maxInputChars || spanWouldExceed) && current.length > 0) {
      chunks.push({
        id: `chunk-${chunks.length}`,
        paragraphs: current,
        inputChars: currentChars,
      })

      // Start new chunk with overlap from previous chunk
      const tail =
        overlapParagraphs > 0
          ? current.slice(-overlapParagraphs)
          : []
      current = [...tail]
      currentChars = tail.reduce((sum, tp) => sum + tp.text.length, 0)
    }

    current.push(p)
    currentChars += p.text.length
  }

  // Flush remaining
  if (current.length > 0) {
    chunks.push({
      id: `chunk-${chunks.length}`,
      paragraphs: current,
      inputChars: currentChars,
    })
  }

  return chunks
}
