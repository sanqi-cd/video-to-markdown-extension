import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'
import type { BilibiliContextPayload } from '../src/adapters/bilibili/schemas'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    let context: BilibiliContextPayload | null = null

    window.addEventListener('video-to-md:bilibili-context', ((event: CustomEvent) => {
      const parsed = BilibiliContextSchema.safeParse(event.detail)
      if (!parsed.success) {
        console.error('Invalid Bilibili bridge payload', parsed.error)
        return
      }
      context = parsed.data
    }) as EventListener)

    browser.runtime.onMessage.addListener((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'VIDEO_CONTEXT_REQUEST'
      ) {
        if (context) {
          return Promise.resolve({ success: true, data: context })
        }
        return Promise.resolve({ success: false, error: 'NO_VIDEO_CONTEXT' })
      }
    })
  },
})
