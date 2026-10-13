import { AppError } from '../errors/app-error'
import type { StorageArea } from '../model/config-store'
import type { TranscriptionConfigStore } from './config-store'
import type {
  PlaybackEndedMessage,
  StartTabTranscriptionMessage,
  StopTabTranscriptionMessage,
} from './messages'
import type { TabTranscriptionEvent } from './contracts'

const OFFSCREEN_PATH = 'offscreen.html'
const ACTIVE_TABS_KEY = 'transcription.activeTabs'

type ChromeSender = Pick<chrome.runtime.MessageSender, 'id' | 'origin' | 'tab' | 'url'>

/** Maps running transcription task ids to the tab whose playback they control. */
export type ActiveTabRegistry = {
  get(taskId: string): Promise<number | undefined>
  set(taskId: string, tabId: number): Promise<void>
  delete(taskId: string): Promise<void>
  size(): Promise<number>
  clear(): Promise<void>
}

export function createMemoryTabRegistry(): ActiveTabRegistry {
  const tabs = new Map<string, number>()
  return {
    get: async (taskId) => tabs.get(taskId),
    set: async (taskId, tabId) => { tabs.set(taskId, tabId) },
    delete: async (taskId) => { tabs.delete(taskId) },
    size: async () => tabs.size,
    clear: async () => { tabs.clear() },
  }
}

/**
 * Survives service worker restarts during long recordings, so a late failure
 * event can still stop playback in the right tab.
 */
export function createSessionTabRegistry(area: StorageArea): ActiveTabRegistry {
  let queue: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<Record<string, number>> => {
    const stored = (await area.get([ACTIVE_TABS_KEY]))[ACTIVE_TABS_KEY]
    return typeof stored === 'object' && stored !== null
      ? { ...stored as Record<string, number> }
      : {}
  }
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.catch(() => undefined)
    return next
  }
  return {
    get: (taskId) => serialized(async () => (await read())[taskId]),
    set: (taskId, tabId) => serialized(async () => {
      await area.set({ [ACTIVE_TABS_KEY]: { ...await read(), [taskId]: tabId } })
    }),
    delete: (taskId) => serialized(async () => {
      const tabs = await read()
      if (!(taskId in tabs)) return
      delete tabs[taskId]
      await area.set({ [ACTIVE_TABS_KEY]: tabs })
    }),
    size: () => serialized(async () => Object.keys(await read()).length),
    clear: () => serialized(() => area.remove([ACTIVE_TABS_KEY])),
  }
}

function isCaptureRunning(captures: chrome.tabCapture.CaptureInfo[]): boolean {
  return captures.some((capture) => capture.status === 'active' || capture.status === 'pending')
}

export class TranscriptionBackgroundController {
  private starting = false

  constructor(
    private readonly configStore: TranscriptionConfigStore,
    private readonly isTrustedSender: (sender: ChromeSender) => boolean,
    private readonly activeTabs: ActiveTabRegistry,
  ) {}

  async start(
    message: StartTabTranscriptionMessage,
    sender: ChromeSender,
  ): Promise<{ taskId: string }> {
    this.assertTrusted(sender)
    if (this.starting) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '已有转录任务正在启动或运行，请先停止当前任务后重试')
    }
    this.starting = true
    try {
      if (await this.activeTabs.size() > 0) {
        if (isCaptureRunning(await chrome.tabCapture.getCapturedTabs())) {
          throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '已有转录任务正在启动或运行，请先停止当前任务后重试')
        }
        // Entries left behind by a session that ended without reporting back.
        await this.activeTabs.clear()
      }
      return await this.startExclusive(message)
    } finally {
      this.starting = false
    }
  }

  private async startExclusive(message: StartTabTranscriptionMessage): Promise<{ taskId: string }> {
    const config = await this.configStore.get()
    if (!config) {
      throw new AppError('INVALID_TRANSCRIPTION_CONFIG', '请先配置语音转写 API')
    }

    const tab = await chrome.tabs.get(message.tabId).catch(() => null)
    if (!tab?.id || !tab.url?.startsWith('https://www.bilibili.com/')) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '只能转录当前打开的 B 站视频标签页')
    }
    if (!tab.active) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '请切换到要转录的 B 站视频标签页，再点击浏览器工具栏中的 Video to Markdown 图标后重试')
    }
    if (isCaptureRunning(await chrome.tabCapture.getCapturedTabs())) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '已有标签页音频采集尚未结束，请停止当前录音或转录；若仍无法恢复，请重新加载插件后重试')
    }

    await ensureOffscreenDocument()
    const taskId = message.taskId
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(taskId)) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '转录任务标识无效，请重新开始')
    }
    let streamId: string
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId })
    } catch (cause) {
      throw captureStartupError(cause)
    }

    const started = await chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_OFFSCREEN_START',
      target: 'offscreen',
      taskId,
      streamId,
      metadata: message.metadata,
      config,
    }).catch((cause) => ({ success: false, error: cause instanceof Error ? cause.message : '' }))
    if (!started?.success) {
      await this.stopOffscreen(taskId, true).catch(() => undefined)
      throw new AppError(
        'TRANSCRIPTION_CAPTURE_FAILED',
        '后台音频采集器启动失败，请重新加载插件，并在当前视频页点击插件图标后重试',
      )
    }

    await this.activeTabs.set(taskId, message.tabId)

    const playback = await chrome.tabs.sendMessage(message.tabId, {
      type: 'TRANSCRIPTION_PREPARE_PLAYBACK',
      taskId,
    }).catch((cause) => ({ success: false, error: cause instanceof Error ? cause.message : '' }))
    if (!playback?.success) {
      await this.stopOffscreen(taskId, true).catch(() => undefined)
      await this.stopPlayback(taskId)
      await this.activeTabs.delete(taskId)
      throw new AppError(
        'TRANSCRIPTION_CAPTURE_FAILED',
        '无法从视频开头开始播放，已停止采集；请刷新 B 站页面后重试',
      )
    }
    return { taskId }
  }

  async stop(
    message: StopTabTranscriptionMessage,
    sender: ChromeSender,
  ): Promise<{ stopped: boolean }> {
    this.assertTrusted(sender)
    try {
      await this.stopOffscreen(message.taskId, true)
    } finally {
      await this.stopPlayback(message.taskId)
    }
    return { stopped: true }
  }

  async playbackEnded(
    message: PlaybackEndedMessage,
    sender: ChromeSender,
  ): Promise<{ stopped: boolean }> {
    this.assertTrusted(sender)
    await this.stopOffscreen(message.taskId, false)
    await this.activeTabs.delete(message.taskId)
    return { stopped: true }
  }

  async handleEvent(event: TabTranscriptionEvent): Promise<void> {
    if (event.type !== 'failed' && event.type !== 'completed') return
    if (event.type === 'failed') await this.stopPlayback(event.taskId)
    await this.activeTabs.delete(event.taskId)
  }

  private assertTrusted(sender: ChromeSender): void {
    if (!this.isTrustedSender(sender)) {
      throw new AppError('TRANSCRIPTION_CAPTURE_FAILED', '拒绝来自非插件页面的转录请求')
    }
  }

  private async stopOffscreen(taskId: string, stoppedEarly: boolean): Promise<void> {
    const response = await chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_OFFSCREEN_STOP',
      target: 'offscreen',
      taskId,
      stoppedEarly,
    }).catch(() => null)
    if (response && response.success === false) {
      throw new AppError(
        'TRANSCRIPTION_CAPTURE_FAILED',
        response.error || '停止后台音频采集失败',
      )
    }
  }

  private async stopPlayback(taskId: string): Promise<void> {
    const tabId = await this.activeTabs.get(taskId)
    if (tabId === undefined) return
    await chrome.tabs.sendMessage(tabId, {
      type: 'TRANSCRIPTION_STOP_PLAYBACK',
      taskId,
    }).catch(() => undefined)
  }
}

export function captureStartupError(cause: unknown): AppError {
  const detail = cause instanceof Error ? cause.message : String(cause)
  let message = '浏览器未能启动音频采集。请在当前视频页点击浏览器工具栏中的 Video to Markdown 图标后重试；仍失败时请重新加载插件'
  if (/invoked|activeTab|permission|not allowed|not been granted/iu.test(detail)) {
    message = '尚未获得当前标签页的音频采集授权。请保持此视频页为当前标签页，点击浏览器工具栏（或扩展菜单）中的 Video to Markdown 图标，再点击“开始直接转录”。仅重新检测字幕不会获得授权'
  } else if (/active stream|already|captur.*progress/iu.test(detail)) {
    message = '当前标签页音频正在被采集，请先停止已有录音或转录，再重试'
  } else if (/No tab|Invalid tab|closed/iu.test(detail)) {
    message = '目标视频标签页已关闭或失效，请回到视频页重新打开插件后重试'
  }
  // Never expose browser internals, URLs or credentials in public errors.
  return new AppError('TRANSCRIPTION_CAPTURE_FAILED', message, { cause })
}

async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_PATH)
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [documentUrl],
  })
  if (contexts.length > 0) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: '采集用户主动选择的当前 B 站标签页音频并生成字幕',
  })
}
