import { describe, expect, it, vi } from 'vitest'
import { createMessageRouter } from '../../src/core/messages'
import type { ModelConfig, ModelConfigStore } from '../../src/model/config-store'
import type { ModelProvider } from '../../src/core/contracts'

function mockConfigStore(saved: ModelConfig | null): ModelConfigStore {
  let config = saved
  return {
    get: vi.fn().mockResolvedValue(config),
    set: vi.fn().mockImplementation(async (c: ModelConfig) => {
      config = c
    }),
    clear: vi.fn().mockImplementation(async () => {
      config = null
    }),
  }
}

function mockProvider(): ModelProvider {
  return {
    testConnection: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue({ content: 'ok' }),
  }
}

const CONTENT_SENDER = { url: 'https://www.youtube.com/watch?v=test123' }
const EXTENSION_SENDER = { url: 'chrome-extension://abc123/sidepanel.html' }

const testConfig: ModelConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
}

describe('message router', () => {
  it('rejects an unknown message type', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(null),
      isExtensionOrigin: () => true,
    })

    await expect(
      router({ type: 'FETCH_ANY_URL', url: 'https://evil.test' }, EXTENSION_SENDER),
    ).rejects.toBeDefined()
  })

  it('rejects MODEL_TEST_REQUEST from a content script sender', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(null),
      isExtensionOrigin: () => false,
    })

    await expect(
      router({ type: 'MODEL_TEST_REQUEST' }, CONTENT_SENDER),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_CONFIG' })
  })

  it('allows VIDEO_CONTEXT_REQUEST from a content script', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(null),
      isExtensionOrigin: () => false,
    })

    const result = await router(
      { type: 'VIDEO_CONTEXT_REQUEST' },
      CONTENT_SENDER,
    )
    expect(result).toBeDefined()
  })

  it('handles MODEL_TEST_REQUEST from extension with mock provider', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider: () => mockProvider(),
    })

    const result = await router(
      { type: 'MODEL_TEST_REQUEST' },
      EXTENSION_SENDER,
    )
    expect(result).toEqual({ ok: true })
  })

  it('handles MODEL_COMPLETE_REQUEST from extension with mock provider', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider: () => mockProvider(),
    })

    const result = await router(
      {
        type: 'MODEL_COMPLETE_REQUEST',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [{ role: 'user', content: 'hello' }],
      },
      EXTENSION_SENDER,
    )
    expect(result).toEqual({ content: 'ok' })
  })

  it('rejects MODEL_COMPLETE_REQUEST from a content script', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(null),
      isExtensionOrigin: () => false,
    })

    await expect(
      router(
        {
          type: 'MODEL_COMPLETE_REQUEST',
          requestId: '550e8400-e29b-41d4-a716-446655440000',
          messages: [{ role: 'user', content: 'hello' }],
        },
        CONTENT_SENDER,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_CONFIG' })
  })

  it('returns an error for missing config on MODEL_TEST_REQUEST', async () => {
    const router = createMessageRouter({
      configStore: mockConfigStore(null),
      isExtensionOrigin: () => true,
      createProvider: () => mockProvider(),
    })

    await expect(
      router({ type: 'MODEL_TEST_REQUEST' }, EXTENSION_SENDER),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_CONFIG' })
  })
})
