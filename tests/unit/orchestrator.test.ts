import { describe, expect, it, vi } from 'vitest'
import { TaskOrchestrator } from '../../src/core/orchestrator'
import type { SubtitleAdapter, SubtitleTrack, SubtitleCue, VideoMetadata, ModelProvider } from '../../src/core/contracts'
import { AppError } from '../../src/errors/app-error'
import type { TaskEvent } from '../../src/core/task-events'

function mockAdapter(tracks?: SubtitleTrack[], cues?: SubtitleCue[]): SubtitleAdapter {
  const metadata: VideoMetadata = {
    platform: 'youtube',
    videoId: 'test123',
    title: 'Test Video',
    canonicalUrl: 'https://www.youtube.com/watch?v=test123',
    durationMs: 120000,
  }
  return {
    supports: () => true,
    getVideoMetadata: vi.fn().mockResolvedValue(metadata),
    getSubtitleTracks: vi.fn().mockResolvedValue(
      tracks ?? [{ id: 'en', language: 'en', label: 'English' }],
    ),
    getCues: vi.fn().mockResolvedValue(
      cues ?? [
        { id: 'c1', startMs: 0, endMs: 1000, text: 'Hello world.' },
        { id: 'c2', startMs: 1100, endMs: 2500, text: 'This is a test video.' },
        { id: 'c3', startMs: 2600, endMs: 4000, text: 'We discuss AI topics.' },
      ],
    ),
  }
}

// Actually, let me use a simpler mock that returns valid translation for any input
function mockValidProvider(): ModelProvider {
  return {
    testConnection: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockImplementation(async () => {
      // Return a response whose paragraphs match some known IDs
      return {
        content: JSON.stringify({
          paragraphs: [
            { id: 'c1-c1', text: '你好世界。' },
            { id: 'c2-c3', text: '这是一个测试视频。我们讨论AI话题。' },
          ],
        }),
      }
    }),
  }
}

describe('TaskOrchestrator', () => {
  it('starts from idle state', () => {
    const orchestrator = new TaskOrchestrator(mockAdapter(), mockValidProvider())
    expect(orchestrator.getState().status).toBe('idle')
  })

  it('transitions to running state on start', async () => {
    const orchestrator = new TaskOrchestrator(mockAdapter(), mockValidProvider())
    const promise = orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    // State should be running while processing
    expect(orchestrator.getState().status).toBe('running')

    await promise
  })

  it('completes high-fidelity for Chinese subtitles without model calls', async () => {
    const adapter = mockAdapter(undefined, [
      { id: 'c1', startMs: 0, endMs: 1000, text: '你好世界。' },
      { id: 'c2', startMs: 1100, endMs: 2500, text: '这是一个测试。' },
    ])
    const provider = {
      testConnection: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
    } as unknown as ModelProvider

    const orchestrator = new TaskOrchestrator(adapter, provider)
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))
    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    const state = orchestrator.getState()
    expect(state.status).toBe('completed')
    expect(provider.complete).not.toHaveBeenCalled()
    expect(events.filter((event) => event.type === 'CONTENT_APPENDED')).toHaveLength(1)

    if (state.status === 'completed') {
      expect(state.document.mode).toBe('high-fidelity')
      expect(state.document.metadata.title).toBe('Test Video')
      expect(state.document.generatedAt).toEqual(expect.any(Number))
    }
  })

  it('handles cancellation', async () => {
    const adapter = mockAdapter()
    const provider = {
      testConnection: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockImplementation(async () => {
        // Delay to allow cancellation
        await new Promise((resolve) => setTimeout(resolve, 50))
        return { content: '{}' }
      }),
    } as unknown as ModelProvider

    const orchestrator = new TaskOrchestrator(adapter, provider)
    const promise = orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
    })

    // Cancel immediately
    orchestrator.cancel()

    await promise
    const state = orchestrator.getState()
    expect(state.status).toBe('cancelled')
  })

  it('emits state change events', async () => {
    const adapter = mockAdapter(undefined, [
      { id: 'c1', startMs: 0, endMs: 1000, text: '你好世界。' },
    ])
    const provider = {
      testConnection: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn(),
    } as unknown as ModelProvider

    const states: string[] = []
    const orchestrator = new TaskOrchestrator(adapter, provider)
    orchestrator.onStateChange((state) => {
      states.push(state.status)
    })

    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    expect(states).toContain('running')
    expect(states).toContain('completed')
  })

  it('handles subtitle extraction failure', async () => {
    const adapter = {
      ...mockAdapter(),
      getCues: vi.fn().mockRejectedValue(
        new (await import('../../src/errors/app-error')).AppError(
          'SUBTITLE_EXTRACTION_FAILED',
          '提取失败',
        ),
      ),
    }
    const provider = mockValidProvider()

    const orchestrator = new TaskOrchestrator(adapter, provider)
    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
    })

    const state = orchestrator.getState()
    expect(state.status).toBe('failed')
  })

  it('fails before processing when normalized subtitles contain no text', async () => {
    const provider = mockValidProvider()
    const orchestrator = new TaskOrchestrator(mockAdapter(undefined, [
      { id: 'empty', startMs: 0, endMs: 1000, text: '   ' },
    ]), provider)

    await orchestrator.start({
      trackId: 'en',
      mode: 'refined',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    const state = orchestrator.getState()
    expect(state.status).toBe('failed')
    expect(provider.complete).not.toHaveBeenCalled()
    if (state.status === 'failed') {
      expect(state.error).toMatchObject({
        code: 'SUBTITLE_EXTRACTION_FAILED',
        message: expect.stringContaining('没有可提取的文字内容'),
      })
    }
  })

  it('keeps completed chunks and retries only failed chunks', async () => {
    let allowSecondChunk = false
    const cues = [
      { id: 'c1', startMs: 0, endMs: 1000, text: `${'a'.repeat(100)}.` },
      { id: 'c2', startMs: 1100, endMs: 2000, text: `${'b'.repeat(100)}.` },
    ]
    const complete = vi.fn().mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content) as {
        paragraphs: Array<{ id: string; text: string }>
      }
      if (payload.paragraphs[0]!.id.includes('c2') && !allowSecondChunk) {
        throw new AppError('MODEL_RESPONSE_INVALID', 'invalid')
      }
      return {
        content: JSON.stringify({
          paragraphs: payload.paragraphs.map((item) => ({ id: item.id, text: `中${item.text}` })),
        }),
      }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(undefined, cues),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
      maxInputChars: 120,
    })

    expect(orchestrator.getState().status).toBe('partial')
    expect(orchestrator.getState().completedChunks.map((chunk) => chunk.id)).toEqual(['chunk-0'])
    expect(orchestrator.getState().failedChunks.map((chunk) => chunk.id)).toEqual(['chunk-1'])
    const callsAfterFirstRun = complete.mock.calls.length
    allowSecondChunk = true
    await orchestrator.retryFailed()

    expect(orchestrator.getState().status).toBe('completed')
    expect(complete).toHaveBeenCalledTimes(callsAfterFirstRun + 1)
  })

  it('emits two ordered content events for two validated high-fidelity chunks', async () => {
    const cues = [
      { id: 'c1', startMs: 0, endMs: 1000, text: `${'a'.repeat(100)}.` },
      { id: 'c2', startMs: 1100, endMs: 2000, text: `${'b'.repeat(100)}.` },
    ]
    const complete = vi.fn().mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content) as {
        paragraphs: Array<{ id: string; text: string }>
      }
      return {
        content: JSON.stringify({
          paragraphs: payload.paragraphs.map((item) => ({
            id: item.id,
            text: `中${item.text}`,
          })),
        }),
      }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(undefined, cues),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))

    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
      maxInputChars: 120,
    })

    const contentEvents = events.filter(
      (event): event is Extract<TaskEvent, { type: 'CONTENT_APPENDED' }> => (
        event.type === 'CONTENT_APPENDED'
      ),
    )
    expect(contentEvents.map((event) => event.chunkId)).toEqual(['chunk-0', 'chunk-1'])
    expect(new Set(events.map((event) => event.taskId)).size).toBe(1)
    expect(orchestrator.getState().completedChunks.map((chunk) => chunk.id)).toEqual([
      'chunk-0',
      'chunk-1',
    ])
  })

  it('stores validated Map results for live preview before appending the Reduce document', async () => {
    const mapResponse = {
      chapterCandidates: [],
      claims: [],
      facts: [],
      people: [],
      examples: [],
      conclusions: [],
    }
    const reduceResponse = {
      overview: '概览',
      coreIdeas: [],
      chapters: [],
      importantFacts: [],
      conclusion: '结论',
    }
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: JSON.stringify(mapResponse) })
      .mockResolvedValueOnce({ content: JSON.stringify(reduceResponse) })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(undefined, [
        { id: 'c1', startMs: 0, endMs: 1000, text: '需要精炼的内容。' },
      ]),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))

    await orchestrator.start({
      trackId: 'en',
      mode: 'refined',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    const contentEvents = events.filter(
      (event): event is Extract<TaskEvent, { type: 'CONTENT_APPENDED' }> => (
        event.type === 'CONTENT_APPENDED'
      ),
    )
    expect(contentEvents).toHaveLength(2)
    expect(contentEvents[0]).toMatchObject({
      chunkId: 'chunk-0',
      content: mapResponse,
    })
    expect(contentEvents[1]?.chunkId).toBe('reduce')
    expect(contentEvents[1]?.content).toEqual(reduceResponse)
    expect(orchestrator.getState().completedChunks).toEqual([
      { id: 'chunk-0', index: 0, content: mapResponse },
      { id: 'reduce', index: 1, content: reduceResponse },
    ])
  })

  it('preserves validated chunks when the user cancels before the next chunk', async () => {
    const cues = [
      { id: 'c1', startMs: 0, endMs: 1000, text: `${'a'.repeat(100)}.` },
      { id: 'c2', startMs: 1100, endMs: 2000, text: `${'b'.repeat(100)}.` },
    ]
    const complete = vi.fn().mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content) as {
        paragraphs: Array<{ id: string; text: string }>
      }
      return {
        content: JSON.stringify({
          paragraphs: payload.paragraphs.map((item) => ({ id: item.id, text: item.text })),
        }),
      }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(undefined, cues),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    orchestrator.onEvent((event) => {
      if (event.type === 'CONTENT_APPENDED' && event.chunkId === 'chunk-0') {
        orchestrator.cancel()
      }
    })

    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
      maxInputChars: 120,
    })

    const state = orchestrator.getState()
    expect(state.status).toBe('cancelled')
    expect(state.completedChunks.map((chunk) => chunk.id)).toEqual(['chunk-0'])
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('turns model connection and delta callbacks into task activity events', async () => {
    const complete = vi.fn().mockImplementation(async (request, _signal, context) => {
      context?.onActivity?.({ type: 'connected' })
      context?.onActivity?.({ type: 'delta', text: 'raw stream', receivedChars: 42 })
      const payload = JSON.parse(request.messages[1].content) as {
        paragraphs: Array<{ id: string; text: string }>
      }
      return {
        content: JSON.stringify({
          paragraphs: payload.paragraphs.map((item) => ({ id: item.id, text: item.text })),
        }),
      }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))

    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
    })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'MODEL_CONNECTED', chunkIndex: 0 }),
      expect.objectContaining({ type: 'STREAM_ACTIVITY', receivedChars: 42 }),
    ]))
    expect(orchestrator.getState().metrics.receivedChars).toBe(42)
  })

  it('用同一分块的累计快照逐段更新高保真预览，且不重复追加最终结果', async () => {
    const complete = vi.fn().mockImplementation(async (request, _signal, context) => {
      const payload = JSON.parse(request.messages[1].content) as {
        paragraphs: Array<{ id: string; text: string }>
      }
      const lines = payload.paragraphs.map((item) => JSON.stringify({
        type: 'paragraph',
        id: item.id,
        text: `中${item.text}`,
      }))
      const first = `${lines[0]}\n${lines[1]!.slice(0, 18)}`
      const second = lines[1]!.slice(18)
      context?.onActivity?.({ type: 'delta', text: first, receivedChars: first.length })
      context?.onActivity?.({
        type: 'delta',
        text: second,
        receivedChars: first.length + second.length,
      })
      return { content: lines.join('\n') }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))

    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'en',
      includeTimestamps: false,
    })

    const contentEvents = events.filter(
      (event): event is Extract<TaskEvent, { type: 'CONTENT_APPENDED' }> => (
        event.type === 'CONTENT_APPENDED'
      ),
    )
    expect(contentEvents).toHaveLength(2)
    expect(contentEvents.map((event) => event.chunkId)).toEqual(['chunk-0', 'chunk-0'])
    expect(contentEvents.map((event) => (
      Array.isArray(event.content) ? event.content.length : 0
    ))).toEqual([1, 2])
    expect(orchestrator.getState().status).toBe('completed')
    expect(orchestrator.getState().completedChunks).toHaveLength(1)
  })

  it('不展示 Map 原始流，但会提交完整 Map 结果和 Reduce 合法语义单元', async () => {
    const mapResponse = JSON.stringify({
      chapterCandidates: [],
      claims: [],
      facts: [],
      people: [],
      examples: [],
      conclusions: [],
    })
    const reduceLines = [
      '{"type":"overview","text":"概览"}',
      '{"type":"core_idea","text":"观点"}',
      '{"type":"conclusion","text":"结论"}',
    ]
    let callIndex = 0
    const complete = vi.fn().mockImplementation(async (_request, _signal, context) => {
      callIndex += 1
      const content = callIndex === 1 ? mapResponse : reduceLines.join('\n')
      context?.onActivity?.({ type: 'delta', text: content, receivedChars: content.length })
      return { content }
    })
    const orchestrator = new TaskOrchestrator(
      mockAdapter(undefined, [
        { id: 'c1', startMs: 0, endMs: 1000, text: '需要精炼的内容。' },
      ]),
      { testConnection: vi.fn(), complete } as ModelProvider,
    )
    const events: TaskEvent[] = []
    orchestrator.onEvent((event) => events.push(event))

    await orchestrator.start({
      trackId: 'en',
      mode: 'refined',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    const contentEvents = events.filter(
      (event): event is Extract<TaskEvent, { type: 'CONTENT_APPENDED' }> => (
        event.type === 'CONTENT_APPENDED'
      ),
    )
    expect(contentEvents).toHaveLength(4)
    expect(contentEvents[0]).toMatchObject({
      chunkId: 'chunk-0',
      content: JSON.parse(mapResponse),
    })
    expect(contentEvents.slice(1).every((event) => event.chunkId === 'reduce')).toBe(true)
    expect(contentEvents[1]?.content).toMatchObject({ overview: '概览' })
    expect(contentEvents.at(-1)?.content).toEqual({
      overview: '概览',
      coreIdeas: ['观点'],
      chapters: [],
      importantFacts: [],
      conclusion: '结论',
    })
    expect(orchestrator.getState().status).toBe('completed')
  })
})
