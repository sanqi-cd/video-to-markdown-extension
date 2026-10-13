import type { BridgePayload } from '../shared/page-bridge'
import { parseYouTubeInitialPlayerResponse } from './main-world-parser'

const INNERTUBE_PLAYER = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
const REQUEST_TIMEOUT_MS = 15_000
type YouTubeClient = { clientName: string; clientVersion: string }

const FALLBACK_CLIENTS: YouTubeClient[] = [
  // This client is also used by the active YouTube-page caption bridge and is
  // less dependent on expiring WEB caption URLs.
  { clientName: 'ANDROID', clientVersion: '20.10.38' },
  // Retained as a final compatibility fallback for videos unavailable to the
  // Android client. A current WEB version discovered from the watch page is
  // always tried before this value.
  { clientName: 'WEB', clientVersion: '2.20240815.01.00' },
]

export async function fetchYouTubeBridgePayload(
  videoId: string,
  fetchImpl: typeof fetch,
): Promise<BridgePayload | null> {
  const watchPage = await fetchFromWatchPage(videoId, fetchImpl)
  const clients = uniqueClients([
    ...(watchPage?.client ? [watchPage.client] : []),
    ...FALLBACK_CLIENTS,
  ])
  const apiPayloads = await Promise.all(
    clients.map((client) => fetchFromInnertube(videoId, fetchImpl, client)),
  )
  return mergeBridgePayloads(videoId, [
    watchPage?.payload ?? null,
    ...apiPayloads,
  ])
}

async function fetchFromInnertube(
  videoId: string,
  fetchImpl: typeof fetch,
  client: YouTubeClient,
): Promise<BridgePayload | null> {
  let response: Response
  try {
    response = await fetchImpl(INNERTUBE_PLAYER, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        context: { client },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  return parseYouTubeInitialPlayerResponse(body)
}

async function fetchFromWatchPage(
  videoId: string,
  fetchImpl: typeof fetch,
): Promise<{ payload: BridgePayload | null; client: YouTubeClient | null } | null> {
  let response: Response
  try {
    response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'include',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const html = await response.text().catch(() => '')
  const playerResponse = extractYtInitialPlayerResponse(html)
  return {
    payload: playerResponse === null ? null : parseYouTubeInitialPlayerResponse(playerResponse),
    client: extractYouTubeClient(html),
  }
}

function extractYouTubeClient(html: string): YouTubeClient | null {
  const name = firstJsonString(html, ['INNERTUBE_CLIENT_NAME', 'INNERTUBE_CONTEXT_CLIENT_NAME'])
  const version = firstJsonString(html, [
    'INNERTUBE_CLIENT_VERSION',
    'INNERTUBE_CONTEXT_CLIENT_VERSION',
  ])
  if (!name || !version) return null
  return { clientName: name, clientVersion: version }
}

function firstJsonString(source: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'u'))
    if (match?.[1]) return match[1]
  }
  return null
}

function uniqueClients(clients: YouTubeClient[]): YouTubeClient[] {
  const seen = new Set<string>()
  return clients.filter((client) => {
    const key = `${client.clientName}:${client.clientVersion}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeBridgePayloads(
  videoId: string,
  payloads: Array<BridgePayload | null>,
): BridgePayload | null {
  const valid = payloads.filter(
    (payload): payload is BridgePayload => payload?.videoId === videoId,
  )
  if (valid.length === 0) return null
  const base = valid[0]!
  const tracks = new Map<string, BridgePayload['tracks'][number]>()

  for (const payload of valid) {
    for (const track of payload.tracks) {
      const key = `${track.vssId}\u0000${track.languageCode}`
      const existing = tracks.get(key)
      if (!existing) {
        tracks.set(key, { ...track })
        continue
      }
      const urls = [...new Set([
        existing.baseUrl,
        ...(existing.alternateBaseUrls ?? []),
        track.baseUrl,
        ...(track.alternateBaseUrls ?? []),
      ])]
      tracks.set(key, {
        ...existing,
        alternateBaseUrls: urls.slice(1),
      })
    }
  }

  return {
    ...base,
    tracks: [...tracks.values()],
  }
}

export function extractYtInitialPlayerResponse(html: string): unknown | null {
  const marker = 'ytInitialPlayerResponse'
  const start = html.indexOf(marker)
  if (start < 0) return null
  const equals = html.indexOf('=', start + marker.length)
  if (equals < 0) return null
  let index = equals + 1
  while (index < html.length && html[index] === ' ') index += 1
  if (html[index] !== '{') return null
  return parseBalancedJsonObject(html, index)
}

function parseBalancedJsonObject(source: string, start: number): unknown | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}
