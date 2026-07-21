import { AppError } from '../errors/app-error'
import { refinedMapPrompt, refinedReducePrompt } from '../prompts/refined'
import type { OutputLanguage } from '../core/language'
import {
  RefinedMapResponseSchema,
  RefinedReduceResponseSchema,
  RefinedReduceStreamItemSchema,
} from './schemas'
import { NDJSONBuffer, parseNDJSON } from './ndjson'
import type {
  ModelActivity,
  ModelCallContext,
  ModelProvider,
  ModelRequest,
} from '../core/contracts'
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

export type MapResult = {
  chapterCandidates: Array<{ title: string; sourceParagraphIds: string[] }>
  claims: Array<{ text: string; sourceParagraphIds: string[] }>
  facts: Array<{ text: string; sourceParagraphIds: string[] }>
  people: Array<{ name: string; sourceParagraphIds: string[] }>
  examples: Array<{ text: string; sourceParagraphIds: string[] }>
  conclusions: Array<{ text: string; sourceParagraphIds: string[] }>
}

type ReduceStreamItem =
  | { type: 'overview'; text: string }
  | { type: 'core_idea'; text: string }
  | { type: 'chapter'; title: string; body: string; sourceParagraphIds: string[] }
  | { type: 'fact'; text: string; sourceParagraphIds: string[] }
  | { type: 'conclusion'; text: string }

type ReduceAssembly = {
  document: RefinedDocument
  hasOverview: boolean
  hasConclusion: boolean
}

export async function processRefined(
  chunks: ParagraphChunk[],
  provider: ModelProvider,
  onProgress?: (progress: ProcessorProgress) => void,
  signal?: AbortSignal,
  outputLanguage: OutputLanguage = 'zh',
): Promise<RefinedDocument> {
  const mapResults: MapResult[] = []
  for (let i = 0; i < chunks.length; i += 1) {
    onProgress?.({ stage: 'map', completedChunks: i, totalChunks: chunks.length })
    mapResults.push(await processRefinedMapChunk(
      chunks[i]!,
      provider,
      signal,
      undefined,
      outputLanguage,
    ))
  }
  onProgress?.({ stage: 'map', completedChunks: chunks.length, totalChunks: chunks.length })
  onProgress?.({ stage: 'reduce', completedChunks: 0, totalChunks: 1 })

  const reduced = await reduceRefinedMapResults(
    mapResults,
    chunks.flatMap((chunk) => chunk.paragraphs.map((paragraph) => paragraph.id)),
    provider,
    signal,
    undefined,
    outputLanguage,
  )

  onProgress?.({ stage: 'reduce', completedChunks: 1, totalChunks: 1 })
  return reduced
}

export async function processRefinedMapChunk(
  chunk: ParagraphChunk,
  provider: ModelProvider,
  signal?: AbortSignal,
  context?: ModelCallContext,
  outputLanguage: OutputLanguage = 'zh',
): Promise<MapResult> {
  const request = buildMapRequest(chunk, outputLanguage)
  const response = context
    ? await provider.complete(request, signal, context)
    : await provider.complete(request, signal)
  return parseMapResponse(
    response.content,
    new Set(chunk.paragraphs.map((paragraph) => paragraph.id)),
  )
}

export async function reduceRefinedMapResults(
  mapResults: MapResult[],
  sourceParagraphIds: string[],
  provider: ModelProvider,
  signal?: AbortSignal,
  context?: ModelCallContext,
  outputLanguage: OutputLanguage = 'zh',
): Promise<RefinedDocument> {
  const validSourceIds = new Set(sourceParagraphIds)
  const reduceRequest: ModelRequest = {
    messages: [
      { role: 'system', content: refinedReducePrompt(outputLanguage) },
      { role: 'user', content: JSON.stringify({ mapResults }) },
    ],
    responseFormat: 'json',
  }

  const parser = new NDJSONBuffer(RefinedReduceStreamItemSchema)
  const incremental = createReduceAssembly()
  let incrementalError: AppError | null = null
  const acceptIncremental = (items: ReduceStreamItem[]) => {
    if (incrementalError) return
    try {
      for (const item of items) {
        applyReduceItem(incremental, item, validSourceIds)
        context?.onValidatedContent?.(cloneDocument(incremental.document))
      }
    } catch (error) {
      incrementalError = error instanceof AppError
        ? error
        : new AppError('MODEL_RESPONSE_INVALID', 'Reduce 流式内容校验失败')
    }
  }
  const handleActivity = (activity: ModelActivity) => {
    context?.onActivity?.(activity)
    if (activity.type !== 'delta' || incrementalError) return
    const result = parser.push(activity.text)
    if (result.error) {
      incrementalError = new AppError('MODEL_RESPONSE_INVALID', result.error.message)
    } else if (!result.fallback) {
      acceptIncremental(result.records)
    }
  }
  const providerContext = context ? { ...context, onActivity: handleActivity } : undefined
  const response = providerContext
    ? await provider.complete(reduceRequest, signal, providerContext)
    : await provider.complete(reduceRequest, signal)

  if (providerContext) {
    const finalIncrement = parser.finish()
    if (finalIncrement.error) {
      incrementalError = new AppError('MODEL_RESPONSE_INVALID', finalIncrement.error.message)
    } else if (!finalIncrement.fallback) {
      acceptIncremental(finalIncrement.records)
    }
  }
  if (incrementalError) throw incrementalError
  return parseReduceOutput(response.content, validSourceIds)
}

function buildMapRequest(
  chunk: ParagraphChunk,
  outputLanguage: OutputLanguage,
): ModelRequest {
  return {
    messages: [
      { role: 'system', content: refinedMapPrompt(outputLanguage) },
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

function parseMapResponse(content: string, validSourceIds: Set<string>): MapResult {
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
  validateMapResult(result.data, validSourceIds)
  return result.data
}

function validateMapResult(result: MapResult, validSourceIds: Set<string>): void {
  for (const items of [
    result.chapterCandidates,
    result.claims,
    result.facts,
    result.people,
    result.examples,
    result.conclusions,
  ]) {
    for (const item of items) validateSourceIds(item.sourceParagraphIds, validSourceIds)
  }
}

function parseReduceOutput(content: string, validSourceIds: Set<string>): RefinedDocument {
  try {
    const parsed: unknown = JSON.parse(content)
    const legacy = RefinedReduceResponseSchema.safeParse(parsed)
    if (legacy.success) {
      validateRefinedDocument(legacy.data, validSourceIds)
      return legacy.data
    }
    const single = RefinedReduceStreamItemSchema.safeParse(parsed)
    if (single.success) return assembleReduceItems([single.data], validSourceIds)
  } catch (error) {
    if (error instanceof AppError) throw error
    // Multiple NDJSON records are not a single JSON document.
  }

  try {
    return assembleReduceItems(
      parseNDJSON(content, RefinedReduceStreamItemSchema),
      validSourceIds,
    )
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 阶段输出格式异常')
  }
}

function createReduceAssembly(): ReduceAssembly {
  return {
    document: {
      overview: '',
      coreIdeas: [],
      chapters: [],
      importantFacts: [],
      conclusion: '',
    },
    hasOverview: false,
    hasConclusion: false,
  }
}

function assembleReduceItems(
  items: ReduceStreamItem[],
  validSourceIds: Set<string>,
): RefinedDocument {
  const assembly = createReduceAssembly()
  for (const item of items) applyReduceItem(assembly, item, validSourceIds)
  if (!assembly.hasOverview) {
    throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 结果缺少 overview')
  }
  if (!assembly.hasConclusion) {
    throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 结果缺少 conclusion')
  }
  return assembly.document
}

function applyReduceItem(
  assembly: ReduceAssembly,
  item: ReduceStreamItem,
  validSourceIds: Set<string>,
): void {
  switch (item.type) {
    case 'overview':
      if (assembly.hasOverview) {
        throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 结果包含重复 overview')
      }
      assembly.hasOverview = true
      assembly.document.overview = item.text
      break
    case 'core_idea':
      if (assembly.document.coreIdeas.length >= 5) {
        throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 结果的核心观点超过 5 条')
      }
      assembly.document.coreIdeas.push(item.text)
      break
    case 'chapter':
      validateSourceIds(item.sourceParagraphIds, validSourceIds)
      assembly.document.chapters.push({
        title: item.title,
        body: item.body,
        sourceParagraphIds: item.sourceParagraphIds,
      })
      break
    case 'fact':
      validateSourceIds(item.sourceParagraphIds, validSourceIds)
      assembly.document.importantFacts.push({
        text: item.text,
        sourceParagraphIds: item.sourceParagraphIds,
      })
      break
    case 'conclusion':
      if (assembly.hasConclusion) {
        throw new AppError('MODEL_RESPONSE_INVALID', 'Reduce 结果包含重复 conclusion')
      }
      assembly.hasConclusion = true
      assembly.document.conclusion = item.text
      break
  }
}

function validateRefinedDocument(
  document: RefinedDocument,
  validSourceIds: Set<string>,
): void {
  for (const chapter of document.chapters) {
    validateSourceIds(chapter.sourceParagraphIds, validSourceIds)
  }
  for (const fact of document.importantFacts) {
    validateSourceIds(fact.sourceParagraphIds, validSourceIds)
  }
}

function validateSourceIds(ids: string[], validIds: Set<string>): void {
  for (const id of ids) {
    if (!validIds.has(id)) {
      throw new AppError('MODEL_RESPONSE_INVALID', `无效的来源段落 ID: ${id}`)
    }
  }
}

function cloneDocument(document: RefinedDocument): RefinedDocument {
  return {
    overview: document.overview,
    coreIdeas: [...document.coreIdeas],
    chapters: document.chapters.map((chapter) => ({
      ...chapter,
      sourceParagraphIds: [...chapter.sourceParagraphIds],
    })),
    importantFacts: document.importantFacts.map((fact) => ({
      ...fact,
      sourceParagraphIds: [...fact.sourceParagraphIds],
    })),
    conclusion: document.conclusion,
  }
}
