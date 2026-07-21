import { describe, expect, it, vi } from 'vitest'
import { createMessageRouter } from '../../src/core/messages'
import type { ModelConfig, ModelConfigStore } from '../../src/model/config-store'
import type { ModelProvider, ModelResponse } from '../../src/core/contracts'
import { AppError } from '../../src/errors/app-error'
import {
  createStreamPortHandler,
  MODEL_STREAM_PORT,
  type RuntimePortLike,
  type StreamEvent,
} from '../../src/model/stream-port'
import type { StreamingModelProvider } from '../../src/model/openai-provider'

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
  version: 2,
  providerId: 'custom',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
  streamMode: 'auto',
}

class MockStreamPort implements RuntimePortLike {
  name = MODEL_STREAM_PORT
  sender = EXTENSION_SENDER
  posted: StreamEvent[] = []
  disconnected = false
  private messageListeners = new Set<(value: unknown) => void>()
  private disconnectListeners = new Set<(value: RuntimePortLike) => void>()
  onMessage = {
    addListener: (listener: (value: unknown) => void) => this.messageListeners.add(listener),
    removeListener: (listener: (value: unknown) => void) => this.messageListeners.delete(listener),
  }
  onDisconnect = {
    addListener: (listener: (value: RuntimePortLike) => void) => this.disconnectListeners.add(listener),
    removeListener: (listener: (value: RuntimePortLike) => void) => (
      this.disconnectListeners.delete(listener)
    ),
  }

  postMessage(message: unknown) {
    this.posted.push(message as StreamEvent)
  }

  disconnect() {
    if (this.disconnected) return
    this.disconnected = true
    for (const listener of [...this.disconnectListeners]) listener(this)
  }

  emitMessage(message: unknown) {
    for (const listener of [...this.messageListeners]) listener(message)
  }
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

  it('cancels an active model request and removes it from the registry', async () => {
    const activeRequests = new Map<string, AbortController>()
    const provider: ModelProvider = {
      testConnection: vi.fn(),
      complete: vi.fn((_request, signal) => new Promise<ModelResponse>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new AppError('TASK_CANCELLED', '任务已取消'))
        }, { once: true })
      })),
    }
    const router = createMessageRouter({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider: () => provider,
      activeRequests,
    })
    const requestId = '550e8400-e29b-41d4-a716-446655440000'
    const completion = router({
      type: 'MODEL_COMPLETE_REQUEST',
      requestId,
      messages: [{ role: 'user', content: 'hello' }],
    }, EXTENSION_SENDER)
    await Promise.resolve()

    expect(activeRequests.has(requestId)).toBe(true)
    await router({ type: 'MODEL_CANCEL_REQUEST', requestId }, EXTENSION_SENDER)
    await expect(completion).rejects.toMatchObject({ code: 'TASK_CANCELLED' })
    expect(activeRequests.has(requestId)).toBe(false)
  })
})

describe('model stream port router', () => {
  const taskId = '550e8400-e29b-41d4-a716-446655440000'
  const requestId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

  it('rejects a Port opened from a non-extension sender', () => {
    const port = new MockStreamPort()
    port.sender = CONTENT_SENDER
    const createProvider = vi.fn(() => mockProvider())
    createStreamPortHandler({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => false,
      createProvider,
    })(port)

    expect(port.disconnected).toBe(true)
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('loads the API key only inside the worker and emits validated stream events', async () => {
    const port = new MockStreamPort()
    const provider: StreamingModelProvider = {
      testConnection: vi.fn(),
      complete: vi.fn(),
      completeStream: vi.fn(async (_request, callbacks) => {
        callbacks.onConnected()
        callbacks.onDelta('你', 1)
        return { content: '你好' }
      }),
    }
    const createProvider = vi.fn(() => provider)
    createStreamPortHandler({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider,
    })(port)

    port.emitMessage({
      type: 'START',
      taskId,
      requestId,
      messages: [{ role: 'user', content: 'hello' }],
    })
    await vi.waitFor(() => {
      expect(port.posted.some((event) => event.type === 'DONE')).toBe(true)
    })

    expect(createProvider).toHaveBeenCalledWith(testConfig)
    expect(port.posted.map((event) => event.type)).toEqual([
      'STARTED', 'CONNECTED', 'DELTA', 'DONE',
    ])
    expect(JSON.stringify(port.posted)).not.toContain(testConfig.apiKey)
  })

  it('aborts the active request when the client sends CANCEL', async () => {
    const port = new MockStreamPort()
    let requestSignal: AbortSignal | undefined
    const provider: StreamingModelProvider = {
      testConnection: vi.fn(),
      complete: vi.fn(),
      completeStream: vi.fn((_request, _callbacks, signal) => {
        requestSignal = signal
        return new Promise<ModelResponse>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new AppError('TASK_CANCELLED', '任务已取消'))
          }, { once: true })
        })
      }),
    }
    createStreamPortHandler({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider: () => provider,
    })(port)
    port.emitMessage({
      type: 'START',
      taskId,
      requestId,
      messages: [{ role: 'user', content: 'hello' }],
    })
    await vi.waitFor(() => expect(requestSignal).toBeDefined())

    port.emitMessage({ type: 'CANCEL', taskId, requestId })

    expect(requestSignal?.aborted).toBe(true)
    await vi.waitFor(() => {
      expect(port.posted.some((event) => event.type === 'ERROR')).toBe(true)
    })
  })

  it('aborts every active request when the Port disconnects', async () => {
    const port = new MockStreamPort()
    let requestSignal: AbortSignal | undefined
    const provider: StreamingModelProvider = {
      testConnection: vi.fn(),
      complete: vi.fn(),
      completeStream: vi.fn((_request, _callbacks, signal) => {
        requestSignal = signal
        return new Promise<ModelResponse>(() => {})
      }),
    }
    createStreamPortHandler({
      configStore: mockConfigStore(testConfig),
      isExtensionOrigin: () => true,
      createProvider: () => provider,
    })(port)
    port.emitMessage({
      type: 'START',
      taskId,
      requestId,
      messages: [{ role: 'user', content: 'hello' }],
    })
    await vi.waitFor(() => expect(requestSignal).toBeDefined())

    port.disconnect()

    expect(requestSignal?.aborted).toBe(true)
  })
})
