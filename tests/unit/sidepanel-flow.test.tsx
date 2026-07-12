import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrepareView } from '../../src/components/PrepareView'
import { ProgressView } from '../../src/components/ProgressView'
import { ResultView, PartialResultView, ErrorView } from '../../src/components/ResultView'
import type { VideoMetadata, SubtitleTrack } from '../../src/core/contracts'
import type { ProcessedDocument } from '../../src/core/orchestrator'
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
  content: [
    { id: 'p1', startMs: 0, endMs: 5000, text: 'Hello world.' },
  ] as TranslatedParagraph[],
}

describe('PrepareView', () => {
  it('shows title and start button', () => {
    render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )
    expect(screen.getByText('Test Video')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成' })).toBeVisible()
  })

  it('shows subtitle track options', () => {
    render(
      <PrepareView
        metadata={metadata}
        tracks={tracks}
        selectedTrackId="en"
        mode="high-fidelity"
        includeTimestamps={false}
        onTrackChange={() => {}}
        onModeChange={() => {}}
        onTimestampsChange={() => {}}
        onStart={() => {}}
      />,
    )
    expect(screen.getByText('English')).toBeVisible()
    expect(screen.getByText('中文')).toBeVisible()
  })
})

describe('ProgressView', () => {
  it('shows stage and progress info', () => {
    render(
      <ProgressView
        stage="AI 精炼"
        completed={3}
        total={10}
        startedAt={Date.now()}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/AI 精炼/)).toBeVisible()
    expect(screen.getByText(/3.*10/)).toBeVisible()
  })

  it('has a cancel button', () => {
    render(
      <ProgressView
        stage="处理中"
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
        markdown="# Test"
        onCopy={async () => {}}
        onDownload={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeVisible()
  })
})

describe('PartialResultView', () => {
  it('shows retry button', () => {
    render(<PartialResultView failedCount={2} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: '重试失败部分' })).toBeVisible()
    expect(screen.getByText(/2/)).toBeVisible()
  })
})

describe('ErrorView', () => {
  it('shows error message', () => {
    render(<ErrorView error={{ code: 'NETWORK_FAILED', message: '连接超时' }} />)
    expect(screen.getByText('连接超时')).toBeVisible()
  })
})
