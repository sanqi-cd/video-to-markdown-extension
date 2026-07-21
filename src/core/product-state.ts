import type { SubtitleTrack, VideoMetadata } from './contracts'
import { isSameLanguage, type OutputLanguage } from './language'
import type { TaskState } from './orchestrator'
import type { PublicAppError } from '../errors/app-error'

export type AppRoute = 'home' | 'settings' | 'model-test'

export type VideoContextState =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'refresh-required'; tabId: number }
  | { status: 'no-subtitle'; metadata: VideoMetadata }
  | { status: 'ready'; metadata: VideoMetadata; tracks: SubtitleTrack[] }
  | { status: 'failed'; error: PublicAppError }

export type ModelTestState =
  | { status: 'idle' }
  | { status: 'testing'; startedAt: number }
  | { status: 'success'; latencyMs: number }
  | { status: 'failed'; error: PublicAppError }

export type AppPage =
  | 'loading'
  | 'unsupported'
  | 'refresh-required'
  | 'no-subtitle'
  | 'ready'
  | 'video-error'
  | 'settings'
  | 'model-test'
  | 'generating'
  | 'partial'
  | 'result'
  | 'task-error'
  | 'cancelled'

export function selectAppPage(
  route: AppRoute,
  videoContext: VideoContextState,
  taskStatus?: TaskState['status'],
  hasPreservedContent = false,
): AppPage {
  if (route === 'settings' || route === 'model-test') return route

  switch (taskStatus) {
    case 'running':
      return 'generating'
    case 'partial':
      return 'partial'
    case 'completed':
      return 'result'
    case 'failed':
      return 'task-error'
    case 'cancelled':
      return hasPreservedContent ? 'partial' : 'cancelled'
    case 'idle':
    case undefined:
      break
  }

  return videoContext.status === 'failed' ? 'video-error' : videoContext.status
}

export function requiresModel(
  mode: 'high-fidelity' | 'refined',
  sourceLanguage: string,
  outputLanguage: OutputLanguage = 'zh',
): boolean {
  return mode === 'refined' || !isSameLanguage(sourceLanguage, outputLanguage)
}
