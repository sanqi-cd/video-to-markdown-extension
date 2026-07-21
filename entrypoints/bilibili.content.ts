import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'
import { PAGE_BRIDGE_VERSION } from '../src/adapters/shared/page-bridge'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
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
