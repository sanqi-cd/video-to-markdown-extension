import { BridgeEventSchema } from '../src/adapters/shared/page-bridge'
import type { BridgePayload } from '../src/adapters/shared/page-bridge'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    let payload: BridgePayload | null = null

    window.addEventListener('video-to-md:youtube-context', ((event: CustomEvent) => {
      const parsed = BridgeEventSchema.safeParse(event.detail)
      if (!parsed.success) {
        console.error('Invalid YouTube bridge payload', parsed.error)
        return
      }
      payload = parsed.data
    }) as EventListener)

    browser.runtime.onMessage.addListener((message) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'VIDEO_CONTEXT_REQUEST'
      ) {
        if (payload) {
          return Promise.resolve({ success: true, data: payload })
        }
        return Promise.resolve({ success: false, error: 'NO_VIDEO_CONTEXT' })
      }
    })
  },
})
