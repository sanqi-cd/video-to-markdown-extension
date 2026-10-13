import { describe, expect, it } from 'vitest'
import {
  extractYouTubeVideoIds,
  parseYouTubeVideoUrl,
  parseYouTubeFallbackTrackId,
  youtubeFallbackTrackId,
} from '../../src/adapters/shared/youtube-video-id'

describe('parseYouTubeVideoUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=12', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses an exact supported URL: %s', (url, expected) => {
    expect(parseYouTubeVideoUrl(url)).toBe(expected)
  })

  it.each([
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=too-short',
    'dQw4w9WgXcQ',
    'not a url',
  ])('rejects an unsafe or incomplete input: %s', (url) => {
    expect(parseYouTubeVideoUrl(url)).toBeNull()
  })
})

describe('extractYouTubeVideoIds', () => {
  it('extracts watch, short, and youtu.be links', () => {
    expect(extractYouTubeVideoIds([
      '原视频 https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      '镜像 https://youtu.be/abcdefghijk',
      'embed https://www.youtube.com/embed/lmnopqrstuv',
    ].join('\n'))).toEqual([
      'dQw4w9WgXcQ',
      'abcdefghijk',
      'lmnopqrstuv',
    ])
  })

  it('ignores duplicate ids', () => {
    expect(extractYouTubeVideoIds(
      'https://youtu.be/dQw4w9WgXcQ https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )).toEqual(['dQw4w9WgXcQ'])
  })
})

describe('youtube fallback track ids', () => {
  it('round-trips video id and vss id', () => {
    const id = youtubeFallbackTrackId('dQw4w9WgXcQ', '.en')
    expect(parseYouTubeFallbackTrackId(id)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      vssId: '.en',
    })
  })
})
