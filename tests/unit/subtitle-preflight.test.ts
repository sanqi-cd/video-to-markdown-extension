import { describe, expect, it, vi } from 'vitest'
import { preflightSubtitleTracks } from '../../src/browser/subtitle-preflight'
import { mapVideoContextError } from '../../src/browser/video-context'
import { AppError } from '../../src/errors/app-error'
import type { SubtitleAdapter, SubtitleTrack, VideoMetadata } from '../../src/core/contracts'

const metadata: VideoMetadata = { platform: 'bilibili', videoId: 'BV-test', title: '访谈', canonicalUrl: 'https://www.bilibili.com/video/BV-test', durationMs: 10330000 }
const track: SubtitleTrack = { id: '1', language: 'zh', label: '中文' }
const full = Array.from({ length: 100 }, (_, i) => ({ id: String(i), startMs: i * 103000, endMs: (i + 1) * 103000, text: '这是当前访谈的字幕内容' }))
const adapter = (getCues: SubtitleAdapter['getCues']) => ({ getCues } as SubtitleAdapter)

describe('subtitle preflight', () => {
  it('rejects the 423-second track before generation for a 10330-second video', async () => {
    const cues = full.map((cue, i) => ({ ...cue, startMs: i * 4000, endMs: (i + 1) * 4230 }))
    await expect(preflightSubtitleTracks(adapter(async () => cues), metadata, [track]))
      .rejects.toMatchObject({ code: 'SUBTITLE_UNRELIABLE' })
  })
  it('keeps valid alternatives while excluding incomplete tracks', async () => {
    const second = { ...track, id: '2' }
    const getCues = vi.fn(async (item: SubtitleTrack) => item.id === '1' ? [] : full)
    await expect(preflightSubtitleTracks(adapter(getCues), metadata, [track, second])).resolves.toEqual([second])
  })
  it('does not classify network failure as absent subtitles', async () => {
    const error = new AppError('NETWORK_FAILED', 'network')
    await expect(preflightSubtitleTracks(adapter(async () => { throw error }), metadata, [track])).rejects.toBe(error)
    expect(mapVideoContextError(error, { tabId: 1, metadata }).status).toBe('failed')
  })
  it('maps unreliable subtitles to an explicit recovery reason', () => {
    expect(mapVideoContextError(new AppError('SUBTITLE_UNRELIABLE', 'incomplete'), { tabId: 1, metadata }))
      .toEqual({ status: 'no-subtitle', metadata, reason: 'unreliable' })
  })
  it('stops reading obsolete video context', async () => {
    const getCues = vi.fn(async () => full)
    await expect(preflightSubtitleTracks(adapter(getCues), metadata, [track], () => false)).resolves.toEqual([])
    expect(getCues).not.toHaveBeenCalled()
  })
})
