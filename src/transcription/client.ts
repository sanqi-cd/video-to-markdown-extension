import { AppError, isErrorCode } from '../errors/app-error'
import type { VideoMetadata } from '../core/contracts'

type RuntimeResponse<T> = {
  success?: boolean
  data?: T
  error?: string
  code?: string
}

export async function startTabTranscription(
  tabId: number,
  metadata: VideoMetadata,
  taskId: string,
): Promise<string> {
  const response = await chrome.runtime.sendMessage({
    type: 'TRANSCRIPTION_START_REQUEST',
    tabId,
    metadata,
    taskId,
  }) as RuntimeResponse<{ taskId: string }>
  if (!response?.success || !response.data?.taskId) {
    throw new AppError(
      isErrorCode(response?.code) ? response.code : 'TRANSCRIPTION_CAPTURE_FAILED',
      response?.error ?? '无法开始当前标签页转录',
    )
  }
  return response.data.taskId
}

export async function stopTabTranscription(taskId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: 'TRANSCRIPTION_STOP_REQUEST',
    taskId,
  }) as RuntimeResponse<{ stopped: boolean }>
  if (!response?.success) {
    throw new AppError(
      isErrorCode(response?.code) ? response.code : 'TRANSCRIPTION_CAPTURE_FAILED',
      response?.error ?? '停止转录失败',
    )
  }
}
