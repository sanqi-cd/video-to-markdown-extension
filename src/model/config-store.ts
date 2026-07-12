import { AppError } from '../errors/app-error'

const STORAGE_KEY = 'modelConfig'

export type ModelConfig = {
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
  const url = new URL(input)
  const isLocal =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(allowLocalhost && isLocal)) {
    throw new AppError('INVALID_MODEL_CONFIG', '必须使用 HTTPS')
  }
  let normalized = url.toString()
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function validateConfig(config: ModelConfig): void {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new AppError('INVALID_MODEL_CONFIG', 'API Key 不能为空')
  }
  if (!config.model || config.model.trim().length === 0) {
    throw new AppError('INVALID_MODEL_CONFIG', '模型名称不能为空')
  }
  if (config.contextWindow < 4096) {
    throw new AppError('INVALID_MODEL_CONFIG', '上下文窗口不能小于 4096')
  }
}

export function createConfigStore(storage: StorageArea): ModelConfigStore {
  return {
    async get() {
      const result = await storage.get([STORAGE_KEY])
      const value = result[STORAGE_KEY]
      if (value && typeof value === 'object') {
        return value as ModelConfig
      }
      return null
    },
    async set(config) {
      validateConfig(config)
      await storage.set({ [STORAGE_KEY]: config })
    },
    async clear() {
      await storage.remove([STORAGE_KEY])
    },
  }
}
