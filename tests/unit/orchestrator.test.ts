import { describe, expect, it, vi } from 'vitest'
import { TaskOrchestrator } from '../../src/core/orchestrator'
import type { SubtitleAdapter, SubtitleTrack, SubtitleCue, VideoMetadata, ModelProvider, ModelResponse } from '../../src/core/contracts'
import type { ProcessedDocument } from '../../src/core/orchestrator'

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

function mockEnglishProvider(): ModelProvider {
  return {
    testConnection: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        paragraphs: [
          { id: expect.any(String) as unknown as string, text: '你好世界。' },
          { id: expect.any(String) as unknown as string, text: '这是一个测试视频。' },
          { id: expect.any(String) as unknown as string, text: '我们讨论AI话题。' },
        ],
      }),
    } as ModelResponse),
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
    await orchestrator.start({
      trackId: 'en',
      mode: 'high-fidelity',
      sourceLanguage: 'zh',
      includeTimestamps: false,
    })

    const state = orchestrator.getState()
    expect(state.status).toBe('completed')
    expect(provider.complete).not.toHaveBeenCalled()

    if (state.status === 'completed') {
      expect(state.document.mode).toBe('high-fidelity')
      expect(state.document.metadata.title).toBe('Test Video')
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
})
