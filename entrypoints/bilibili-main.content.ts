import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let lastRouteKey = routeKey()
    let lastContextKey: string | null = null
    let staleContextKey: string | null = null

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

      const contextKey = `${videoData.bvid}:${videoData.cid}`
      if (staleContextKey === contextKey) return

      const parsed = BilibiliContextSchema.safeParse({
        bvid: videoData.bvid,
        aid: videoData.aid ?? 0,
        cid: videoData.cid,
        title: videoData.title ?? '',
        author: upData?.name,
        durationMs: videoData.duration ? videoData.duration * 1000 : undefined,
      })
      if (!parsed.success) {
        clearContext()
        return
      }

      document.documentElement.setAttribute(
        'data-v2md-bilibili',
        JSON.stringify(parsed.data),
      )
      lastContextKey = contextKey
      staleContextKey = null
    }

    extract()

    const observer = new MutationObserver(() => extract())
    observer.observe(document.head, { childList: true, subtree: true })
    window.addEventListener('popstate', extract)
  },
})
