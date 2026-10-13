import type { SubtitleCue, VideoMetadata } from '../core/contracts'
import { AppError } from '../errors/app-error'
import {
  publisherTranscriptMinimumChars,
  publisherTranscriptTextChars,
} from '../adapters/bilibili/publisher-transcript'

const LONG_VIDEO_MS = 10 * 60 * 1000
const MIN_LONG_VIDEO_CUES = 20
const MIN_LONG_VIDEO_TEXT_CHARS = 200
const MIN_END_COVERAGE = 0.7
const MIN_SPAN_COVERAGE = 0.65

export type SubtitleQuality = {
  cueCount: number
  textChars: number
  startMs: number
  endMs: number
  endCoverage: number | null
  spanCoverage: number | null
}

export function measureSubtitleQuality(
  cues: SubtitleCue[],
  durationMs?: number,
): SubtitleQuality {
  const cueCount = cues.length
  const textChars = cues.reduce((sum, cue) => sum + cue.text.trim().length, 0)
  const startMs = cueCount > 0 ? Math.min(...cues.map((cue) => cue.startMs)) : 0
  const endMs = cueCount > 0 ? Math.max(...cues.map((cue) => cue.endMs)) : 0
  const hasDuration = durationMs !== undefined && durationMs > 0
  return {
    cueCount,
    textChars,
    startMs,
    endMs,
    endCoverage: hasDuration ? endMs / durationMs : null,
    spanCoverage: hasDuration ? Math.max(0, endMs - startMs) / durationMs : null,
  }
}

export function requireCompleteSubtitle(
  metadata: VideoMetadata,
  cues: SubtitleCue[],
): SubtitleQuality {
  const quality = measureSubtitleQuality(cues, metadata.durationMs)
  if (!metadata.durationMs || metadata.durationMs < LONG_VIDEO_MS) return quality

  const isObviouslyIncomplete = quality.cueCount < MIN_LONG_VIDEO_CUES
    || quality.textChars < MIN_LONG_VIDEO_TEXT_CHARS
    || quality.endCoverage === null
    || quality.endCoverage < MIN_END_COVERAGE
    || quality.spanCoverage === null
    || quality.spanCoverage < MIN_SPAN_COVERAGE

  if (isObviouslyIncomplete) {
    const videoSeconds = Math.round(metadata.durationMs / 1000)
    const subtitleSeconds = Math.round(quality.endMs / 1000)
    throw new AppError(
      'SUBTITLE_EXTRACTION_FAILED',
      `字幕数据疑似不完整：视频时长 ${videoSeconds} 秒，字幕仅覆盖到 ${subtitleSeconds} 秒，共 ${quality.cueCount} 条、${quality.textChars} 字。已停止生成以避免输出错误内容`,
    )
  }
  return quality
}

export function requireCompletePublisherTranscript(
  metadata: VideoMetadata,
  cues: SubtitleCue[],
): SubtitleQuality {
  const quality = measureSubtitleQuality(cues, metadata.durationMs)
  const textChars = publisherTranscriptTextChars(cues.map((cue) => cue.text))
  const minimumChars = publisherTranscriptMinimumChars(metadata.durationMs)
  if (textChars < minimumChars) {
    throw new AppError(
      'SUBTITLE_EXTRACTION_FAILED',
      `发布者文稿疑似只是摘要：当前 ${textChars} 字，按视频时长至少需要 ${minimumChars} 字。已停止生成以避免输出不完整内容`,
    )
  }
  return quality
}
