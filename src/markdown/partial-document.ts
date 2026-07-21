import type {
  ProcessedChunk,
  ProcessedDocument,
  TaskMode,
} from '../core/task-events'
import type { VideoMetadata } from '../core/contracts'
import type { OutputLanguage } from '../core/language'
import type { TranslatedParagraph } from '../processors/high-fidelity'
import type { MapResult, RefinedDocument } from '../processors/refined'

type PartialDocumentInput = {
  metadata: VideoMetadata
  mode: TaskMode
  completedChunks: ProcessedChunk[]
  generatedAt: number
  incompleteChunkCount: number
  paragraphTimestamps?: Record<string, number>
  outputLanguage?: OutputLanguage
}

export type RefinedAnalysisPreview = {
  analyzedChunks: number
  chapterCandidates: string[]
  claims: string[]
  facts: string[]
  people: string[]
  examples: string[]
  conclusions: string[]
}

function isTranslatedParagraph(value: unknown): value is TranslatedParagraph {
  if (typeof value !== 'object' || value === null) return false
  const paragraph = value as Partial<TranslatedParagraph>
  return typeof paragraph.id === 'string'
    && typeof paragraph.startMs === 'number'
    && typeof paragraph.endMs === 'number'
    && typeof paragraph.text === 'string'
}

function isMapResult(value: unknown): value is MapResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Partial<MapResult>
  return Array.isArray(result.chapterCandidates)
    && Array.isArray(result.claims)
    && Array.isArray(result.facts)
    && Array.isArray(result.people)
    && Array.isArray(result.examples)
    && Array.isArray(result.conclusions)
}

function isRefinedDocument(value: unknown): value is RefinedDocument {
  if (typeof value !== 'object' || value === null) return false
  const document = value as Partial<RefinedDocument>
  return typeof document.overview === 'string'
    && Array.isArray(document.coreIdeas)
    && Array.isArray(document.chapters)
    && Array.isArray(document.importantFacts)
    && typeof document.conclusion === 'string'
}

export function visibleCompletedChunks(chunks: ProcessedChunk[]): ProcessedChunk[] {
  return chunks
    .filter((chunk) => chunk.content !== undefined)
    .sort((left, right) => left.index - right.index)
}

export function buildRefinedAnalysisPreview(
  chunks: ProcessedChunk[],
): RefinedAnalysisPreview | null {
  const mapResults = visibleCompletedChunks(chunks)
    .map((chunk) => chunk.content)
    .filter(isMapResult)

  if (mapResults.length === 0) return null

  return {
    analyzedChunks: mapResults.length,
    chapterCandidates: unique(mapResults.flatMap(
      (result) => result.chapterCandidates.map((item) => item.title),
    )),
    claims: unique(mapResults.flatMap(
      (result) => result.claims.map((item) => item.text),
    )),
    facts: unique(mapResults.flatMap(
      (result) => result.facts.map((item) => item.text),
    )),
    people: unique(mapResults.flatMap(
      (result) => result.people.map((item) => item.name),
    )),
    examples: unique(mapResults.flatMap(
      (result) => result.examples.map((item) => item.text),
    )),
    conclusions: unique(mapResults.flatMap(
      (result) => result.conclusions.map((item) => item.text),
    )),
  }
}

export function buildPartialDocument(input: PartialDocumentInput): ProcessedDocument | null {
  const visibleChunks = visibleCompletedChunks(input.completedChunks)

  if (input.mode === 'high-fidelity') {
    const seenParagraphIds = new Set<string>()
    const paragraphs = visibleChunks.flatMap((chunk) => {
      if (!Array.isArray(chunk.content)) return []
      return chunk.content.filter(isTranslatedParagraph)
    }).filter((paragraph) => {
      if (seenParagraphIds.has(paragraph.id)) return false
      seenParagraphIds.add(paragraph.id)
      return true
    })
    if (paragraphs.length === 0) return null
    return {
      metadata: input.metadata,
      mode: 'high-fidelity',
      outputLanguage: input.outputLanguage,
      content: paragraphs,
      generatedAt: input.generatedAt,
      partial: { incompleteChunkCount: input.incompleteChunkCount },
      paragraphTimestamps: input.paragraphTimestamps,
    }
  }

  const refined = [...visibleChunks]
    .reverse()
    .map((chunk) => chunk.content)
    .find(isRefinedDocument)
  if (!refined) return null
  return {
    metadata: input.metadata,
    mode: 'refined',
    outputLanguage: input.outputLanguage,
    content: refined,
    generatedAt: input.generatedAt,
    partial: { incompleteChunkCount: input.incompleteChunkCount },
    paragraphTimestamps: input.paragraphTimestamps,
  }
}

function unique(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}
