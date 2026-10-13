import { describe, expect, it } from 'vitest'
import {
  documentParagraphsToCues,
  extractBilibiliOpusIds,
  isCompletePublisherTranscript,
  looksLikeEmbeddedTranscript,
  parseBilibiliOpusHtml,
  publisherTranscriptMinimumChars,
} from '../../src/adapters/bilibili/publisher-transcript'

function opusHtml(modules: unknown[]): string {
  return `<script>window.__INITIAL_STATE__=${JSON.stringify({ detail: { modules } })};(function(){})();</script>`
}

function author(mid = 42) {
  return { module_type: 'MODULE_TYPE_AUTHOR', module_author: { mid, name: 'UP 主' } }
}

describe('Bilibili publisher transcript parser', () => {
  it('extracts only exact HTTPS Bilibili opus URLs and deduplicates them', () => {
    expect(extractBilibiliOpusIds([
      '文稿 https://www.bilibili.com/opus/123456',
      '重复 https://bilibili.com/opus/123456?from=video',
      '伪造 https://www.bilibili.com.evil.example/opus/999',
      '非 HTTPS http://www.bilibili.com/opus/888',
    ].join('\n'))).toEqual(['123456'])
  })

  it('parses text paragraphs and preserves rich links', () => {
    const html = opusHtml([
      { module_type: 'MODULE_TYPE_TITLE', module_title: { text: '完整文稿' } },
      author(),
      {
        module_type: 'MODULE_TYPE_CONTENT',
        module_content: {
          paragraphs: [
            { text: { nodes: [{ word: { words: '第一段正文；即使包含 ;(function( 也能解析。' } }] } },
            { text: { nodes: [{ word: { words: '资料：' } }, { rich: { orig_text: 'https://example.com/source' } }] } },
          ],
        },
      },
    ])

    expect(parseBilibiliOpusHtml(html, '123456', 42)).toEqual({
      status: 'available',
      opusId: '123456',
      title: '完整文稿',
      authorMid: 42,
      paragraphs: ['第一段正文；即使包含 ;(function( 也能解析。', '资料： https://example.com/source'],
    })
  })

  it('reports a publisher paywall without attempting to parse hidden content', () => {
    const html = opusHtml([
      { module_type: 'MODULE_TYPE_TITLE', module_title: { text: '会员文稿' } },
      author(),
      {
        module_type: 'MODULE_TYPE_BLOCKED',
        module_blocked: { hint_message: '加入充电即可解锁观看' },
      },
    ])
    expect(parseBilibiliOpusHtml(html, '999', 42)).toMatchObject({
      status: 'locked',
      message: '加入充电即可解锁观看',
    })
  })

  it('rejects an opus published by another account', () => {
    const html = opusHtml([author(99), {
      module_type: 'MODULE_TYPE_CONTENT',
      module_content: { paragraphs: [{ text: { nodes: [{ word: { words: '正文' } }] } }] },
    }])
    expect(parseBilibiliOpusHtml(html, '123', 42)).toBeNull()
  })

  it('safely rejects missing, malformed and incomplete initial state', () => {
    expect(parseBilibiliOpusHtml('<html></html>', '1', 42)).toBeNull()
    expect(parseBilibiliOpusHtml('window.__INITIAL_STATE__=[]', '1', 42)).toBeNull()
    expect(parseBilibiliOpusHtml('window.__INITIAL_STATE__={"detail":', '1', 42)).toBeNull()
    expect(parseBilibiliOpusHtml('window.__INITIAL_STATE__={"detail":};', '1', 42)).toBeNull()
    expect(parseBilibiliOpusHtml(
      'window.__INITIAL_STATE__={"detail":{"modules":[null]}};',
      '1',
      42,
    )).toBeNull()
  })

  it('supports string author ids, fallback titles and alternate rich node text', () => {
    const html = opusHtml([
      { module_type: 'MODULE_TYPE_AUTHOR', module_author: { mid: '42' } },
      {
        module_type: 'MODULE_TYPE_CONTENT',
        module_content: {
          paragraphs: [{
            text: { nodes: [{ rich: { text: '链接文字' } }, { formula: { latex: 'x+y' } }] },
          }],
        },
      },
    ])
    expect(parseBilibiliOpusHtml(html, '2', 42)).toMatchObject({
      status: 'available',
      title: '发布者文稿',
      paragraphs: ['链接文字 x+y'],
    })
  })

  it('uses a generic message for blocked content without a hint', () => {
    const html = opusHtml([
      author(),
      { module_type: 'MODULE_TYPE_BLOCKED', module_blocked: {} },
    ])
    expect(parseBilibiliOpusHtml(html, '3', 42)).toMatchObject({
      status: 'locked',
      message: '该发布者文稿当前需要在 B 站获取访问权限',
    })
  })

  it('also recognizes alternate paywall modules', () => {
    const html = opusHtml([
      author(),
      {
        module_type: 'MODULE_TYPE_PAYWALL',
        module_paywall: { title: '购买后可阅读完整文稿' },
      },
    ])
    expect(parseBilibiliOpusHtml(html, '4', 42)).toMatchObject({
      status: 'locked',
      message: '购买后可阅读完整文稿',
    })
  })

  it('requires text volume proportional to video duration', () => {
    expect(publisherTranscriptMinimumChars()).toBe(600)
    expect(publisherTranscriptMinimumChars(-1)).toBe(600)
    expect(publisherTranscriptMinimumChars(80 * 60_000)).toBe(3_200)
    expect(isCompletePublisherTranscript(['a'.repeat(3_199)], 80 * 60_000)).toBe(false)
    expect(isCompletePublisherTranscript(['a'.repeat(3_200)], 80 * 60_000)).toBe(true)
  })

  it('recognizes explicitly embedded transcripts but not ordinary descriptions', () => {
    expect(looksLikeEmbeddedTranscript('完整视频文稿：第一段正文')).toBe(true)
    expect(looksLikeEmbeddedTranscript('本视频主要介绍人工智能')).toBe(false)
  })

  it('creates internal proportional cues without claiming they are real timestamps', () => {
    expect(documentParagraphsToCues(['第一段', '第二段较长'], 9_000)).toEqual([
      { id: 'publisher-0', startMs: 0, endMs: 3_375, text: '第一段' },
      { id: 'publisher-1', startMs: 3_375, endMs: 9_000, text: '第二段较长' },
    ])
    expect(documentParagraphsToCues(['', '正文'])).toEqual([
      { id: 'publisher-0', startMs: 0, endMs: 1_000, text: '正文' },
    ])
  })
})
