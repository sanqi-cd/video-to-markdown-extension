import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    const w = window as Window & {
      __INITIAL_STATE__?: {
        videoData?: {
          aid?: number
          bvid?: string
          cid?: number
          title?: string
          duration?: number
        }
        upData?: {
          name?: string
        }
      }
    }

    const state = w.__INITIAL_STATE__
    if (!state?.videoData) return

    const { videoData, upData } = state
    if (!videoData.bvid || !videoData.cid) return

    const raw = {
      bvid: videoData.bvid,
      aid: videoData.aid ?? 0,
      cid: videoData.cid,
      title: videoData.title ?? '',
      author: upData?.name,
      durationMs: videoData.duration ? videoData.duration * 1000 : undefined,
    }

    const parsed = BilibiliContextSchema.safeParse(raw)
    if (!parsed.success) return

    window.dispatchEvent(
      new CustomEvent('video-to-md:bilibili-context', {
        detail: parsed.data,
      }),
    )
  },
})
