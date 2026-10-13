const YOUTUBE_ID_PATTERN = /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|live\/|shorts\/|live_stream\?.*v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi
const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/

/** Parse a single user-provided YouTube URL without accepting lookalike hosts. */
export function parseYouTubeVideoUrl(value: string): string | null {
  const input = value.trim()
  if (input.length === 0) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null

  const hostname = url.hostname.toLowerCase()
  let videoId: string | null = null
  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (
    hostname === 'youtube.com'
    || hostname === 'www.youtube.com'
    || hostname === 'm.youtube.com'
    || hostname === 'music.youtube.com'
  ) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v')
    } else {
      const match = url.pathname.match(/^\/(?:embed|live|shorts)\/([^/?#]+)/)
      videoId = match?.[1] ?? null
    }
  }

  const normalized = videoId?.trim() ?? ''
  return YOUTUBE_VIDEO_ID.test(normalized) ? normalized : null
}

export function extractYouTubeVideoIds(text: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(YOUTUBE_ID_PATTERN)) {
    const id = match[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function youtubeFallbackTrackId(videoId: string, vssId: string): string {
  return `yt:${videoId}:${vssId}`
}

export function parseYouTubeFallbackTrackId(
  trackId: string,
): { videoId: string; vssId: string } | null {
  if (!trackId.startsWith('yt:')) return null
  const rest = trackId.slice(3)
  const separator = rest.indexOf(':')
  if (separator <= 0) return null
  const videoId = rest.slice(0, separator)
  const vssId = rest.slice(separator + 1)
  if (videoId.length === 0 || vssId.length === 0) return null
  return { videoId, vssId }
}
