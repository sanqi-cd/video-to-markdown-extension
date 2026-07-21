import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrepareView } from '../../src/components/PrepareView'
import { ProgressView } from '../../src/components/ProgressView'
import { ResultView, ErrorView } from '../../src/components/ResultView'
import { PartialResultView } from '../../src/components/PartialResultView'
import type { VideoMetadata, SubtitleTrack } from '../../src/core/contracts'
import type { ProcessedDocument } from '../../src/core/orchestrator'
import type { TaskSnapshot } from '../../src/core/task-events'
import type { TranslatedParagraph } from '../../src/processors/high-fidelity'

const metadata: VideoMetadata = {
  platform: 'youtube',
  videoId: 'test123',
  title: 'Test Video',
  canonicalUrl: 'https://www.youtube.com/watch?v=test123',
  durationMs: 120000,
}

const tracks: SubtitleTrack[] = [
  { id: 'en', language: 'en', label: 'English' },
  { id: 'zh', language: 'zh', label: '中文' },
]

const completedDoc: ProcessedDocument = {
  metadata,
  mode: 'high-fidelity',
  generatedAt: new Date('2026-07-16T10:00:00+08:00').getTime(),
  content: [
    { id: 'p1', startMs: 0, endMs: 5000, text: 'Hello world.' },
  ] as TranslatedParagraph[],
}

const partialSnapshot: Extract<TaskSnapshot, { status: 'partial' }> = {
  taskId: 'task-partial',
  status: 'partial',
  mode: 'high-fidelity',
  stage: 'processing-high-fidelity',
  startedAt: 1,
  metrics: {
    cueCount: 2,
    paragraphCount: 2,
    totalChunks: 3,
    completedChunks: 1,
    currentChunkIndex: 1,
    receivedChars: 0,
    sourceLanguage: 'en',
  },
  completedChunks: [{
    id: 'chunk-0',
    index: 0,
    content: [{ id: 'p1', startMs: 0, endMs: 1_000, text: '已保留正文' }],
  }],
  failedChunks: [
    { id: 'chunk-1', index: 1, error: { code: 'NETWORK_FAILED', message: '网络失败' } },
    { id: 'chunk-2', index: 2, error: { code: 'MODEL_RATE_LIMITED', message: '请求过快' } },
  ],
}

describe('PrepareView', () => {
  it('shows title and start button', () => {
    render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        trackSelection="auto"
        outputLanguage="zh"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackSelectionChange={() => {}}
        onOutputLanguageChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )
    expect(screen.getByText('Test Video')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成' })).toBeVisible()
  })

  it('shows output languages and keeps subtitle tracks in advanced settings', () => {
    render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        trackSelection="auto"
        outputLanguage="zh"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackSelectionChange={() => {}}
        onOutputLanguageChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )
    expect(screen.getByRole('radio', { name: '中文' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'English' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '字幕来源' })).toHaveValue('auto')
  })

  it('reports output-language changes as the primary language choice', () => {
    const onOutputLanguageChange = vi.fn()
    render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        trackSelection="auto"
        outputLanguage="zh"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackSelectionChange={() => {}}
        onOutputLanguageChange={onOutputLanguageChange}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(onOutputLanguageChange).toHaveBeenCalledWith('en')
  })
})

describe('ProgressView', () => {
  it('shows stage and progress info', () => {
    render(
      <ProgressView
        stage="processing-refined-map"
        completed={3}
        total={10}
        startedAt={Date.now()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('AI 理解内容')).toBeVisible()
    expect(screen.getByText(/3.*10/)).toBeVisible()
  })

  it('has a cancel button', () => {
    render(
      <ProgressView
        stage="processing-high-fidelity"
        completed={1}
        total={5}
        startedAt={Date.now()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '取消' })).toBeVisible()
  })
})

describe('ResultView', () => {
  it('shows download button', () => {
    render(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={async () => {}}
        onDownload={() => {}}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeVisible()
  })
})

describe('PartialResultView', () => {
  it('shows retry button', () => {
    render(
      <PartialResultView
        snapshot={partialSnapshot}
        metadata={metadata}
        includeTimestamps={false}
        onRetry={() => {}}
        onExport={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '重试失败部分' })).toBeVisible()
    expect(screen.getByText(/2 个分块需要重试/)).toBeVisible()
    expect(screen.getByText('已保留正文')).toBeVisible()
  })

  it('shows preserved content instead of an empty cancelled state', () => {
    const cancelledSnapshot: Extract<TaskSnapshot, { status: 'cancelled' }> = {
      ...partialSnapshot,
      status: 'cancelled',
      failedChunks: [],
    }
    render(
      <PartialResultView
        snapshot={cancelledSnapshot}
        metadata={metadata}
        includeTimestamps={false}
        onExport={() => {}}
        onBack={() => {}}
      />,
    )

    expect(screen.getByText('任务已停止，成功内容已经保留')).toBeVisible()
    expect(screen.getByText('已保留正文')).toBeVisible()
    expect(screen.queryByRole('button', { name: '重试失败部分' })).not.toBeInTheDocument()
  })

  it('keeps validated refined analysis visible when the final Reduce result is unavailable', () => {
    const refinedSnapshot: Extract<TaskSnapshot, { status: 'partial' }> = {
      ...partialSnapshot,
      mode: 'refined',
      completedChunks: [{
        id: 'chunk-0',
        index: 0,
        content: {
          chapterCandidates: [],
          claims: [{
            text: '已完成的阶段性观点',
            sourceParagraphIds: ['p1'],
          }],
          facts: [],
          people: [],
          examples: [],
          conclusions: [],
        },
      }],
    }
    render(
      <PartialResultView
        snapshot={refinedSnapshot}
        metadata={metadata}
        includeTimestamps={false}
        onRetry={() => {}}
        onExport={() => {}}
        onBack={() => {}}
      />,
    )

    expect(screen.getByText('已保留的内容理解结果')).toBeVisible()
    expect(screen.getByText('已完成的阶段性观点')).toBeVisible()
    expect(screen.queryByRole('button', { name: '导出当前结果' })).not.toBeInTheDocument()
  })
})

describe('ErrorView', () => {
  it('shows error message', () => {
    render(<ErrorView error={{ code: 'NETWORK_FAILED', message: '连接超时' }} />)
    expect(screen.getByText('连接超时')).toBeVisible()
  })
})

describe('page action hierarchy', () => {
  it('keeps each main view to at most one primary action', () => {
    const { container, rerender } = render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        trackSelection="auto"
        outputLanguage="zh"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackSelectionChange={() => {}}
        onOutputLanguageChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )
    expect(container.querySelectorAll('.button--primary')).toHaveLength(1)

    rerender(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={async () => {}}
        onDownload={() => {}}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )
    expect(container.querySelectorAll('.button--primary')).toHaveLength(1)

    rerender(
      <PartialResultView
        snapshot={partialSnapshot}
        metadata={metadata}
        includeTimestamps={false}
        onRetry={() => {}}
        onExport={() => {}}
        onBack={() => {}}
      />,
    )
    expect(container.querySelectorAll('.button--primary')).toHaveLength(1)
  })
})

describe('result operations', () => {
  it('passes the same Markdown to copy and download', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn().mockResolvedValue(undefined)
    const onDownload = vi.fn()
    render(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={onCopy}
        onDownload={onDownload}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: '复制 Markdown' }))
    await user.click(screen.getByRole('button', { name: '下载 .md' }))

    expect(onCopy).toHaveBeenCalledTimes(1)
    expect(onDownload).toHaveBeenCalledWith(metadata.title, onCopy.mock.calls[0]?.[0])
    expect(screen.getByRole('button', { name: '已复制 Markdown' })).toBeVisible()
  })

  it('restores the copy button label after two seconds without blocking the page', async () => {
    vi.useFakeTimers()
    try {
      render(
        <ResultView
          document={completedDoc}
          includeTimestamps={false}
          chunkCount={1}
          elapsedMs={5_000}
          onCopy={vi.fn().mockResolvedValue(undefined)}
          onDownload={() => {}}
          onRegenerate={() => {}}
          onBackToPrepare={() => {}}
        />,
      )

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '复制 Markdown' }))
        await Promise.resolve()
      })
      expect(screen.getByRole('button', { name: '已复制 Markdown' })).toBeVisible()

      act(() => vi.advanceTimersByTime(2_000))
      expect(screen.getByRole('button', { name: '复制 Markdown' })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows actionable feedback when copying fails', async () => {
    const user = userEvent.setup()
    render(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={vi.fn().mockRejectedValue(new Error('剪贴板不可用'))}
        onDownload={() => {}}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: '复制 Markdown' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('剪贴板不可用')
    expect(screen.getByRole('button', { name: '复制 Markdown' })).toBeEnabled()
  })

  it('shows download failure without leaving result actions disabled', async () => {
    const user = userEvent.setup()
    render(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={async () => {}}
        onDownload={vi.fn().mockRejectedValue(new Error('下载权限不可用'))}
        onRegenerate={() => {}}
        onBackToPrepare={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: '下载 .md' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('下载权限不可用')
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeEnabled()
  })

  it('confirms regeneration and exposes settings in the more menu', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    const onBackToPrepare = vi.fn()
    render(
      <ResultView
        document={completedDoc}
        includeTimestamps={false}
        chunkCount={1}
        elapsedMs={5_000}
        onCopy={async () => {}}
        onDownload={() => {}}
        onRegenerate={onRegenerate}
        onBackToPrepare={onBackToPrepare}
      />,
    )

    await user.click(screen.getByRole('button', { name: '更多结果操作' }))
    await user.click(screen.getByRole('menuitem', { name: '按当前设置重新生成' }))
    expect(onRegenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '按当前设置重新生成？' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认重新生成' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '更多结果操作' }))
    await user.click(screen.getByRole('menuitem', { name: '调整生成设置' }))
    expect(onBackToPrepare).toHaveBeenCalledTimes(1)
  })

  it('exports partial Markdown with an explicit partial filename and marker', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(
      <PartialResultView
        snapshot={partialSnapshot}
        metadata={metadata}
        includeTimestamps={false}
        onRetry={() => {}}
        onExport={onExport}
        onBack={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: '导出当前结果' }))
    expect(onExport).toHaveBeenCalledWith(
      'Test Video-partial',
      expect.stringContaining('> 结果状态：不完整结果'),
    )
    expect(onExport.mock.calls[0]?.[1]).toContain('> 未完成分块：2')
  })
})
