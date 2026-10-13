import type { SubtitleAdapter, SubtitleTrack, VideoMetadata } from '../core/contracts'
import { AppError } from '../errors/app-error'
import { requireCompletePublisherTranscript, requireCompleteSubtitle } from '../processors/subtitle-quality'

/** Read-only checks, before showing the generate action or calling a model. */
export async function preflightSubtitleTracks(
  adapter: SubtitleAdapter,
  metadata: VideoMetadata,
  tracks: SubtitleTrack[],
  isCurrent: () => boolean = () => true,
): Promise<SubtitleTrack[]> {
  const usable: SubtitleTrack[] = []
  let qualityError: unknown
  let readError: unknown
  for (const track of tracks) {
    if (!isCurrent()) return []
    let cues
    try {
      cues = await adapter.getCues(track)
    } catch (error) {
      readError ??= error
      continue
    }
    try {
      if (!cues.length || cues.some((cue) => !Number.isFinite(cue.startMs)
        || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs < cue.startMs)
        || !cues.some((cue) => cue.text.trim())) {
        throw new Error('字幕为空或时间轴无效')
      }
      const source = { ...metadata, durationMs: track.sourceDurationMs ?? metadata.durationMs }
      if (track.sourceKind === 'publisher-transcript') requireCompletePublisherTranscript(source, cues)
      else requireCompleteSubtitle(source, cues)
      usable.push(track)
    } catch (error) { qualityError ??= error }
  }
  if (usable.length) return usable
  // A failed download is not evidence of an absent subtitle track.
  if (readError) throw readError
  if (qualityError) throw new AppError('SUBTITLE_UNRELIABLE',
    '检测到字幕，但内容为空、时间轴异常或覆盖不足，暂时无法可靠使用。可以重新检测，或改用当前视频音频转录。')
  throw new AppError('NO_SUBTITLE', '未找到可直接提取的字幕')
}
