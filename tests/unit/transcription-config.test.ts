import { describe, expect, it } from 'vitest'
import {
  createTranscriptionConfigStore,
  normalizeTranscriptionConfig,
  normalizeTranscriptionEndpoint,
} from '../../src/transcription/config-store'
import type { StorageArea } from '../../src/model/config-store'

function memoryStorage(): StorageArea {
  const values: Record<string, unknown> = {}
  return {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]))
    },
    async set(items) { Object.assign(values, items) },
    async remove(keys) { for (const key of keys) delete values[key] },
  }
}

const config = {
  version: 1 as const,
  endpoint: 'https://api.openai.com/v1/audio/transcriptions',
  apiKey: 'sk-test',
  model: 'whisper-1',
  language: 'auto' as const,
  chunkSeconds: 30,
}

describe('transcription config', () => {
  it('allows HTTPS and local HTTP endpoints only', () => {
    expect(normalizeTranscriptionEndpoint('https://speech.example.com/v1/audio/transcriptions/'))
      .toBe('https://speech.example.com/v1/audio/transcriptions')
    expect(normalizeTranscriptionEndpoint('http://localhost:8000/v1/audio/transcriptions'))
      .toBe('http://localhost:8000/v1/audio/transcriptions')
    expect(() => normalizeTranscriptionEndpoint('http://speech.example.com/transcribe'))
      .toThrow('必须使用 HTTPS')
  })

  it('validates the chunk duration', () => {
    expect(() => normalizeTranscriptionConfig({ ...config, chunkSeconds: 5 }))
      .toThrow()
  })

  it('persists and restores a normalized config', async () => {
    const store = createTranscriptionConfigStore(memoryStorage())
    await store.set({ ...config, apiKey: ' sk-test ', model: ' whisper-1 ' })
    await expect(store.get()).resolves.toEqual(config)
  })
})
