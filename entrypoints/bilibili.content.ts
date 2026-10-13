import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'
import { PAGE_BRIDGE_VERSION } from '../src/adapters/shared/page-bridge'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    let activePlayback: {
      taskId: string
      video: HTMLVideoElement
      currentTime: number
      playbackRate: number
      wasPaused: boolean
    } | null = null

    function restorePlayback(taskId: string) {
      if (!activePlayback || activePlayback.taskId !== taskId) return
      const snapshot = activePlayback
      activePlayback = null
      snapshot.video.pause()
      snapshot.video.playbackRate = snapshot.playbackRate
      snapshot.video.currentTime = snapshot.currentTime
      if (!snapshot.wasPaused) void snapshot.video.play().catch(() => undefined)
    }

    function readContext() {
      const raw = document.documentElement.getAttribute('data-v2md-bilibili')
      if (!raw) return null
      try {
        const parsed = BilibiliContextSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    }

    browser.runtime.onMessage.addListener((message) => {
      if (
        typeof message === 'object'
        && message !== null
        && (message as { type?: string }).type === 'TRANSCRIPTION_STOP_PLAYBACK'
      ) {
        const taskId = (message as { taskId?: unknown }).taskId
        if (typeof taskId === 'string') restorePlayback(taskId)
        return Promise.resolve({ success: true })
      }

      if (
        typeof message === 'object'
        && message !== null
        && (message as { type?: string }).type === 'TRANSCRIPTION_PREPARE_PLAYBACK'
      ) {
        const taskId = (message as { taskId?: unknown }).taskId
        if (typeof taskId !== 'string') {
          return Promise.resolve({ success: false, error: '转录任务编号无效' })
        }
        const video = [...document.querySelectorAll('video')]
          .find((candidate) => candidate.offsetWidth > 0 && candidate.offsetHeight > 0)
          ?? document.querySelector('video')
        if (!video) {
          return Promise.resolve({ success: false, error: '没有找到当前视频播放器' })
        }
        if (activePlayback) restorePlayback(activePlayback.taskId)
        activePlayback = {
          taskId,
          video,
          currentTime: video.currentTime,
          playbackRate: video.playbackRate,
          wasPaused: video.paused,
        }
        video.pause()
        video.currentTime = 0
        video.playbackRate = 1
        const onEnded = () => {
          if (activePlayback?.taskId !== taskId) return
          restorePlayback(taskId)
          void browser.runtime.sendMessage({
            type: 'TRANSCRIPTION_PLAYBACK_ENDED',
            taskId,
          })
        }
        video.addEventListener('ended', onEnded, { once: true })
        return video.play()
          .then(() => ({ success: true, durationMs: Math.round(video.duration * 1_000) }))
          .catch((cause: unknown) => ({
            success: false,
            error: cause instanceof Error ? cause.message : '浏览器阻止了视频自动播放',
          }))
      }

      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'VIDEO_CONTEXT_REQUEST'
      ) {
        const ctx = readContext()
        if (ctx) {
          return Promise.resolve({
            success: true,
            bridgeVersion: PAGE_BRIDGE_VERSION,
            platform: 'bilibili',
            data: ctx,
          })
        }
        return Promise.resolve({
          success: false,
          bridgeVersion: PAGE_BRIDGE_VERSION,
          code: 'CONTEXT_NOT_READY',
        })
      }
    })
  },
})
