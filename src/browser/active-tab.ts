import type { Platform } from '../core/contracts'
import { AppError } from '../errors/app-error'

export type VideoUrlMatch = {
  platform: Platform
  videoId: string
}

export type ActiveTabSnapshot = {
  tabId: number
  url: string
  video: VideoUrlMatch | null
}

type TabQuery = (
  queryInfo: chrome.tabs.QueryInfo,
) => Promise<Array<Pick<chrome.tabs.Tab, 'id' | 'url'>>>

export function classifyVideoUrl(input: string | undefined): VideoUrlMatch | null {
  if (!input) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null

  const hostname = url.hostname.toLowerCase()
  const youtubeHost = hostname === 'youtube.com'
    || hostname === 'www.youtube.com'
    || hostname === 'm.youtube.com'
  if (youtubeHost && url.pathname === '/watch') {
    const videoId = url.searchParams.get('v')?.trim()
    return videoId ? { platform: 'youtube', videoId } : null
  }

  const bilibiliHost = hostname === 'bilibili.com' || hostname === 'www.bilibili.com'
  if (bilibiliHost) {
    const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]+)(?:\/|$)/i)
    if (match?.[1]) return { platform: 'bilibili', videoId: match[1] }
  }

  return null
}

export async function getActiveTabSnapshot(
  query: TabQuery = (queryInfo) => chrome.tabs.query(queryInfo),
): Promise<ActiveTabSnapshot> {
  const [tab] = await query({ active: true, currentWindow: true })
  if (tab?.id === undefined) {
    throw new AppError('ACTIVE_TAB_UNAVAILABLE', '无法读取当前活动标签页')
  }
  const url = tab.url ?? ''
  return { tabId: tab.id, url, video: classifyVideoUrl(url) }
}

export function activeTabIdentity(tab: ActiveTabSnapshot): string {
  if (tab.video) return `${tab.tabId}:${tab.video.platform}:${tab.video.videoId}`
  return `${tab.tabId}:unsupported:${tab.url}`
}

export function shouldConfirmTabSwitch(
  current: ActiveTabSnapshot | null,
  next: ActiveTabSnapshot,
  hasTask: boolean,
): boolean {
  return hasTask && current !== null && activeTabIdentity(current) !== activeTabIdentity(next)
}

type TabUpdatedListener = (
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
) => void

export type ReloadTabDeps = {
  reload: (tabId: number) => Promise<void>
  addUpdatedListener: (listener: TabUpdatedListener) => void
  removeUpdatedListener: (listener: TabUpdatedListener) => void
  timeoutMs?: number
}

export async function reloadTabAndWait(
  tabId: number,
  deps: ReloadTabDeps = {
    reload: (id) => chrome.tabs.reload(id),
    addUpdatedListener: (listener) => chrome.tabs.onUpdated.addListener(listener),
    removeUpdatedListener: (listener) => chrome.tabs.onUpdated.removeListener(listener),
  },
): Promise<void> {
  const timeoutMs = deps.timeoutMs ?? 15_000
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timeout)
      deps.removeUpdatedListener(onUpdated)
      if (error) reject(error)
      else resolve()
    }
    const onUpdated: TabUpdatedListener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish()
    }
    const timeout = globalThis.setTimeout(() => {
      finish(new AppError('TAB_RELOAD_TIMEOUT', '页面刷新超时，请手动刷新后重试'))
    }, timeoutMs)

    deps.addUpdatedListener(onUpdated)
    void deps.reload(tabId).catch((error) => {
      finish(new AppError('NETWORK_FAILED', '页面刷新失败', { cause: error }))
    })
  })
}
