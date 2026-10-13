import { describe, expect, it } from 'vitest'
import type { SubtitleCue, VideoMetadata } from '../../src/core/contracts'
import {
  measureSubtitleQuality,
  requireCompletePublisherTranscript,
  requireCompleteSubtitle,
} from '../../src/processors/subtitle-quality'

function metadata(durationMs: number): VideoMetadata {
  return {
    platform: 'bilibili',
    videoId: 'BV-test',
    title: '测试视频',
    canonicalUrl: 'https://www.bilibili.com/video/BV-test',
    durationMs,
  }
}

function completeCues(durationMs: number): SubtitleCue[] {
  return Array.from({ length: 100 }, (_, index) => ({
    id: `cue-${index}`,
    startMs: index * (durationMs / 100),
    endMs: (index + 1) * (durationMs / 100),
    text: `这是第${index}条完整字幕内容`,
  }))
}

describe('subtitle quality gate', () => {
  it('measures cue text and timeline coverage', () => {
    expect(measureSubtitleQuality([
      { id: 'a', startMs: 1_000, endMs: 2_000, text: 'hello' },
      { id: 'b', startMs: 5_000, endMs: 9_000, text: 'world' },
    ], 10_000)).toMatchObject({
      cueCount: 2,
      textChars: 10,
      startMs: 1_000,
      endMs: 9_000,
      endCoverage: 0.9,
      spanCoverage: 0.8,
    })
  })

  it('uses text volume instead of timeline coverage for publisher documents', () => {
    const metadata = {
      platform: 'bilibili' as const,
      videoId: 'BVpublisher',
      title: '发布者文稿',
      canonicalUrl: 'https://www.bilibili.com/video/BVpublisher',
      durationMs: 20 * 60_000,
    }
    const complete = [{ id: 'p1', startMs: 0, endMs: 1, text: '文'.repeat(800) }]
    expect(requireCompletePublisherTranscript(metadata, complete).textChars).toBe(800)
    expect(() => requireCompletePublisherTranscript(metadata, [
      { id: 'p1', startMs: 0, endMs: 1, text: '摘要' },
    ])).toThrow(/疑似只是摘要/)
  })

  it('rejects a two-second transcript for an eighty-three-minute video', () => {
    expect(() => requireCompleteSubtitle(metadata(4_996_000), [
      { id: 'wrong', startMs: 0, endMs: 2_000, text: '可以保护别人啊 我做保安也是因为这个' },
    ])).toThrow(/字幕数据疑似不完整.*4996.*2 秒.*1 条/)
  })

  it('accepts a transcript with enough content and timeline coverage', () => {
    const cues = completeCues(3_600_000)
    expect(requireCompleteSubtitle(metadata(3_600_000), cues).endCoverage).toBe(1)
  })

  it('does not apply duration coverage heuristics to short videos', () => {
    expect(() => requireCompleteSubtitle(metadata(60_000), [
      { id: 'short', startMs: 0, endMs: 2_000, text: '短视频内容' },
    ])).not.toThrow()
  })

  it('reports null coverage when video duration is unavailable', () => {
    const result = measureSubtitleQuality([
      { id: 'cue', startMs: 0, endMs: 1_000, text: '内容' },
    ])
    expect(result.endCoverage).toBeNull()
    expect(result.spanCoverage).toBeNull()
  })

  it('measures an empty subtitle list without invalid numeric values', () => {
    expect(measureSubtitleQuality([], 10_000)).toEqual({
      cueCount: 0,
      textChars: 0,
      startMs: 0,
      endMs: 0,
      endCoverage: 0,
      spanCoverage: 0,
    })
  })

  it('rejects a long transcript with enough text but insufficient timeline coverage', () => {
    const cues = completeCues(3_600_000).map((cue) => ({
      ...cue,
      startMs: cue.startMs / 2,
      endMs: cue.endMs / 2,
    }))
    expect(() => requireCompleteSubtitle(metadata(3_600_000), cues)).toThrow(
      /字幕数据疑似不完整/,
    )
  })
})
