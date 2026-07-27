import { YOUTUBE_CAPTION_BRIDGE } from '../src/adapters/shared/page-bridge'
import type { BridgePayload } from '../src/adapters/shared/page-bridge'
import { parseYouTubeInitialPlayerResponse } from '../src/adapters/youtube/main-world-parser'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let latestPayload: BridgePayload | null = null

    function clearPayload() {
      latestPayload = null
      document.documentElement.removeAttribute('data-v2md-youtube')
    }

    function extract() {
      const w = window as Window & {
        ytInitialPlayerResponse?: unknown
      }
      const currentVideoId = new URL(window.location.href).searchParams.get('v')
      if (!currentVideoId) {
        clearPayload()
        return
      }

      const raw = w.ytInitialPlayerResponse
      if (!raw) {
        clearPayload()
        return
      }

      const payload = parseYouTubeInitialPlayerResponse(raw)
      if (!payload) {
        clearPayload()
        return
      }

      if (currentVideoId !== payload.videoId) {
        clearPayload()
        return
      }

      latestPayload = payload

      // Write to DOM so ISOLATED world can always read it
      document.documentElement.setAttribute(
        'data-v2md-youtube',
        JSON.stringify(payload),
      )
    }

    // Try immediately
    extract()

    // Also watch for SPA navigation (YouTube is a SPA)
    const observer = new MutationObserver(() => extract())
    observer.observe(document.title ? document.head : document.documentElement, {
      childList: true,
      subtree: true,
    })

    window.addEventListener('yt-navigate-finish', extract)
    window.addEventListener('popstate', extract)

    window.addEventListener(YOUTUBE_CAPTION_BRIDGE.requestEvent, () => {
      void handleCaptionRequest()
    })

    async function handleCaptionRequest() {
      const raw = document.documentElement.getAttribute(
        YOUTUBE_CAPTION_BRIDGE.requestAttribute,
      )
      let request: { requestId: string; trackId: string } | null = null
      try {
        const parsed = raw ? JSON.parse(raw) as unknown : null
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as Record<string, unknown>).requestId === 'string' &&
          typeof (parsed as Record<string, unknown>).trackId === 'string'
        ) {
          request = parsed as { requestId: string; trackId: string }
        }
      } catch {
        // The isolated script will time out and return an actionable error.
      }
      if (!request) return

      const respond = (response: Record<string, unknown>) => {
        document.documentElement.setAttribute(
          YOUTUBE_CAPTION_BRIDGE.responseAttribute,
          JSON.stringify({ requestId: request!.requestId, ...response }),
        )
        window.dispatchEvent(new Event(YOUTUBE_CAPTION_BRIDGE.responseEvent))
      }

      extract()
      const track = latestPayload?.tracks.find((item) => item.vssId === request.trackId)
      if (!track) {
        respond({ success: false, error: '未找到指定字幕轨道' })
        return
      }

      const url = new URL(track.baseUrl)
      const allowedHost =
        url.hostname === 'www.youtube.com' ||
        url.hostname === 'youtube.com' ||
        url.hostname === 'www.google.com' ||
        url.hostname.endsWith('.googlevideo.com')
      if (url.protocol !== 'https:' || !allowedHost) {
        respond({ success: false, error: '字幕地址不在允许的 YouTube 域名内' })
        return
      }

      try {
        const innertubeBody = await fetchCaptionWithInnertube(
          latestPayload!.videoId,
          track.vssId,
          track.languageCode,
        )
        if (innertubeBody.trim().length > 0) {
          respond({ success: true, status: 200, body: innertubeBody })
          return
        }
      } catch {
        // Fall back to the caption URL embedded in the web player response.
      }

      try {
        url.searchParams.set('fmt', 'json3')
        const response = await window.fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        respond({
          success: true,
          status: response.status,
          body: await response.text(),
        })
      } catch (error) {
        respond({
          success: false,
          error: error instanceof Error ? error.message : '字幕请求失败',
        })
      }
    }

    async function fetchCaptionWithInnertube(
      videoId: string,
      vssId: string,
      languageCode: string,
    ): Promise<string> {
      const pageWindow = window as Window & {
        ytcfg?: {
          get?: (key: string) => unknown
          data_?: Record<string, unknown>
        }
      }
      const apiKey = pageWindow.ytcfg?.get?.('INNERTUBE_API_KEY')
        ?? pageWindow.ytcfg?.data_?.INNERTUBE_API_KEY
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error('页面未提供 Innertube API Key')
      }

      const playerResponse = await window.fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Accept-Language': 'en-US',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'ANDROID',
                clientVersion: '20.10.38',
              },
            },
            videoId,
          }),
        },
      )
      if (!playerResponse.ok) {
        throw new Error(`Innertube 播放器请求失败 (${playerResponse.status})`)
      }

      const playerData = await playerResponse.json() as Record<string, unknown>
      const captions = (
        playerData.captions as Record<string, unknown> | undefined
      )?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined
      const tracks = captions?.captionTracks
      if (!Array.isArray(tracks)) throw new Error('Innertube 未返回字幕轨道')

      const matchedTrack = tracks.find((item) => {
        if (typeof item !== 'object' || item === null) return false
        const candidate = item as Record<string, unknown>
        return candidate.vssId === vssId || candidate.languageCode === languageCode
      }) as Record<string, unknown> | undefined
      if (typeof matchedTrack?.baseUrl !== 'string') {
        throw new Error('Innertube 未找到所选字幕轨道')
      }

      const transcriptUrl = new URL(matchedTrack.baseUrl.replace('&fmt=srv3', ''))
      if (
        transcriptUrl.protocol !== 'https:' ||
        !(transcriptUrl.hostname === 'www.youtube.com' ||
          transcriptUrl.hostname === 'youtube.com' ||
          transcriptUrl.hostname === 'www.google.com' ||
          transcriptUrl.hostname.endsWith('.googlevideo.com'))
      ) {
        throw new Error('Innertube 字幕地址不在允许域名内')
      }

      const transcriptResponse = await window.fetch(transcriptUrl, {
        credentials: 'include',
        headers: { 'Accept-Language': 'en-US' },
      })
      if (!transcriptResponse.ok) {
        throw new Error(`Innertube 字幕请求失败 (${transcriptResponse.status})`)
      }
      return transcriptResponse.text()
    }
  },
})
