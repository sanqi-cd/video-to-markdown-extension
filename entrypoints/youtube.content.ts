import {
  PAGE_BRIDGE_VERSION,
  YOUTUBE_CAPTION_BRIDGE,
} from '../src/adapters/shared/page-bridge'
import { BridgeEventSchema } from '../src/adapters/shared/page-bridge-schema'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    // Read payload from DOM attribute (set by MAIN world) — no race condition
    function readPayload() {
      const raw = document.documentElement.getAttribute('data-v2md-youtube')
      if (!raw) return null
      try {
        const parsed = BridgeEventSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    }

    browser.runtime.onMessage.addListener((message) => {
      if (typeof message !== 'object' || message === null) return
      const typedMessage = message as { type?: string; trackId?: string }

      if (typedMessage.type === 'VIDEO_CONTEXT_REQUEST') {
        const payload = readPayload()
        if (payload) {
          return Promise.resolve({
            success: true,
            bridgeVersion: PAGE_BRIDGE_VERSION,
            platform: 'youtube',
            data: payload,
          })
        }
        return Promise.resolve({
          success: false,
          bridgeVersion: PAGE_BRIDGE_VERSION,
          code: 'CONTEXT_NOT_READY',
        })
      }

      if (
        typedMessage.type === 'YOUTUBE_CAPTION_FETCH_REQUEST' &&
        typeof typedMessage.trackId === 'string'
      ) {
        return fetchCaption(typedMessage.trackId)
      }
    })

    async function fetchCaption(trackId: string) {
      const payload = readPayload()
      const track = payload?.tracks.find((item) => item.vssId === trackId)
      if (!track) return { success: false, error: '未找到指定字幕轨道' }

      const url = new URL(track.baseUrl)
      const allowedHost =
        url.hostname === 'www.youtube.com' ||
        url.hostname === 'youtube.com' ||
        url.hostname === 'www.google.com' ||
        url.hostname.endsWith('.googlevideo.com')
      if (url.protocol !== 'https:' || !allowedHost) {
        return { success: false, error: '字幕地址不在允许的 YouTube 域名内' }
      }
      try {
        return await fetchCaptionInMainWorld(trackId)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '字幕请求失败',
        }
      }
    }

    function fetchCaptionInMainWorld(trackId: string): Promise<{
      success: boolean
      status?: number
      body?: string
      error?: string
    }> {
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID()
        const timeout = window.setTimeout(() => {
          cleanup()
          reject(new Error('页面字幕请求超时，请刷新视频页面后重试'))
        }, 20_000)

        const cleanup = () => {
          window.clearTimeout(timeout)
          window.removeEventListener(
            YOUTUBE_CAPTION_BRIDGE.responseEvent,
            onResponse,
          )
        }

        const onResponse = () => {
          const raw = document.documentElement.getAttribute(
            YOUTUBE_CAPTION_BRIDGE.responseAttribute,
          )
          try {
            const response = raw ? JSON.parse(raw) as Record<string, unknown> : null
            if (response?.requestId !== requestId) return
            cleanup()
            document.documentElement.removeAttribute(
              YOUTUBE_CAPTION_BRIDGE.responseAttribute,
            )
            resolve({
              success: response.success === true,
              status: typeof response.status === 'number' ? response.status : undefined,
              body: typeof response.body === 'string' ? response.body : undefined,
              error: typeof response.error === 'string' ? response.error : undefined,
            })
          } catch {
            // Ignore unrelated or malformed page events until timeout.
          }
        }

        window.addEventListener(
          YOUTUBE_CAPTION_BRIDGE.responseEvent,
          onResponse,
        )
        document.documentElement.setAttribute(
          YOUTUBE_CAPTION_BRIDGE.requestAttribute,
          JSON.stringify({ requestId, trackId }),
        )
        window.dispatchEvent(new Event(YOUTUBE_CAPTION_BRIDGE.requestEvent))
      })
    }
  },
})
