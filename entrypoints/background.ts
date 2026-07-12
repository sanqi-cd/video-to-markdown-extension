import { createMessageRouter } from '../src/core/messages'
import { createConfigStore } from '../src/model/config-store'
import { OpenAICompatibleProvider } from '../src/model/openai-provider'
import type { ModelConfig } from '../src/model/config-store'

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)

  const configStore = createConfigStore(chrome.storage.local)

  const router = createMessageRouter({
    configStore,
    isExtensionOrigin: (sender) => {
      return sender.url?.startsWith(chrome.runtime.getURL('')) === true
    },
    createProvider: (config: ModelConfig) => new OpenAICompatibleProvider(config),
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    router(message, sender)
      .then((result) => {
        sendResponse({ success: true, data: result })
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : '未知错误'
        sendResponse({ success: false, error: msg })
      })
    return true
  })
})
