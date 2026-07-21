import { AppError } from '../errors/app-error'
import { highFidelityPrompt } from '../prompts/high-fidelity'
import { isSameLanguage, type OutputLanguage } from '../core/language'
import {
  HighFidelityResponseSchema,
  HighFidelityStreamItemSchema,
} from './schemas'
import { NDJSONBuffer, parseNDJSON } from './ndjson'
import type {
  ModelActivity,
  ModelCallContext,
  ModelProvider,
  ModelRequest,
} from '../core/contracts'
import type { SubtitleParagraph } from './paragraphs'

export type TranslatedParagraph = {
  id: string
  startMs: number
  endMs: number
  text: string
}

export type ProcessorProgress = {
  stage: 'translate' | 'map' | 'reduce'
  completedChunks: number
  totalChunks: number
}

type ParagraphResult = { id: string; text: string }
type StreamParagraph = { type: 'paragraph'; id: string; text: string }

export async function processHighFidelity(
  paragraphs: SubtitleParagraph[],
  sourceLanguage: string,
  provider: ModelProvider,
  onProgress?: (progress: ProcessorProgress) => void,
  signal?: AbortSignal,
  context?: ModelCallContext,
  outputLanguage: OutputLanguage = 'zh',
): Promise<TranslatedParagraph[]> {
  if (isSameLanguage(sourceLanguage, outputLanguage)) {
    return paragraphs.map(({ id, startMs, endMs, text }) => ({
      id,
      startMs,
      endMs,
      text,
    }))
  }

  const totalChunks = 1
  onProgress?.({ stage: 'translate', completedChunks: 0, totalChunks })

  const request: ModelRequest = {
    messages: [
      { role: 'system', content: highFidelityPrompt(outputLanguage) },
      {
        role: 'user',
        content: JSON.stringify({
          paragraphs: paragraphs.map(({ id, text }) => ({ id, text })),
        }),
      },
    ],
    responseFormat: 'json',
  }

  const parser = new NDJSONBuffer(HighFidelityStreamItemSchema)
  const incrementalItems: ParagraphResult[] = []
  let incrementalError: AppError | null = null
  const acceptIncremental = (items: StreamParagraph[]) => {
    if (incrementalError) return
    for (const item of items) {
      const original = paragraphs[incrementalItems.length]
      if (!paragraphs.some((paragraph) => paragraph.id === item.id)) {
        incrementalError = new AppError(
          'MODEL_RESPONSE_INVALID',
          `翻译结果中存在未知段落 ID: ${item.id}`,
        )
        return
      }
      if (incrementalItems.some((existing) => existing.id === item.id)) {
        incrementalError = new AppError(
          'MODEL_RESPONSE_INVALID',
          `翻译结果中存在重复段落 ID: ${item.id}`,
        )
        return
      }
      if (!original || original.id !== item.id) {
        incrementalError = new AppError('MODEL_RESPONSE_INVALID', '翻译结果段落顺序异常')
        return
      }
      incrementalItems.push({ id: item.id, text: item.text })
      context?.onValidatedContent?.(toTranslated(incrementalItems, paragraphs))
    }
  }
  const handleActivity = (activity: ModelActivity) => {
    context?.onActivity?.(activity)
    if (activity.type !== 'delta' || incrementalError) return
    const result = parser.push(activity.text)
    if (result.error) {
      incrementalError = new AppError('MODEL_RESPONSE_INVALID', result.error.message)
      return
    }
    if (!result.fallback) acceptIncremental(result.records)
  }
  const providerContext = context ? { ...context, onActivity: handleActivity } : undefined

  const response = providerContext
    ? await provider.complete(request, signal, providerContext)
    : await provider.complete(request, signal)

  if (providerContext) {
    const finalIncrement = parser.finish()
    if (finalIncrement.error) {
      incrementalError = new AppError('MODEL_RESPONSE_INVALID', finalIncrement.error.message)
    } else if (!finalIncrement.fallback) {
      acceptIncremental(finalIncrement.records)
    }
  }
  if (incrementalError) throw incrementalError

  const items = parseHighFidelityOutput(response.content)
  const translated = validateParagraphResults(items, paragraphs)
  onProgress?.({ stage: 'translate', completedChunks: 1, totalChunks })
  return translated
}

function parseHighFidelityOutput(content: string): ParagraphResult[] {
  try {
    const parsed: unknown = JSON.parse(content)
    const legacy = HighFidelityResponseSchema.safeParse(parsed)
    if (legacy.success) return legacy.data.paragraphs
    const single = HighFidelityStreamItemSchema.safeParse(parsed)
    if (single.success) return [{ id: single.data.id, text: single.data.text }]
  } catch {
    // Multiple NDJSON records are not a single JSON document.
  }

  try {
    return parseNDJSON(content, HighFidelityStreamItemSchema).map((item) => ({
      id: item.id,
      text: item.text,
    }))
  } catch {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型返回格式异常')
  }
}

function validateParagraphResults(
  items: ParagraphResult[],
  paragraphs: SubtitleParagraph[],
): TranslatedParagraph[] {
  const expected = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  const seen = new Set<string>()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (seen.has(item.id)) {
      throw new AppError('MODEL_RESPONSE_INVALID', `翻译结果中存在重复段落 ID: ${item.id}`)
    }
    if (!expected.has(item.id)) {
      throw new AppError('MODEL_RESPONSE_INVALID', `翻译结果中存在未知段落 ID: ${item.id}`)
    }
    if (paragraphs[index]?.id !== item.id) {
      throw new AppError('MODEL_RESPONSE_INVALID', '翻译结果段落顺序异常')
    }
    seen.add(item.id)
  }

  for (const paragraph of paragraphs) {
    if (!seen.has(paragraph.id)) {
      throw new AppError('MODEL_RESPONSE_INVALID', `翻译结果缺少段落 ID: ${paragraph.id}`)
    }
  }
  return toTranslated(items, paragraphs)
}

function toTranslated(
  items: ParagraphResult[],
  paragraphs: SubtitleParagraph[],
): TranslatedParagraph[] {
  return items.map((item) => {
    const original = paragraphs.find((paragraph) => paragraph.id === item.id)!
    return {
      id: item.id,
      startMs: original.startMs,
      endMs: original.endMs,
      text: item.text,
    }
  })
}
