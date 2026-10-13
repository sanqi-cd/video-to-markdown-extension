import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/errors/app-error'
import { useTabTranscription } from '../../src/hooks/use-tab-transcription'
import type { TabTranscriptionEvent } from '../../src/transcription/contracts'
import type { SubtitleCue, VideoMetadata } from '../../src/core/contracts'

type Listener = (message: unknown) => void

const metadata = { title: 'demo' } as VideoMetadata
const cue = (text: string): SubtitleCue => ({ id: text, startMs: 0, endMs: 1_000, text })

function stubChrome(sendMessage = vi.fn().mockImplementation(async (message: { type: string; taskId: string }) => (
  message.type === 'TRANSCRIPTION_START_REQUEST'
    ? { success: true, data: { taskId: message.taskId } }
    : { success: true, data: { stopped: true } }
))) {
  const listeners = new Set<Listener>()
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
  })
  const emit = (event: TabTranscriptionEvent) => act(() => {
    for (const listener of listeners) listener({ type: 'TRANSCRIPTION_EVENT', event })
  })
  return { sendMessage, listeners, emit }
}

function taskIdOf(sendMessage: ReturnType<typeof vi.fn>): string {
  const call = sendMessage.mock.calls.find(([message]) => message.type === 'TRANSCRIPTION_START_REQUEST')
  return call![0].taskId as string
}

afterEach(() => vi.unstubAllGlobals())

describe('useTabTranscription', () => {
  it('tracks progress and hands the completed cues to the caller', async () => {
    const chrome = stubChrome()
    const onCompleted = vi.fn()
    const { result } = renderHook(() => useTabTranscription({ onCompleted }))

    await act(() => result.current.start(3, metadata))
    expect(result.current.state).toMatchObject({ status: 'running', cues: [] })
    const taskId = taskIdOf(chrome.sendMessage)

    chrome.emit({ type: 'progress', taskId, recordedMs: 1, transcribedMs: 1, chunkIndex: 1, newCues: [cue('一')] })
    chrome.emit({ type: 'progress', taskId, recordedMs: 2, transcribedMs: 2, chunkIndex: 2, newCues: [cue('二')] })
    expect(result.current.state.status === 'running' && result.current.state.cues.map((item) => item.text))
      .toEqual(['一', '二'])

    chrome.emit({ type: 'progress', taskId: 'other', recordedMs: 9, transcribedMs: 9, chunkIndex: 9, newCues: [] })
    expect(result.current.state).toMatchObject({ recordedMs: 2 })

    const completed = {
      type: 'completed' as const, taskId, recordedMs: 2, cues: [cue('一'), cue('二')],
      language: 'zh', stoppedEarly: false,
    }
    chrome.emit(completed)
    expect(onCompleted).toHaveBeenCalledWith(completed, metadata)
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('reports a failure when the caller cannot use the result', async () => {
    const chrome = stubChrome()
    const { result } = renderHook(() => useTabTranscription({
      onCompleted: () => { throw new AppError('TASK_CANCELLED', '页面已切换') },
    }))
    await act(() => result.current.start(3, metadata))
    chrome.emit({
      type: 'completed', taskId: taskIdOf(chrome.sendMessage), recordedMs: 1, cues: [cue('一')],
      language: 'zh', stoppedEarly: true,
    })
    expect(result.current.state).toEqual({
      status: 'failed',
      error: { code: 'TASK_CANCELLED', message: '页面已切换' },
      cues: [cue('一')],
    })
  })

  it('surfaces failed events from the recorder', async () => {
    const chrome = stubChrome()
    const { result } = renderHook(() => useTabTranscription({ onCompleted: vi.fn() }))
    await act(() => result.current.start(3, metadata))
    const error = { code: 'TRANSCRIPTION_FAILED' as const, message: '网络错误' }
    chrome.emit({ type: 'failed', taskId: taskIdOf(chrome.sendMessage), error, cues: [] })
    expect(result.current.state).toEqual({ status: 'failed', error, cues: [] })
  })

  it('shows a start failure and rethrows it', async () => {
    stubChrome(vi.fn().mockResolvedValue({ success: false, error: '未授权', code: 'TRANSCRIPTION_CAPTURE_FAILED' }))
    const { result } = renderHook(() => useTabTranscription({ onCompleted: vi.fn() }))
    await act(async () => {
      await expect(result.current.start(3, metadata)).rejects.toThrow('未授权')
    })
    expect(result.current.state).toMatchObject({
      status: 'failed',
      error: { code: 'TRANSCRIPTION_CAPTURE_FAILED', message: '未授权' },
    })
  })

  it('keeps captured cues when stopping fails', async () => {
    const sendMessage = vi.fn()
      .mockImplementationOnce(async (message: { taskId: string }) => ({ success: true, data: { taskId: message.taskId } }))
      .mockResolvedValueOnce({ success: false, error: '停止失败' })
    const chrome = stubChrome(sendMessage)
    const { result } = renderHook(() => useTabTranscription({ onCompleted: vi.fn() }))
    await act(() => result.current.start(3, metadata))
    chrome.emit({
      type: 'progress', taskId: taskIdOf(sendMessage), recordedMs: 1, transcribedMs: 1, chunkIndex: 1,
      newCues: [cue('一')],
    })
    await act(() => result.current.stop())
    expect(result.current.state).toMatchObject({ status: 'failed', cues: [cue('一')] })
  })

  it('reset abandons the run and unmount stops it', async () => {
    const chrome = stubChrome()
    const { result, unmount } = renderHook(() => useTabTranscription({ onCompleted: vi.fn() }))
    await act(() => result.current.start(3, metadata))
    act(() => result.current.reset())
    expect(result.current.state).toEqual({ status: 'idle' })
    expect(chrome.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'TRANSCRIPTION_STOP_REQUEST' }))

    await act(() => result.current.stop())
    const stopCalls = chrome.sendMessage.mock.calls.length

    await act(() => result.current.start(3, metadata))
    unmount()
    expect(chrome.sendMessage.mock.calls.length).toBe(stopCalls + 2)
    expect(chrome.listeners.size).toBe(0)
  })
})
