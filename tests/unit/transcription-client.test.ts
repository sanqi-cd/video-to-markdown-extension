import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTabTranscription, stopTabTranscription } from '../../src/transcription/client'
import type { VideoMetadata } from '../../src/core/contracts'

function stubRuntime(response: unknown) {
  const sendMessage = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  return sendMessage
}

afterEach(() => vi.unstubAllGlobals())

describe('transcription client', () => {
  it('sends the start request and returns the task id', async () => {
    const sendMessage = stubRuntime({ success: true, data: { taskId: 'abc' } })
    await expect(startTabTranscription(7, {} as VideoMetadata, 'abc')).resolves.toBe('abc')
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'TRANSCRIPTION_START_REQUEST',
      tabId: 7,
      metadata: {},
      taskId: 'abc',
    })
  })

  it('keeps known error codes from the background and falls back otherwise', async () => {
    stubRuntime({ success: false, code: 'INVALID_TRANSCRIPTION_CONFIG', error: '请先配置' })
    await expect(startTabTranscription(1, {} as VideoMetadata, 'x'))
      .rejects.toMatchObject({ code: 'INVALID_TRANSCRIPTION_CONFIG', message: '请先配置' })

    stubRuntime({ success: false, code: 'SOMETHING_ELSE' })
    await expect(startTabTranscription(1, {} as VideoMetadata, 'x'))
      .rejects.toMatchObject({ code: 'TRANSCRIPTION_CAPTURE_FAILED', message: '无法开始当前标签页转录' })

    stubRuntime({ success: true, data: {} })
    await expect(startTabTranscription(1, {} as VideoMetadata, 'x'))
      .rejects.toMatchObject({ code: 'TRANSCRIPTION_CAPTURE_FAILED' })
  })

  it('stops a task and surfaces stop failures', async () => {
    const sendMessage = stubRuntime({ success: true, data: { stopped: true } })
    await expect(stopTabTranscription('abc')).resolves.toBeUndefined()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TRANSCRIPTION_STOP_REQUEST', taskId: 'abc' })

    stubRuntime(undefined)
    await expect(stopTabTranscription('abc')).rejects.toThrow('停止转录失败')
  })
})
