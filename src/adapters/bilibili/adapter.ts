import { AppError } from '../../errors/app-error'
import {
  BilibiliSubtitleListSchema,
  BilibiliSubtitleBodySchema,
  BilibiliReplySchema,
  BilibiliViewSchema,
} from './schemas'
import type { BilibiliContextPayload } from './schemas'
import type { SubtitleAdapter, SubtitleTrack, SubtitleCue, VideoMetadata } from '../../core/contracts'
import type { BridgePayload } from '../shared/page-bridge'
import {
  extractYouTubeVideoIds,
  parseYouTubeFallbackTrackId,
  youtubeFallbackTrackId,
} from '../shared/youtube-video-id'
import { selectMatchingYouTubeSource, youtubeIdsBoostedBySourceContext } from '../shared/youtube-source-match'
import { YouTubeAdapter } from '../youtube/adapter'
import { fetchYouTubeBridgePayload } from '../youtube/watch-page'
import {
  documentParagraphsToCues,
  extractBilibiliOpusIds,
  isCompletePublisherTranscript,
  looksLikeEmbeddedTranscript,
  parseBilibiliOpusHtml,
  publisherTranscriptMinimumChars,
  publisherTranscriptTextChars,
  type PublisherTranscriptDiscovery,
} from './publisher-transcript'

const PLAYER_API = 'https://api.bilibili.com/x/player/v2'
const VIEW_API = 'https://api.bilibili.com/x/web-interface/view'
const REPLY_API = 'https://api.bilibili.com/x/v2/reply'
const ALLOWED_SUBTITLE_HOST_SUFFIX = '.hdslb.com'

type TrackInfo = {
  id: number
  lan: string
  lan_doc: string
  subtitle_url: string
  ai_status?: number
}

export class BilibiliAdapter implements SubtitleAdapter {
  private readonly context: BilibiliContextPayload
  private readonly fetchImpl: typeof fetch
  private trackList: TrackInfo[] | null = null
  private youtubePayloads = new Map<string, BridgePayload>()
  private extraDescription = ''
  private ownerMid: number | null = null
  private manualYoutubeVideoId: string | null = null
  private publisherTracks: SubtitleTrack[] = []
  private publisherDocuments = new Map<string, string[]>()
  private transcriptionTracks: SubtitleTrack[] = []
  private transcriptionCues = new Map<string, SubtitleCue[]>()

  constructor(
    context: BilibiliContextPayload,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.context = context
    this.fetchImpl = fetchImpl
  }

  supports(url: URL): boolean {
    return (
      url.hostname === 'www.bilibili.com' || url.hostname === 'bilibili.com'
    )
  }

  async getVideoMetadata(): Promise<VideoMetadata> {
    const { bvid, page, title, author, durationMs } = this.context
    return {
      platform: 'bilibili',
      videoId: bvid,
      title,
      author,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}`,
      durationMs,
    }
  }

  async getSubtitleTracks(): Promise<SubtitleTrack[]> {
    const biliTracks = await this.fetchTrackList()
    const youtubeTracks = await this.loadYouTubeFallbackTracks()
    const tracks = [
      ...this.transcriptionTracks,
      ...this.publisherTracks,
      ...this.mapBilibiliTracks(biliTracks),
      ...youtubeTracks,
    ]
    if (tracks.length === 0) {
      throw new AppError(
        'NO_SUBTITLE',
        '当前视频无可访问的字幕。画面上的硬字幕无法提取；简介中的 YouTube 链接只有时长和标题与当前视频接近时才会使用',
      )
    }
    return tracks
  }

  /** Register audio transcription produced for this exact page session. */
  registerTranscription(
    taskId: string,
    cues: SubtitleCue[],
    language: string,
    recordedMs: number,
    stoppedEarly: boolean,
  ): SubtitleTrack {
    if (cues.length === 0) {
      throw new AppError('TRANSCRIPTION_FAILED', '音频转写完成，但没有识别到可用文字')
    }
    const trackId = `bili-asr:${taskId}`
    const normalizedLanguage = normalizeTranscriptionLanguage(
      language,
      cues.map((cue) => cue.text).join('\n'),
    )
    const track: SubtitleTrack = {
      id: trackId,
      language: normalizedLanguage,
      label: stoppedEarly ? '音频转写（未完整播放）' : '音频转写',
      sourceDurationMs: stoppedEarly ? recordedMs : this.context.durationMs,
      sourceGroup: `bilibili:${this.context.bvid}:${this.context.cid}:asr`,
      sourceKind: 'audio-transcription',
      hasTimestamps: true,
    }
    this.transcriptionCues.set(trackId, cues)
    this.transcriptionTracks = [track]
    return track
  }

  /** Find a transcript explicitly published by the uploader for this exact Bilibili upload. */
  async discoverPublisherTranscript(): Promise<PublisherTranscriptDiscovery> {
    await this.fetchViewDescription()
    const pinned = await this.fetchUploaderPinnedReply()
    const sourceText = [this.context.description, this.extraDescription, pinned?.message]
      .filter(Boolean)
      .join('\n')
    const opusIds = extractBilibiliOpusIds(sourceText).slice(0, 3)
    const expectedAuthorMid = this.ownerMid ?? pinned?.authorMid ?? null
    let locked: PublisherTranscriptDiscovery | null = null

    if (expectedAuthorMid !== null) {
      for (const opusId of opusIds) {
        const parsed = await this.fetchPublisherOpus(opusId, expectedAuthorMid)
        if (!parsed) continue
        const url = `https://www.bilibili.com/opus/${opusId}`
        if (parsed.status === 'locked') {
          locked ??= { status: 'locked', url, message: parsed.message }
          continue
        }
        if (!isCompletePublisherTranscript(parsed.paragraphs, this.context.durationMs)) continue
        this.registerPublisherDocument(
          `opus-${opusId}`,
          parsed.title,
          parsed.paragraphs,
        )
        return { status: 'loaded' }
      }
    }

    if (locked) return locked

    const embedded = this.extraDescription || this.context.description || ''
    const embeddedParagraphs = embedded
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    if (
      looksLikeEmbeddedTranscript(embedded)
      && isCompletePublisherTranscript(embeddedParagraphs, this.context.durationMs)
    ) {
      this.registerPublisherDocument('description', '视频简介中的发布者文稿', embeddedParagraphs)
      return { status: 'loaded' }
    }

    const actualChars = publisherTranscriptTextChars(embeddedParagraphs)
    const minimumChars = publisherTranscriptMinimumChars(this.context.durationMs)
    const detail = actualChars > 0 && looksLikeEmbeddedTranscript(embedded)
      ? `简介内容只有 ${actualChars} 字，未达到当前视频至少 ${minimumChars} 字的完整性要求。`
      : ''
    return {
      status: 'not-found',
      message: `${detail}没有找到可直接读取的完整发布者文稿。`.trim(),
    }
  }

  /** Load one exact, user-selected YouTube source and make its tracks selectable. */
  async useManualYouTubeSource(videoId: string): Promise<SubtitleTrack[]> {
    const payload = await fetchYouTubeBridgePayload(videoId, this.fetchImpl)
    if (!payload || payload.videoId !== videoId) {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        '无法读取这个 YouTube 原视频，请确认链接有效且视频可以正常访问',
      )
    }
    if (payload.tracks.length === 0) {
      throw new AppError('NO_SUBTITLE', '这个 YouTube 原视频也没有可访问的字幕')
    }

    this.manualYoutubeVideoId = videoId
    this.youtubePayloads = new Map([[videoId, payload]])
    const biliTracks = await this.fetchTrackList()
    return [
      ...this.mapBilibiliTracks(biliTracks),
      ...this.mapYouTubeTracks(videoId, payload),
    ]
  }

  async getCues(track: SubtitleTrack): Promise<SubtitleCue[]> {
    const transcription = this.transcriptionCues.get(track.id)
    if (transcription) return transcription

    const publisherDocument = this.publisherDocuments.get(track.id)
    if (publisherDocument) {
      return documentParagraphsToCues(publisherDocument, this.context.durationMs)
    }

    const youtubeRef = parseYouTubeFallbackTrackId(track.id)
    if (youtubeRef) {
      const payload = this.youtubePayloads.get(youtubeRef.videoId)
      if (!payload) {
        throw new AppError('SUBTITLE_EXTRACTION_FAILED', '未找到 YouTube 原视频字幕')
      }
      return new YouTubeAdapter(payload, this.fetchImpl).getCues({
        ...track,
        id: youtubeRef.vssId,
      })
    }

    const tracks = await this.fetchTrackList()
    const trackInfo = tracks.find((t) => String(t.id) === track.id)
    if (!trackInfo) {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '未找到指定的字幕轨道')
    }

    const url = new URL(trackInfo.subtitle_url, 'https://www.bilibili.com')
    if (
      url.protocol !== 'https:'
      || !(url.hostname === 'hdslb.com' || url.hostname.endsWith(ALLOWED_SUBTITLE_HOST_SUFFIX))
    ) {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕地址不在允许的 B 站域名内')
    }

    let response: Response
    try {
      response = await this.fetchImpl(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕数据获取失败')
    }

    if (!response.ok) {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        `字幕请求失败 (HTTP ${response.status})`,
      )
    }

    const rawText = await response.text().catch(() => '')
    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        `字幕数据格式异常，服务器返回了非 JSON 数据。响应预览: ${rawText.slice(0, 200)}`,
      )
    }

    const parsed = BilibiliSubtitleBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕数据结构不符合预期')
    }

    const cues = parsed.data.body
      .map((cue, index) => ({
        id: `bili-${index}`,
        startMs: Math.round(cue.from * 1000),
        endMs: Math.round(cue.to * 1000),
        text: cue.content,
      }))
      .filter((cue) => cue.text.trim().length > 0)
    if (cues.length === 0) {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        'B 站字幕轨道没有可提取的文字内容，请切换字幕或刷新页面后重试',
      )
    }
    return cues
  }

  private async fetchTrackList(): Promise<TrackInfo[]> {
    if (this.trackList !== null) return this.trackList

    // Only the player endpoint is scoped to the current cid. The view endpoint
    // may expose a subtitle list for a different part of a multi-part upload.
    // It is therefore used for description metadata only and never for tracks.
    const [fromPlayer] = await Promise.all([
      this.fetchPlayerTracks(),
      this.fetchViewDescription(),
    ])
    this.trackList = fromPlayer
    return this.trackList
  }

  private async fetchPlayerTracks(): Promise<TrackInfo[]> {
    const url = `${PLAYER_API}?bvid=${this.context.bvid}&cid=${this.context.cid}`
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
    } catch {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕列表获取失败')
    }

    if (!response.ok) {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        `字幕列表请求失败 (${response.status})`,
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕列表格式异常')
    }

    const parsed = BilibiliSubtitleListSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError('SUBTITLE_EXTRACTION_FAILED', '字幕列表结构不符合预期')
    }
    if (parsed.data.code !== 0) {
      throw new AppError(
        'SUBTITLE_EXTRACTION_FAILED',
        `字幕列表接口返回错误 (${parsed.data.code})`,
      )
    }

    const identity = parsed.data.data
    if ((identity.bvid !== undefined && identity.bvid !== this.context.bvid)
      || (identity.cid !== undefined && identity.cid !== this.context.cid)
      || (identity.aid !== undefined && this.context.aid > 0 && identity.aid !== this.context.aid)) {
      throw new AppError('SUBTITLE_UNRELIABLE', '字幕接口返回的视频标识与当前视频不一致，已拒绝使用')
    }
    return identity.subtitle?.subtitles ?? []
  }

  private async fetchViewDescription(): Promise<void> {
    let response: Response
    try {
      response = await this.fetchImpl(
        `${VIEW_API}?bvid=${this.context.bvid}`,
        { credentials: 'include', headers: { Accept: 'application/json' } },
      )
    } catch {
      return
    }
    if (!response.ok) return
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return
    }
    const parsed = BilibiliViewSchema.safeParse(body)
    if (!parsed.success || parsed.data.code !== 0) return
    if (parsed.data.data?.desc) this.extraDescription = parsed.data.data.desc
    if (parsed.data.data?.owner?.mid !== undefined) {
      this.ownerMid = parsed.data.data.owner.mid
    }
  }

  private async fetchUploaderPinnedReply(): Promise<{
    authorMid: number
    message: string
  } | null> {
    let response: Response
    try {
      const params = new URLSearchParams({
        type: '1',
        oid: String(this.context.aid),
        sort: '2',
        pn: '1',
        ps: '20',
      })
      response = await this.fetchImpl(`${REPLY_API}?${params}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
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
    const parsed = BilibiliReplySchema.safeParse(body)
    const upper = parsed.success && parsed.data.code === 0
      ? parsed.data.data?.upper
      : undefined
    const top = upper?.top
    if (!upper || !top || top.mid !== upper.mid) return null
    if (this.ownerMid !== null && upper.mid !== this.ownerMid) return null
    return { authorMid: upper.mid, message: top.content.message }
  }

  private async fetchPublisherOpus(opusId: string, expectedAuthorMid: number) {
    let response: Response
    try {
      response = await this.fetchImpl(`https://www.bilibili.com/opus/${opusId}`, {
        credentials: 'include',
        headers: { Accept: 'text/html' },
      })
    } catch {
      return null
    }
    if (!response.ok) return null
    const html = await response.text().catch(() => '')
    return parseBilibiliOpusHtml(html, opusId, expectedAuthorMid)
  }

  private registerPublisherDocument(id: string, title: string, paragraphs: string[]): void {
    const trackId = `bili-publisher:${id}`
    this.publisherDocuments.set(trackId, paragraphs)
    const language = detectDocumentLanguage(paragraphs.join('\n'))
    this.publisherTracks = [{
      id: trackId,
      language,
      label: `发布者文稿：${title.slice(0, 36)}${title.length > 36 ? '…' : ''}`,
      sourceDurationMs: this.context.durationMs,
      sourceGroup: `bilibili:${this.context.bvid}:${this.context.cid}:publisher`,
      sourceKind: 'publisher-transcript',
      hasTimestamps: false,
    }]
  }

  private async loadYouTubeFallbackTracks(): Promise<SubtitleTrack[]> {
    if (this.manualYoutubeVideoId) {
      const payload = this.youtubePayloads.get(this.manualYoutubeVideoId)
      return payload ? this.mapYouTubeTracks(this.manualYoutubeVideoId, payload) : []
    }
    const sourceText = [this.context.description, this.extraDescription].filter(Boolean).join('\n')
    const ids = extractYouTubeVideoIds(sourceText)
    if (ids.length === 0) return []

    const candidates: Array<{ videoId: string; payload: BridgePayload }> = []
    for (const videoId of ids) {
      let payload = this.youtubePayloads.get(videoId)
      if (!payload) {
        payload = await fetchYouTubeBridgePayload(videoId, this.fetchImpl) ?? undefined
        if (payload?.videoId && payload.videoId !== videoId) payload = undefined
        if (payload) this.youtubePayloads.set(videoId, payload)
      }
      if (!payload || payload.tracks.length === 0) continue
      candidates.push({ videoId, payload })
    }

    const matched = selectMatchingYouTubeSource(
      this.context.title,
      this.context.durationMs,
      candidates,
      youtubeIdsBoostedBySourceContext(sourceText, ids),
    )
    if (!matched) {
      this.youtubePayloads.clear()
      return []
    }
    this.youtubePayloads = new Map([[matched.videoId, matched.payload]])
    return this.mapYouTubeTracks(matched.videoId, matched.payload)
  }

  private mapYouTubeTracks(videoId: string, payload: BridgePayload): SubtitleTrack[] {
    const sourceTitle = payload.metadata.title.trim()
    const suffix = sourceTitle.length > 0
      ? `（YouTube：${sourceTitle.slice(0, 24)}${sourceTitle.length > 24 ? '…' : ''}）`
      : '（YouTube 原视频）'
    return payload.tracks.map((track) => ({
      id: youtubeFallbackTrackId(videoId, track.vssId),
      language: track.languageCode,
      label: `${track.label}${suffix}`,
      isAutoGenerated: track.isAutoGenerated,
      sourceGroup: `youtube:${videoId}`,
      sourceDurationMs: payload.metadata.durationMs,
    }))
  }

  private mapBilibiliTracks(tracks: TrackInfo[]): SubtitleTrack[] {
    return tracks.map((track) => ({
      id: String(track.id),
      language: track.lan,
      label: track.lan_doc,
      isAutoGenerated: track.ai_status === 1,
      sourceGroup: `bilibili:${this.context.bvid}:${this.context.cid}`,
    }))
  }
}

function detectDocumentLanguage(value: string): string {
  const chineseChars = value.match(/[\u3400-\u9fff]/gu)?.length ?? 0
  const latinChars = value.match(/[a-z]/giu)?.length ?? 0
  return chineseChars >= latinChars * 0.25 ? 'zh' : 'en'
}

function normalizeTranscriptionLanguage(language: string, text: string): string {
  const value = language.trim().toLowerCase()
  if (value === 'zh' || value === 'chinese' || value.startsWith('zh-')) return 'zh'
  if (value === 'en' || value === 'english' || value.startsWith('en-')) return 'en'
  return detectDocumentLanguage(text)
}
