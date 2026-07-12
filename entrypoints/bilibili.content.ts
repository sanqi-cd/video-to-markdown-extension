import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'

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
          return Promise.resolve({ success: true, data: ctx })
        }
        return Promise.resolve({ success: false, error: 'NO_VIDEO_CONTEXT' })
      }
    })
  },
})
