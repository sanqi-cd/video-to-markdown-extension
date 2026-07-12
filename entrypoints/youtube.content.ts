import { BridgeEventSchema } from '../src/adapters/shared/page-bridge'

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
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'VIDEO_CONTEXT_REQUEST'
      ) {
        const payload = readPayload()
        if (payload) {
          return Promise.resolve({ success: true, data: payload })
        }
        return Promise.resolve({ success: false, error: 'NO_VIDEO_CONTEXT' })
      }
    })
  },
})
