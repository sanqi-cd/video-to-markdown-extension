import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeneratingView } from '../../src/components/GeneratingView'
import type { VideoMetadata } from '../../src/core/contracts'
import type { TaskSnapshot } from '../../src/core/task-events'

const metadata: VideoMetadata = {
  platform: 'youtube',
  videoId: 'live-video',
  title: 'Live Video',
  canonicalUrl: 'https://www.youtube.com/watch?v=live-video',
}

function runningSnapshot(
  overrides: Partial<Extract<TaskSnapshot, { status: 'running' }>> = {},
): Extract<TaskSnapshot, { status: 'running' }> {
  return {
    taskId: 'task-live',
    status: 'running',
    mode: 'high-fidelity',
    stage: 'processing-high-fidelity',
    startedAt: Date.now(),
    metrics: {
      cueCount: 4,
      paragraphCount: 2,
      totalChunks: 2,
      completedChunks: 0,
      currentChunkIndex: 0,
      receivedChars: 0,
      sourceLanguage: 'en',
    },
    completedChunks: [],
    failedChunks: [],
    ...overrides,
  }
}

describe('GeneratingView', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows explicit model waiting feedback after two seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    render(<GeneratingView snapshot={runningSnapshot()} metadata={metadata} onCancel={() => {}} />)

    expect(screen.queryByText(/正在等待模型响应/)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(2_500))

    expect(screen.getByRole('status')).toHaveTextContent('正在等待模型响应')
    expect(screen.getByText('正在处理第 1 / 2 部分')).toBeVisible()
  })

  it('replaces the first-content placeholder with validated readable content', () => {
    const { rerender } = render(
      <GeneratingView snapshot={runningSnapshot()} metadata={metadata} onCancel={() => {}} />,
    )
    expect(screen.getByText('第一段通过校验后会立即显示在这里')).toBeVisible()

    rerender(
      <GeneratingView
        snapshot={runningSnapshot({
          metrics: {
            ...runningSnapshot().metrics,
            completedChunks: 1,
            currentChunkIndex: 1,
          },
          completedChunks: [{
            id: 'chunk-0',
            index: 0,
            content: [{
              id: 'p1',
              startMs: 0,
              endMs: 1_000,
              text: '这是已经通过校验的第一段。',
            }],
          }],
        })}
        metadata={metadata}
        onCancel={() => {}}
      />,
    )

    expect(screen.queryByText('第一段通过校验后会立即显示在这里')).not.toBeInTheDocument()
    expect(screen.getByText('这是已经通过校验的第一段。')).toBeVisible()
    expect(screen.getByText('实时更新中')).toBeVisible()
  })

  it('shows received character activity without placing raw model data in the preview', () => {
    render(
      <GeneratingView
        snapshot={runningSnapshot({
          metrics: { ...runningSnapshot().metrics, receivedChars: 384 },
          modelConnectedChunkIndex: 0,
        })}
        metadata={metadata}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByText('已接收 384 个字符')).toBeVisible()
    expect(screen.getByText('模型已连接')).toBeVisible()
    expect(screen.queryByLabelText('已生成内容', { exact: false })).not.toBeInTheDocument()
  })

  it('keeps the preview stable for raw updates and validated chunks', async () => {
    const initialSnapshot = runningSnapshot()
    const { rerender } = render(
      <GeneratingView snapshot={initialSnapshot} metadata={metadata} onCancel={() => {}} />,
    )
    const viewport = screen.getByTestId('live-preview-viewport')
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1_000 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 240 })
    const scrollTo = vi.fn()
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo })

    rerender(
      <GeneratingView
        snapshot={runningSnapshot({
          metrics: { ...initialSnapshot.metrics, receivedChars: 512 },
        })}
        metadata={metadata}
        onCancel={() => {}}
      />,
    )

    expect(scrollTo).not.toHaveBeenCalled()

    rerender(
      <GeneratingView
        snapshot={runningSnapshot({
          metrics: {
            ...initialSnapshot.metrics,
            completedChunks: 1,
            currentChunkIndex: 1,
            receivedChars: 512,
          },
          completedChunks: [{
            id: 'chunk-0',
            index: 0,
            content: [{
              id: 'p1',
              startMs: 0,
              endMs: 1_000,
              text: '这是新增的可见内容。',
            }],
          }],
        })}
        metadata={metadata}
        onCancel={() => {}}
      />,
    )

    expect(scrollTo).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '新增 1 段 · 查看最新' })).toBeVisible()
    })
  })

  it('shows validated refined analysis while the final note is still being generated', () => {
    render(
      <GeneratingView
        snapshot={runningSnapshot({
          mode: 'refined',
          stage: 'processing-refined-reduce',
          metrics: {
            ...runningSnapshot().metrics,
            totalChunks: 3,
            completedChunks: 3,
            currentChunkIndex: null,
          },
          completedChunks: [{
            id: 'chunk-0',
            index: 0,
            content: {
              chapterCandidates: [{
                title: 'NotebookLM 的主要能力',
                sourceParagraphIds: ['p1'],
              }],
              claims: [{
                text: 'NotebookLM 可以生成多种内容形式。',
                sourceParagraphIds: ['p1'],
              }],
              facts: [],
              people: [],
              examples: [],
              conclusions: [],
            },
          }],
        })}
        metadata={metadata}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByText('阶段性理解结果')).toBeVisible()
    expect(screen.getByText('NotebookLM 可以生成多种内容形式。')).toBeVisible()
    expect(screen.getByText('1 个分块已理解')).toBeVisible()
    expect(screen.getByText('内容理解中')).toBeVisible()
    expect(screen.queryByText(/正在等待模型响应/)).not.toBeInTheDocument()
  })

  it('only uses the stage announcement as the polite live region', () => {
    render(<GeneratingView snapshot={runningSnapshot()} metadata={metadata} onCancel={() => {}} />)
    const liveRegions = document.querySelectorAll('[aria-live="polite"]')
    expect(liveRegions).toHaveLength(1)
    expect(liveRegions[0]).toHaveTextContent('当前阶段：高保真处理')
  })
})
