import { parseBilibiliMainWorldContext, collectBilibiliDescription, resolveBilibiliPlayback } from '../src/adapters/bilibili/main-world-parser'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let lastRouteKey = routeKey()
    let lastContextKey: string | null = null
    let staleContextKey: string | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    function routeKey() {
      const url = new URL(window.location.href)
      const page = Math.max(1, Number.parseInt(url.searchParams.get('p') ?? '1', 10) || 1)
      return `${url.pathname}?p=${page}`
    }

    function clearContext() {
      document.documentElement.removeAttribute('data-v2md-bilibili')
    }

    function extract() {
      const currentRouteKey = routeKey()
      if (currentRouteKey !== lastRouteKey) {
        lastRouteKey = currentRouteKey
        staleContextKey = lastContextKey
        clearContext()
      }

      const w = window as Window & {
        __INITIAL_STATE__?: {
          videoData?: {
            aid?: number
            bvid?: string
            cid?: number
            title?: string
            duration?: number
            desc?: string
            desc_v2?: Array<{ raw_text?: string }>
            pages?: Array<{ cid?: number; page?: number; part?: string; duration?: number }>
          }
          upData?: { name?: string }
        }
      }

      const state = w.__INITIAL_STATE__
      if (!state?.videoData) {
        clearContext()
        return
      }
      const { videoData, upData } = state
      if (!videoData.bvid || !videoData.cid) {
        clearContext()
        return
      }
      if (!window.location.pathname.includes(videoData.bvid)) {
        clearContext()
        return
      }

      const page = Math.max(1, Number.parseInt(new URL(window.location.href).searchParams.get('p') ?? '1', 10) || 1)
      const playback = resolveBilibiliPlayback(videoData, page)
      if (!playback) {
        clearContext()
        return
      }

      const contextKey = `${videoData.bvid}:${playback.cid}`
      if (staleContextKey === contextKey) return
      if (lastContextKey === contextKey
        && document.documentElement.hasAttribute('data-v2md-bilibili')) {
        return
      }

      const parsed = parseBilibiliMainWorldContext({
        bvid: videoData.bvid,
        aid: videoData.aid ?? 0,
        cid: playback.cid,
        page,
        title: playback.title,
        author: upData?.name,
        durationMs: playback.durationMs,
        description: collectBilibiliDescription(videoData),
      })
      if (!parsed) {
        clearContext()
        return
      }

      document.documentElement.setAttribute(
        'data-v2md-bilibili',
        JSON.stringify(parsed),
      )
      lastContextKey = contextKey
      staleContextKey = null
    }

    function hookHistoryMethod(method: 'pushState' | 'replaceState') {
      const original = history[method].bind(history)
      history[method] = ((...args: Parameters<History['pushState']>) => {
        const result = original(...args)
        queueMicrotask(extract)
        return result
      }) as History['pushState']
    }

    extract()

    const observer = new MutationObserver(() => extract())
    observer.observe(document.head, { childList: true, subtree: true })

    window.addEventListener('popstate', extract)
    hookHistoryMethod('pushState')
    hookHistoryMethod('replaceState')

    // Fallback for SPA updates that mutate __INITIAL_STATE__ without history events.
    pollTimer = setInterval(extract, 1_500)
    window.addEventListener('pagehide', () => {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }, { once: true })
  },
})
