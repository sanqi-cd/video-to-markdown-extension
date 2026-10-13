import { createMessageRouter } from '../src/core/messages'
import { createConfigStore } from '../src/model/config-store'
import { OpenAICompatibleProvider } from '../src/model/openai-provider'
import { AppError } from '../src/errors/app-error'
import type { ModelConfig } from '../src/model/config-store'
import { isTrustedExtensionSender } from '../src/browser/extension-origin'
import { createServiceWorkerKeepAlive } from '../src/browser/keep-alive'
import { createTranscriptionConfigStore } from '../src/transcription/config-store'
import {
  createSessionTabRegistry,
  TranscriptionBackgroundController,
} from '../src/transcription/background-controller'
import { isTranscriptionRuntimeMessage } from '../src/transcription/messages'
import {
  createStreamPortHandler,
  MODEL_STREAM_PORT,
  type RuntimePortLike,
} from '../src/model/stream-port'

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })

  const configStore = createConfigStore(chrome.storage.local)
  const transcriptionConfigStore = createTranscriptionConfigStore(chrome.storage.local)
  const activeRequests = new Map<string, AbortController>()
  const keepAlive = createServiceWorkerKeepAlive(() => {
    chrome.runtime.getPlatformInfo(() => {})
  })
  const isExtensionOrigin = (sender: { url?: string; id?: string; origin?: string }) => (
    isTrustedExtensionSender(sender, chrome.runtime)
  )
  const transcriptionController = new TranscriptionBackgroundController(
    transcriptionConfigStore,
    (sender) => sender.id === chrome.runtime.id || isExtensionOrigin(sender),
    createSessionTabRegistry(chrome.storage.session),
  )

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
    if (port.name === MODEL_STREAM_PORT) {
      keepAlive.acquire()
      port.onDisconnect.addListener(() => keepAlive.release())
    }
    handleStreamPort(port as unknown as RuntimePortLike)
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isTranscriptionRuntimeMessage(message)) {
      // Offscreen commands and emitted progress events are consumed by their
      // intended extension contexts, not by the model message router.
      if (message.type === 'TRANSCRIPTION_EVENT') {
        void transcriptionController.handleEvent(message.event)
        return undefined
      }
      if (
        message.type !== 'TRANSCRIPTION_START_REQUEST'
        && message.type !== 'TRANSCRIPTION_STOP_REQUEST'
        && message.type !== 'TRANSCRIPTION_PLAYBACK_ENDED'
      ) return undefined

      const operation = message.type === 'TRANSCRIPTION_START_REQUEST'
        ? transcriptionController.start(message, sender)
        : message.type === 'TRANSCRIPTION_STOP_REQUEST'
          ? transcriptionController.stop(message, sender)
          : transcriptionController.playbackEnded(message, sender)
      operation
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => sendResponse({
          success: false,
          error: error instanceof Error ? error.message : '转录操作失败',
          code: error instanceof AppError ? error.code : 'TRANSCRIPTION_CAPTURE_FAILED',
        }))
      return true
    }

    const keepMessageAlive = typeof message === 'object'
      && message !== null
      && 'type' in message
      && (message.type === 'MODEL_COMPLETE_REQUEST' || message.type === 'MODEL_TEST_REQUEST')
    if (keepMessageAlive) keepAlive.acquire()
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
      .finally(() => {
        if (keepMessageAlive) keepAlive.release()
      })
    return true
  })
})
