import { describe, expect, it, vi } from 'vitest'
import { BackgroundModelClient } from '../../src/model/background-client'
import {
  MODEL_STREAM_PORT,
  type RuntimePortLike,
  type StreamCommand,
  type StreamEvent,
} from '../../src/model/stream-port'
import type { ModelRequest } from '../../src/core/contracts'

const taskId = '550e8400-e29b-41d4-a716-446655440000'
const requestId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

const request: ModelRequest = {
  messages: [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'user prompt' },
  ],
  responseFormat: 'json',
}

class MockPort implements RuntimePortLike {
  name = MODEL_STREAM_PORT
  sender = { url: 'chrome-extension://test/sidepanel.html' }
  posted: unknown[] = []
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
    this.posted.push(message)
  }

  disconnect() {
    if (this.disconnected) return
    this.disconnected = true
    for (const listener of [...this.disconnectListeners]) listener(this)
  }

  emitMessage(message: StreamEvent) {
    for (const listener of [...this.messageListeners]) listener(message)
  }

  emitDisconnect() {
    this.disconnect()
  }
}

function createClient(port: MockPort, sendMessage = vi.fn()) {
  return new BackgroundModelClient({
    connect: () => port,
    sendMessage,
    randomUUID: () => requestId,
  })
}

describe('BackgroundModelClient', () => {
  it('sends only task metadata and prompts through the Port, never an API key', async () => {
    const port = new MockPort()
    const onActivity = vi.fn()
    const completion = createClient(port).complete(request, undefined, {
      taskId,
      chunkIndex: 0,
      onActivity,
    })
    const start = port.posted[0] as StreamCommand

    expect(start).toEqual({ type: 'START', taskId, requestId, messages: request.messages })
    expect(JSON.stringify(start)).not.toContain('apiKey')
    expect(JSON.stringify(start)).not.toContain('Bearer')

    port.emitMessage({ type: 'STARTED', taskId, requestId })
    port.emitMessage({ type: 'CONNECTED', taskId, requestId })
    port.emitMessage({ type: 'DELTA', taskId, requestId, text: '你', receivedChars: 1 })
    port.emitMessage({ type: 'DONE', taskId, requestId, content: '{"ok":true}' })

    await expect(completion).resolves.toEqual({ content: '{"ok":true}' })
    expect(onActivity).toHaveBeenCalledWith({ type: 'connected' })
    expect(onActivity).toHaveBeenCalledWith({ type: 'delta', text: '你', receivedChars: 1 })
  })

  it('posts CANCEL and rejects when the caller aborts', async () => {
    const port = new MockPort()
    const controller = new AbortController()
    const completion = createClient(port).complete(request, controller.signal, {
      taskId,
      chunkIndex: 0,
    })

    controller.abort()

    await expect(completion).rejects.toMatchObject({ code: 'TASK_CANCELLED' })
    expect(port.posted).toContainEqual({ type: 'CANCEL', taskId, requestId })
    expect(port.disconnected).toBe(true)
  })

  it('rejects and discards partial stream data when the Port disconnects after a delta', async () => {
    const port = new MockPort()
    const completion = createClient(port).complete(request, undefined, {
      taskId,
      chunkIndex: 0,
    })
    port.emitMessage({ type: 'DELTA', taskId, requestId, text: 'partial', receivedChars: 7 })

    port.emitDisconnect()

    await expect(completion).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
      message: expect.stringContaining('未验证内容已丢弃'),
    })
  })

  it('keeps connection tests on the short message path', async () => {
    const port = new MockPort()
    const sendMessage = vi.fn().mockResolvedValue({ success: true, data: { ok: true } })
    const client = createClient(port, sendMessage)

    await client.testConnection()

    expect(sendMessage).toHaveBeenCalledWith({ type: 'MODEL_TEST_REQUEST' })
    expect(port.posted).toEqual([])
  })
})
