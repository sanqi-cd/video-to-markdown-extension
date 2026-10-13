import { z } from 'zod'
import { AppError } from '../errors/app-error'
import { audioToWavDataUrl, buildArkAudioRequest, parseArkAudioResponse } from './ark-responses'
import type {
  TranscriptionConfig,
  TranscriptionResult,
  TranscriptionSegment,
} from './contracts'

const VerboseResponseSchema = z.object({
  text: z.string().default(''),
  language: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  segments: z.array(z.object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    text: z.string(),
  })).optional(),
})

const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 120_000

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(header)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

export async function transcribeAudioChunk(
  blob: Blob,
  config: TranscriptionConfig,
  chunkDurationMs: number,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const ark = config.protocol === 'ark-responses'
  if (signal?.aborted) throw new AppError('TRANSCRIPTION_FAILED', '转录已取消')
  let requestBody: string | FormData
  if (ark) {
    requestBody = JSON.stringify(buildArkAudioRequest(config, await audioToWavDataUrl(blob)))
  } else {
    const form = new FormData()
    form.append('file', blob, 'audio.webm')
    form.append('model', config.model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    if (config.language !== 'auto') form.append('language', config.language)
    requestBody = form
  }
  let response: Response
  let raw: string
  const requestController = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    requestController.abort()
  }, TRANSCRIPTION_REQUEST_TIMEOUT_MS)
  const onAbort = () => requestController.abort(signal?.reason)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(ark ? { 'Content-Type': 'application/json' } : {}) },
      body: requestBody,
      signal: requestController.signal,
    })
    raw = await response.text()
  } catch (error) {
    throw new AppError('TRANSCRIPTION_FAILED', timedOut
      ? '音频转录请求等待超过 2 分钟，已停止以避免一直卡住'
      : '音频转录请求失败，请检查网络连接', {
      cause: error,
      retryable: !signal?.aborted,
    })
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new AppError(
      response.status === 401 || response.status === 403
        ? 'INVALID_TRANSCRIPTION_CONFIG'
        : 'TRANSCRIPTION_FAILED',
      `转录接口请求失败（HTTP ${response.status}），请检查接口、模型权限和额度`,
      {
        retryable: isTransientStatus(response.status),
        retryAfterMs: parseRetryAfterMs(response.headers?.get('retry-after') ?? null),
      },
    )
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    if (ark) throw new AppError('TRANSCRIPTION_FAILED', '火山方舟返回非 JSON 响应')
    const text = raw.trim()
    if (!text) throw new AppError('TRANSCRIPTION_FAILED', '转录接口返回了空内容')
    return {
      text,
      segments: [{ startMs: 0, endMs: chunkDurationMs, text }],
    }
  }

  if (typeof body === 'object' && body !== null && 'error' in body) {
    throw new AppError('TRANSCRIPTION_FAILED', '转录接口返回错误，请检查模型权限和服务状态')
  }

  if (ark) return parseArkAudioResponse(body, chunkDurationMs)

  const parsed = VerboseResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('TRANSCRIPTION_FAILED', '转录接口返回格式不符合预期')
  }

  const segments: TranscriptionSegment[] = (parsed.data.segments ?? [])
    .map((segment) => ({
      startMs: Math.round(segment.start * 1_000),
      endMs: Math.round(segment.end * 1_000),
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.text.length > 0 && segment.endMs >= segment.startMs)
  const text = parsed.data.text.trim()
  if (segments.length > 0) {
    return { text, language: parsed.data.language, segments }
  }
  // A successful empty response is valid for a silent chunk. Treat it as an
  // empty cue list instead of aborting an otherwise healthy long recording.
  if (!text) return { text: '', language: parsed.data.language, segments: [] }
  return {
    text,
    language: parsed.data.language,
    segments: [{ startMs: 0, endMs: chunkDurationMs, text }],
  }
}
