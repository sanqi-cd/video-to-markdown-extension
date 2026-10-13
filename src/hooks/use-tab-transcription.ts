import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, type PublicAppError } from '../errors/app-error'
import { startTabTranscription, stopTabTranscription } from '../transcription/client'
import { applyTranscriptionEvent } from '../transcription/ui-state'
import type { VideoMetadata } from '../core/contracts'
import type {
  TabTranscriptionEvent,
  TranscriptionUiState,
} from '../transcription/contracts'

export type CompletedTranscription = Extract<TabTranscriptionEvent, { type: 'completed' }>

type Options = {
  /** Turns the finished cues into a usable subtitle source; throwing marks the run as failed. */
  onCompleted: (event: CompletedTranscription, metadata: VideoMetadata) => void
}

function toPublicError(cause: unknown, fallbackCode: PublicAppError['code']): PublicAppError {
  if (cause instanceof AppError) return cause.toJSON()
  return {
    code: fallbackCode,
    message: cause instanceof Error ? cause.message : '音频转录失败',
  }
}

function isTranscriptionEventMessage(
  message: unknown,
): message is { type: 'TRANSCRIPTION_EVENT'; event: TabTranscriptionEvent } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'TRANSCRIPTION_EVENT'
    && typeof (message as { event?: unknown }).event === 'object'
    && (message as { event?: unknown }).event !== null
}

export function useTabTranscription({ onCompleted }: Options) {
  const [state, setState] = useState<TranscriptionUiState>({ status: 'idle' })
  const taskIdRef = useRef<string | null>(null)
  const metadataRef = useRef<VideoMetadata | null>(null)
  const onCompletedRef = useRef(onCompleted)

  useEffect(() => {
    onCompletedRef.current = onCompleted
  }, [onCompleted])

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (!isTranscriptionEventMessage(message)) return
      const { event } = message
      if (!taskIdRef.current || event.taskId !== taskIdRef.current) return

      if (event.type !== 'completed') {
        if (event.type === 'failed') taskIdRef.current = null
        setState((current) => applyTranscriptionEvent(current, event))
        return
      }

      taskIdRef.current = null
      const metadata = metadataRef.current
      try {
        if (!metadata) {
          throw new AppError('TASK_CANCELLED', '转写完成时视频页面已经切换，请在原视频重新开始')
        }
        onCompletedRef.current(event, metadata)
        setState({ status: 'idle' })
      } catch (cause) {
        setState({
          status: 'failed',
          error: toPublicError(cause, 'TRANSCRIPTION_FAILED'),
          cues: event.cues,
        })
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      const taskId = taskIdRef.current
      if (taskId) void stopTabTranscription(taskId).catch(() => undefined)
    }
  }, [])

  const start = useCallback(async (tabId: number, metadata: VideoMetadata) => {
    metadataRef.current = metadata
    const taskId = crypto.randomUUID()
    taskIdRef.current = taskId
    setState({ status: 'starting' })
    try {
      await startTabTranscription(tabId, metadata, taskId)
      if (taskIdRef.current !== taskId) return
      setState((current) => current.status === 'running'
        ? current
        : applyTranscriptionEvent(current, { type: 'started', taskId, metadata }))
    } catch (cause) {
      if (taskIdRef.current !== taskId) return
      taskIdRef.current = null
      setState({
        status: 'failed',
        error: toPublicError(cause, 'TRANSCRIPTION_CAPTURE_FAILED'),
        cues: [],
      })
      throw cause
    }
  }, [])

  const stop = useCallback(async () => {
    const taskId = taskIdRef.current
    if (!taskId) return
    try {
      await stopTabTranscription(taskId)
    } catch (cause) {
      setState((current) => ({
        status: 'failed',
        error: toPublicError(cause, 'TRANSCRIPTION_CAPTURE_FAILED'),
        cues: current.status === 'running' ? current.cues : [],
      }))
    }
  }, [])

  /** Abandons the current run (e.g. switching tabs) without waiting for its result. */
  const reset = useCallback(() => {
    const taskId = taskIdRef.current
    taskIdRef.current = null
    if (taskId) void stopTabTranscription(taskId).catch(() => undefined)
    setState({ status: 'idle' })
  }, [])

  return { state, start, stop, reset }
}
