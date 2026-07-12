import { BridgeEventSchema } from '../src/adapters/shared/page-bridge'

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    window.addEventListener('video-to-md:youtube-context', ((event: CustomEvent) => {
      const parsed = BridgeEventSchema.safeParse(event.detail)
      if (!parsed.success) {
        console.error('Invalid YouTube bridge payload', parsed.error)
        return
      }
      // Store the validated payload for later use via extension messaging
      ;(window as unknown as Record<string, unknown>).__v2md_youtube_payload = parsed.data
    }) as EventListener)
  },
})
