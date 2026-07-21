import { describe, expect, it } from 'vitest'
import { createPreferencesStore } from '../../src/storage/preferences'
import type { StorageArea } from '../../src/model/config-store'

function memoryStorage(initial: Record<string, unknown> = {}): StorageArea {
  const data = { ...initial }
  return {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
    },
    async set(items) {
      Object.assign(data, items)
    },
    async remove(keys) {
      for (const key of keys) delete data[key]
    },
  }
}

describe('preferences store', () => {
  it('returns safe defaults for corrupted data', async () => {
    const store = createPreferencesStore(memoryStorage({
      userPreferences: { mode: 'unsupported', includeTimestamps: 'yes' },
    }))

    await expect(store.get()).resolves.toEqual({
      selectedTrackId: null,
      mode: 'high-fidelity',
      includeTimestamps: false,
      outputLanguage: 'zh',
      lastProviderId: 'deepseek',
    })
  })

  it('persists preference updates without dropping other values', async () => {
    const store = createPreferencesStore(memoryStorage())
    await store.set({ mode: 'refined' })
    await store.set({
      includeTimestamps: true,
      selectedTrackId: '.zh-Hans',
      outputLanguage: 'en',
      lastProviderId: 'openrouter',
    })

    await expect(store.get()).resolves.toEqual({
      selectedTrackId: '.zh-Hans',
      mode: 'refined',
      includeTimestamps: true,
      outputLanguage: 'en',
      lastProviderId: 'openrouter',
    })
  })

  it('migrates preferences created before provider selection was added', async () => {
    const store = createPreferencesStore(memoryStorage({
      userPreferences: {
        selectedTrackId: '.en',
        mode: 'refined',
        includeTimestamps: true,
      },
    }))

    await expect(store.get()).resolves.toEqual({
      selectedTrackId: '.en',
      mode: 'refined',
      includeTimestamps: true,
      outputLanguage: 'zh',
      lastProviderId: 'deepseek',
    })
  })
})
