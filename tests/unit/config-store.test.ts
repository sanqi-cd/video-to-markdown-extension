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
  apiKey: 'sk-test-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
}

describe('normalizeBaseUrl', () => {
  it('normalizes an HTTPS base URL by stripping trailing slash', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe(
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
