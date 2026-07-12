import { AppError } from '../errors/app-error'
import { HIGH_FIDELITY_PROMPT_V1 } from '../prompts/high-fidelity'
import { HighFidelityResponseSchema } from './schemas'
import type { ModelProvider, ModelRequest } from '../core/contracts'
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

export async function processHighFidelity(
  paragraphs: SubtitleParagraph[],
  sourceLanguage: string,
  provider: ModelProvider,
  onProgress?: (progress: ProcessorProgress) => void,
  signal?: AbortSignal,
): Promise<TranslatedParagraph[]> {
  // Chinese subtitles: deterministic pass-through
  if (sourceLanguage.startsWith('zh')) {
    return paragraphs.map(({ id, startMs, endMs, text }) => ({
      id,
      startMs,
      endMs,
      text,
    }))
  }

  // Other languages: translate via model
  const idMap = new Map(paragraphs.map((p) => [p.id, p]))
  const totalChunks = 1

  onProgress?.({ stage: 'translate', completedChunks: 0, totalChunks })

  const request: ModelRequest = {
    messages: [
      { role: 'system', content: HIGH_FIDELITY_PROMPT_V1 },
      {
        role: 'user',
        content: JSON.stringify({
          paragraphs: paragraphs.map(({ id, text }) => ({ id, text })),
        }),
      },
    ],
    responseFormat: 'json',
  }

  const response = await provider.complete(request, signal)
  const body = parseModelResponse(response.content)

  onProgress?.({ stage: 'translate', completedChunks: 1, totalChunks })

  // Validate: correct paragraph IDs, no missing, no extras, no duplicates
  const seenIds = new Set<string>()
  const validated: TranslatedParagraph[] = []

  for (const item of body.paragraphs) {
    if (seenIds.has(item.id)) {
      throw new AppError(
        'MODEL_RESPONSE_INVALID',
        `翻译结果中存在重复段落 ID: ${item.id}`,
      )
    }
    seenIds.add(item.id)

    if (!idMap.has(item.id)) {
      throw new AppError(
        'MODEL_RESPONSE_INVALID',
        `翻译结果中存在未知段落 ID: ${item.id}`,
      )
    }

    const original = idMap.get(item.id)!
    validated.push({
      id: item.id,
      startMs: original.startMs,
      endMs: original.endMs,
      text: item.text,
    })
  }

  // Check for missing IDs
  for (const id of idMap.keys()) {
    if (!seenIds.has(id)) {
      throw new AppError(
        'MODEL_RESPONSE_INVALID',
        `翻译结果缺少段落 ID: ${id}`,
      )
    }
  }

  // Return in original order
  return paragraphs.map((p) => {
    const match = validated.find((v) => v.id === p.id)
    if (!match) {
      throw new AppError(
        'MODEL_RESPONSE_INVALID',
        `翻译结果校验失败`,
      )
    }
    return match
  })
}

function parseModelResponse(content: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型返回格式异常')
  }
  const result = HighFidelityResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new AppError('MODEL_RESPONSE_INVALID', '模型返回结构校验失败')
  }
  return result.data
}
