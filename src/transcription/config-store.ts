import { z } from 'zod'
import { AppError } from '../errors/app-error'
import type { StorageArea } from '../model/config-store'
import type { TranscriptionConfig } from './contracts'

const STORAGE_KEY = 'transcriptionConfig'
export const DEFAULT_TRANSCRIPTION_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions'
export const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1'
export const ARK_TRANSCRIPTION_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/responses'
export const ARK_TRANSCRIPTION_MODEL = 'doubao-seed-2-0-lite-260428'

const ConfigSchema = z.object({
  version: z.literal(1),
  protocol: z.enum(['openai-transcription', 'ark-responses']).optional(),
  endpoint: z.string().trim().min(1, '转录接口不能为空'),
  apiKey: z.string().trim().min(1, '转录 API Key 不能为空'),
  model: z.string().trim().min(1, '转录模型不能为空'),
  language: z.enum(['auto', 'zh', 'en']),
  chunkSeconds: z.number().int().min(15).max(120),
})

export interface TranscriptionConfigStore {
  get(): Promise<TranscriptionConfig | null>
  set(config: TranscriptionConfig): Promise<void>
  clear(): Promise<void>
}

export function normalizeTranscriptionEndpoint(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new AppError('INVALID_TRANSCRIPTION_CONFIG', '转录接口 URL 格式无效')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new AppError('INVALID_TRANSCRIPTION_CONFIG', '转录接口必须使用 HTTPS')
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_TRANSCRIPTION_CONFIG', '转录接口不能包含账号或密码')
  }
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

export async function requestTranscriptionOrigin(
  endpoint: string,
  request: (permissions: { origins: string[] }) => Promise<boolean>,
): Promise<boolean> {
  const origin = new URL(normalizeTranscriptionEndpoint(endpoint)).origin
  return request({ origins: [`${origin}/*`] })
}

export function normalizeTranscriptionConfig(input: unknown): TranscriptionConfig {
  const parsed = ConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError(
      'INVALID_TRANSCRIPTION_CONFIG',
      parsed.error.issues[0]?.message ?? '转录配置无效',
    )
  }
  return {
    ...parsed.data,
    endpoint: normalizeTranscriptionEndpoint(parsed.data.endpoint),
    apiKey: parsed.data.apiKey.trim(),
    model: parsed.data.model.trim(),
  }
}

export function createTranscriptionConfigStore(
  storage: StorageArea,
): TranscriptionConfigStore {
  return {
    async get() {
      const result = await storage.get([STORAGE_KEY])
      if (!result[STORAGE_KEY]) return null
      try {
        return normalizeTranscriptionConfig(result[STORAGE_KEY])
      } catch {
        return null
      }
    },
    async set(config) {
      await storage.set({ [STORAGE_KEY]: normalizeTranscriptionConfig(config) })
    },
    async clear() {
      await storage.remove([STORAGE_KEY])
    },
  }
}
