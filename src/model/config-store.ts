import { AppError } from '../errors/app-error'
import { inferProviderId, type ProviderId } from './provider-presets'
import { z } from 'zod'

const STORAGE_KEY = 'modelConfig'

export type ModelTestRecord = {
  status: 'success' | 'failed'
  testedAt: number
  latencyMs?: number
}

export type ModelConfig = {
  version: 2
  providerId: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  contextWindow: number
  streamMode: 'auto' | 'on' | 'off'
  lastTest?: ModelTestRecord
}

export type LegacyModelConfig = {
  apiKey: string
  baseUrl: string
  model: string
  contextWindow: number
}

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface ModelConfigStore {
  get(): Promise<ModelConfig | null>
  set(config: ModelConfig): Promise<void>
  clear(): Promise<void>
}

export function normalizeBaseUrl(input: string, allowLocalhost = false): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new AppError('INVALID_MODEL_CONFIG', 'Base URL 格式无效')
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(allowLocalhost && isLocal)) {
    throw new AppError('INVALID_MODEL_CONFIG', '必须使用 HTTPS')
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_MODEL_CONFIG', 'Base URL 不能包含账号或密码')
  }

  url.search = ''
  url.hash = ''
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/chat\/completions$/i, '')
  path = path.replace(/(?:\/v1){2,}$/i, '/v1')
  url.pathname = path || '/'

  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`
}

const LegacyModelConfigSchema = z.object({
  apiKey: z.string().trim().min(1, 'API Key 不能为空'),
  baseUrl: z.string().trim().min(1, 'Base URL 不能为空'),
  model: z.string().trim().min(1, '模型名称不能为空'),
  contextWindow: z.number().int().min(4096, '上下文窗口不能小于 4096'),
})

const ModelConfigV2Schema = LegacyModelConfigSchema.extend({
  version: z.literal(2),
  providerId: z.enum(['deepseek', 'openai', 'openrouter', 'custom']),
  streamMode: z.enum(['auto', 'on', 'off']),
  lastTest: z.object({
    status: z.enum(['success', 'failed']),
    testedAt: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative().optional(),
  }).optional(),
})

export function normalizeModelConfig(input: unknown): ModelConfig {
  const v2 = ModelConfigV2Schema.safeParse(input)
  if (v2.success) {
    return {
      ...v2.data,
      baseUrl: normalizeBaseUrl(v2.data.baseUrl),
    }
  }

  const declaresV2 = typeof input === 'object'
    && input !== null
    && (input as { version?: unknown }).version === 2
  if (declaresV2) {
    throw new AppError(
      'INVALID_MODEL_CONFIG',
      v2.error.issues[0]?.message ?? '模型配置无效',
    )
  }

  const legacy = LegacyModelConfigSchema.safeParse(input)
  if (!legacy.success) {
    throw new AppError(
      'INVALID_MODEL_CONFIG',
      legacy.error.issues[0]?.message ?? '模型配置无效',
    )
  }

  const baseUrl = normalizeBaseUrl(legacy.data.baseUrl)
  return {
    version: 2,
    providerId: inferProviderId(baseUrl),
    ...legacy.data,
    baseUrl,
    streamMode: 'auto',
  }
}

export function createConfigStore(storage: StorageArea): ModelConfigStore {
  return {
    async get() {
      const result = await storage.get([STORAGE_KEY])
      const value = result[STORAGE_KEY]
      if (!value || typeof value !== 'object') return null
      try {
        const normalized = normalizeModelConfig(value)
        if ((value as { version?: unknown }).version !== 2) {
          await storage.set({ [STORAGE_KEY]: normalized })
        }
        return normalized
      } catch {
        return null
      }
    },
    async set(config) {
      await storage.set({ [STORAGE_KEY]: normalizeModelConfig(config) })
    },
    async clear() {
      await storage.remove([STORAGE_KEY])
    },
  }
}
