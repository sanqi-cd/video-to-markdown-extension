import { BilibiliContextSchema } from '../src/adapters/bilibili/schemas'

export default defineContentScript({
  matches: ['https://www.bilibili.com/*', 'https://bilibili.com/*'],
  world: 'ISOLATED',
  runAt: 'document_idle',
  main() {
    window.addEventListener('video-to-md:bilibili-context', ((event: CustomEvent) => {
      const parsed = BilibiliContextSchema.safeParse(event.detail)
      if (!parsed.success) {
        console.error('Invalid Bilibili bridge payload', parsed.error)
        return
      }
      ;(window as unknown as Record<string, unknown>).__v2md_bilibili_context =
        parsed.data
    }) as EventListener)
  },
})
