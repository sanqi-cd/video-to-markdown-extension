import { describe, expect, it } from 'vitest'
import { normalizeBaseUrl, createConfigStore } from '../../src/model/config-store'
import type { StorageArea, ModelConfig } from '../../src/model/config-store'

function createMemoryStore(initial: Record<string, unknown> = {}): StorageArea {
  const data = structuredClone(initial)
  return {
    async get(keys) {
      const result: Record<string, unknown> = {}
      for (const k of keys) {
        if (k in data) result[k] = data[k]
      }
      return result
    },
    async set(items) {
      Object.assign(data, items)
    },
    async remove(keys) {
      for (const k of keys) delete data[k]
    },
  }
}

const validConfig: ModelConfig = {
  version: 2,
  providerId: 'openai',
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
  streamMode: 'auto',
}

describe('normalizeBaseUrl', () => {
  it('normalizes an HTTPS base URL by stripping trailing slash', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe(
      'https://api.example.com/v1',
    )
  })

  it('strips a pasted chat completions endpoint and duplicate v1 suffixes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1',
    )
    expect(normalizeBaseUrl('https://api.example.com/v1/v1/')).toBe(
      'https://api.example.com/v1',
    )
  })

  it('rejects non-HTTPS remote endpoints', () => {
    expect(() => normalizeBaseUrl('http://api.example.com/v1')).toThrow(
      '必须使用 HTTPS',
    )
  })

  it('allows localhost in dev mode', () => {
    expect(normalizeBaseUrl('http://localhost:8080/v1', true)).toBe(
      'http://localhost:8080/v1',
    )
  })

  it('allows 127.0.0.1 in dev mode', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:3000/v1/', true)).toBe(
      'http://127.0.0.1:3000/v1',
    )
  })
})

describe('ModelConfigStore', () => {
  it('saves and retrieves a config', async () => {
    const store = createConfigStore(createMemoryStore())
    await store.set(validConfig)
    const result = await store.get()
    expect(result).toEqual(validConfig)
  })

  it('returns null when no config is stored', async () => {
    const store = createConfigStore(createMemoryStore())
    const result = await store.get()
    expect(result).toBeNull()
  })

  it('returns null for a corrupted stored config', async () => {
    const store = createConfigStore(createMemoryStore({
      modelConfig: { apiKey: 'sk-test', baseUrl: 'javascript:alert(1)', model: 'x' },
    }))

    await expect(store.get()).resolves.toBeNull()
  })

  it('does not reinterpret an invalid declared V2 config as legacy', async () => {
    const store = createConfigStore(createMemoryStore({
      modelConfig: { ...validConfig, providerId: 'unknown-provider' },
    }))
    await expect(store.get()).resolves.toBeNull()
  })

  it('migrates and re-saves V1 config without changing the API key', async () => {
    const storage = createMemoryStore({
      modelConfig: {
        apiKey: 'sk-legacy-secret',
        baseUrl: 'https://api.openai.com/v1/',
        model: 'gpt-4o-mini',
        contextWindow: 128000,
      },
    })
    const store = createConfigStore(storage)

    await expect(store.get()).resolves.toEqual({
      version: 2,
      providerId: 'openai',
      apiKey: 'sk-legacy-secret',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      contextWindow: 128000,
      streamMode: 'auto',
    })
    const persisted = await storage.get(['modelConfig'])
    expect(persisted.modelConfig).toMatchObject({
      version: 2,
      apiKey: 'sk-legacy-secret',
      providerId: 'openai',
    })
  })

  it('normalizes values before persisting', async () => {
    const store = createConfigStore(createMemoryStore())
    await store.set({
      ...validConfig,
      apiKey: '  sk-test-key  ',
      baseUrl: 'https://api.example.com/v1/',
      model: '  model-name  ',
    })

    await expect(store.get()).resolves.toEqual({
      ...validConfig,
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-name',
    })
  })

  it('rejects an empty API key', async () => {
    const store = createConfigStore(createMemoryStore())
    await expect(
      store.set({ ...validConfig, apiKey: '' }),
    ).rejects.toThrow('API Key 不能为空')
  })

  it('rejects an empty model name', async () => {
    const store = createConfigStore(createMemoryStore())
    await expect(
      store.set({ ...validConfig, model: '' }),
    ).rejects.toThrow('模型名称不能为空')
  })

  it('rejects a context window below 4096', async () => {
    const store = createConfigStore(createMemoryStore())
    await expect(
      store.set({ ...validConfig, contextWindow: 2048 }),
    ).rejects.toThrow('上下文窗口不能小于 4096')
  })

  it('clears the stored config', async () => {
    const store = createConfigStore(createMemoryStore())
    await store.set(validConfig)
    await store.clear()
    const result = await store.get()
    expect(result).toBeNull()
  })
})
