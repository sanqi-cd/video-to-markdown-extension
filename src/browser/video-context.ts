import { z } from 'zod'
import type { VideoMetadata } from '../core/contracts'
import type { VideoContextState } from '../core/product-state'
import { AppError } from '../errors/app-error'
import { BridgeEventSchema, PAGE_BRIDGE_VERSION, type BridgePayload } from '../adapters/shared/page-bridge'
import { BilibiliContextSchema, type BilibiliContextPayload } from '../adapters/bilibili/schemas'
import type { ActiveTabSnapshot } from './active-tab'

const VideoContextEnvelopeSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    bridgeVersion: z.number().int().positive(),
    platform: z.enum(['youtube', 'bilibili']),
    data: z.unknown(),
  }),
  z.object({
    success: z.literal(false),
    bridgeVersion: z.number().int().positive(),
    code: z.enum(['CONTEXT_NOT_READY']),
    error: z.string().optional(),
  }),
])

export type PlatformVideoContext =
  | { platform: 'youtube'; data: BridgePayload }
  | { platform: 'bilibili'; data: BilibiliContextPayload }

type SendMessage = (tabId: number, message: { type: 'VIDEO_CONTEXT_REQUEST' }) => Promise<unknown>

type RequestVideoContextOptions = {
  attempts?: number
  retryDelayMs?: number
  sendMessage?: SendMessage
  sleep?: (ms: number) => Promise<void>
}

export async function requestVideoContext(
  tab: ActiveTabSnapshot,
  options: RequestVideoContextOptions = {},
): Promise<PlatformVideoContext> {
  if (!tab.video) throw new AppError('UNSUPPORTED_PAGE', '当前页面不是支持的视频页面')

  const attempts = Math.max(1, options.attempts ?? 5)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 200)
  const sendMessage = options.sendMessage
    ?? ((tabId, message) => chrome.tabs.sendMessage(tabId, message))
  const sleep = options.sleep
    ?? ((ms) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let raw: unknown
    try {
      raw = await sendMessage(tab.tabId, { type: 'VIDEO_CONTEXT_REQUEST' })
    } catch {
      if (attempt < attempts - 1) await sleep(retryDelayMs)
      continue
    }

    const parsed = VideoContextEnvelopeSchema.safeParse(raw)
    if (!parsed.success) {
      if (raw === undefined || raw === null) {
        if (attempt < attempts - 1) await sleep(retryDelayMs)
        continue
      }
      if (isLegacyBridgeResponse(raw)) {
        throw new AppError('CONTENT_SCRIPT_UNAVAILABLE', '页面脚本版本过旧，请刷新视频页面')
      }
      throw new AppError('PAGE_CONTEXT_INVALID', '页面脚本返回了无法识别的视频信息')
    }

    if (parsed.data.bridgeVersion !== PAGE_BRIDGE_VERSION) {
      throw new AppError('CONTENT_SCRIPT_UNAVAILABLE', '页面脚本版本不匹配，请刷新视频页面')
    }

    if (!parsed.data.success) {
      if (attempt < attempts - 1) await sleep(retryDelayMs)
      continue
    }

    if (parsed.data.platform !== tab.video.platform) {
      throw new AppError('PAGE_CONTEXT_INVALID', '活动页面与视频上下文平台不一致')
    }

    if (parsed.data.platform === 'youtube') {
      const payload = BridgeEventSchema.safeParse(parsed.data.data)
      if (!payload.success) {
        throw new AppError('PAGE_CONTEXT_INVALID', 'YouTube 页面返回的视频信息格式异常')
      }
      if (payload.data.videoId !== tab.video.videoId) {
        if (attempt < attempts - 1) await sleep(retryDelayMs)
        continue
      }
      return { platform: 'youtube', data: payload.data }
    }

    const payload = BilibiliContextSchema.safeParse(parsed.data.data)
    if (!payload.success) {
      throw new AppError('PAGE_CONTEXT_INVALID', '哔哩哔哩页面返回的视频信息格式异常')
    }
    if (payload.data.bvid !== tab.video.videoId) {
      if (attempt < attempts - 1) await sleep(retryDelayMs)
      continue
    }
    return { platform: 'bilibili', data: payload.data }
  }

  throw new AppError('CONTENT_SCRIPT_UNAVAILABLE', '页面脚本尚未准备完成，请刷新视频页面')
}

export function mapVideoContextError(
  error: unknown,
  options: { tabId: number; metadata?: VideoMetadata },
): VideoContextState {
  if (error instanceof AppError && error.code === 'CONTENT_SCRIPT_UNAVAILABLE') {
    return { status: 'refresh-required', tabId: options.tabId }
  }
  if (error instanceof AppError && error.code === 'NO_SUBTITLE' && options.metadata) {
    return { status: 'no-subtitle', metadata: options.metadata }
  }
  if (error instanceof AppError) return { status: 'failed', error: error.toJSON() }
  return {
    status: 'failed',
    error: {
      code: 'PAGE_CONTEXT_INVALID',
      message: error instanceof Error ? error.message : '视频信息读取失败',
    },
  }
}

function isLegacyBridgeResponse(raw: unknown): boolean {
  return typeof raw === 'object'
    && raw !== null
    && 'success' in raw
    && !('bridgeVersion' in raw)
}
