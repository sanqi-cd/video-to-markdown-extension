import { AppError } from '../errors/app-error'
import { REFINED_MAP_PROMPT_V1, REFINED_REDUCE_PROMPT_V1 } from '../prompts/refined'
import { RefinedMapResponseSchema, RefinedReduceResponseSchema } from './schemas'
import type { ModelProvider, ModelRequest } from '../core/contracts'
import type { ParagraphChunk } from './chunk'
import type { ProcessorProgress } from './high-fidelity'

export type RefinedChapter = {
  title: string
  body: string
  sourceParagraphIds: string[]
}

export type RefinedDocument = {
  overview: string
  coreIdeas: string[]
  chapters: RefinedChapter[]
  importantFacts: Array<{ text: string; sourceParagraphIds: string[] }>
  conclusion: string
}

type MapResult = {
  chapterCandidates: Array<{ title: string; sourceParagraphIds: string[] }>
  claims: Array<{ text: string; sourceParagraphIds: string[] }>
  facts: Array<{ text: string; sourceParagraphIds: string[] }>
  people: Array<{ name: string; sourceParagraphIds: string[] }>
  examples: Array<{ text: string; sourceParagraphIds: string[] }>
  conclusions: Array<{ text: string; sourceParagraphIds: string[] }>
}

export async function processRefined(
  chunks: ParagraphChunk[],
  provider: ModelProvider,
  onProgress?: (progress: ProcessorProgress) => void,
  signal?: AbortSignal,
): Promise<RefinedDocument> {
  // Phase 1: Map — extract structured info from each chunk
  const mapResults: MapResult[] = []
  for (let i = 0; i < chunks.length; i += 1) {
    onProgress?.({ stage: 'map', completedChunks: i, totalChunks: chunks.length })

    const chunk = chunks[i]!
    const response = await provider.complete(buildMapRequest(chunk), signal)
    mapResults.push(parseMapResponse(response.content))
  }
  onProgress?.({ stage: 'map', completedChunks: chunks.length, totalChunks: chunks.length })

  // Phase 2: Reduce — merge all map results
  onProgress?.({ stage: 'reduce', completedChunks: 0, totalChunks: 1 })

  const validSourceIds = new Set(
    chunks.flatMap((c) => c.paragraphs.map((p) => p.id)),
  )

  const reduceRequest: ModelRequest = {
    messages: [
      { role: 'system', content: REFINED_REDUCE_PROMPT_V1 },
      { role: 'user', content: JSON.stringify({ mapResults }) },
    ],
    responseFormat: 'json',
  }

  const response = await provider.complete(reduceRequest, signal)
  const reduced = parseReduceResponse(response.content)

  onProgress?.({ stage: 'reduce', completedChunks: 1, totalChunks: 1 })

  // Validate source IDs in reduce output
  for (const chapter of reduced.chapters) {
    validateSourceIds(chapter.sourceParagraphIds, validSourceIds)
  }
  for (const fact of reduced.importantFacts) {
    validateSourceIds(fact.sourceParagraphIds, validSourceIds)
  }

  return reduced
}

function buildMapRequest(chunk: ParagraphChunk): ModelRequest {
  return {
    messages: [
      { role: 'system', content: REFINED_MAP_PROMPT_V1 },
      {
        role: 'user',
        content: JSON.stringify({
          paragraphs: chunk.paragraphs.map(({ id, text }) => ({ id, text })),
        }),
      },
    ],
    responseFormat: 'json',
  }
}

function parseMapResponse(content: string): MapResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型返回格式异常')
  }
  const result = RefinedMapResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new AppError('MODEL_RESPONSE_INVALID', 'Map 阶段输出结构校验失败')
  }
  return result.data
}

function parseReduceResponse(content: string): RefinedDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型返回格式异常')
  }
  const result = RefinedReduceResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 阶段输出结构校验失败')
  }
  return result.data
}

function validateSourceIds(ids: string[], validIds: Set<string>): void {
  for (const id of ids) {
    if (!validIds.has(id)) {
      throw new AppError(
        'MODEL_RESPONSE_INVALID',
        `无效的来源段落 ID: ${id}`,
      )
    }
  }
}
