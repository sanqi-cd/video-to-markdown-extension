import { createMessageRouter } from '../src/core/messages'
import { createConfigStore } from '../src/model/config-store'
import { OpenAICompatibleProvider } from '../src/model/openai-provider'
import { AppError } from '../src/errors/app-error'
import type { ModelConfig } from '../src/model/config-store'
import {
  createStreamPortHandler,
  type RuntimePortLike,
} from '../src/model/stream-port'

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })

  const configStore = createConfigStore(chrome.storage.local)
  const activeRequests = new Map<string, AbortController>()
  const isExtensionOrigin = (sender: { url?: string }) => {
    return sender.url?.startsWith(chrome.runtime.getURL('')) === true
  }

  const router = createMessageRouter({
    configStore,
    isExtensionOrigin,
    createProvider: (config: ModelConfig) => new OpenAICompatibleProvider(config),
    activeRequests,
  })
  const handleStreamPort = createStreamPortHandler({
    configStore,
    isExtensionOrigin,
    createProvider: (config: ModelConfig) => new OpenAICompatibleProvider(config),
  })

  chrome.runtime.onConnect.addListener((port) => {
    handleStreamPort(port as unknown as RuntimePortLike)
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    router(message, sender)
      .then((result) => {
        sendResponse({ success: true, data: result })
      })
      .catch((error) => {
        const msg = error instanceof Error ? error.message : '未知错误'
        sendResponse({
          success: false,
          error: msg,
          code: error instanceof AppError ? error.code : 'NETWORK_FAILED',
        })
      })
    return true
  })
})
