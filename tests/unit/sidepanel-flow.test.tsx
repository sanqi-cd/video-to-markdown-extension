import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../entrypoints/sidepanel/App'
import type { TaskState, ProcessedDocument } from '../../src/core/orchestrator'
import type { TranslatedParagraph } from '../../src/processors/high-fidelity'

const completedDoc: ProcessedDocument = {
  metadata: {
    platform: 'youtube',
    videoId: 'test123',
    title: 'Test Video',
    canonicalUrl: 'https://www.youtube.com/watch?v=test123',
  },
  mode: 'high-fidelity',
  content: [
    { id: 'p1', startMs: 0, endMs: 5000, text: 'Hello world.' },
  ] as TranslatedParagraph[],
}

const completedState: TaskState = {
  status: 'completed',
  document: completedDoc,
}

const partialState: TaskState = {
  status: 'partial',
  completedChunks: [{ id: 'chunk-0', content: {} }],
  failedChunks: [
    { id: 'chunk-1', error: { code: 'NETWORK_FAILED', message: '网络错误' } },
  ],
}

const failedState: TaskState = {
  status: 'failed',
  error: { code: 'NETWORK_FAILED', message: '连接超时' },
}

const runningState: TaskState = {
  status: 'running',
  stage: 'AI 精炼',
  completed: 3,
  total: 10,
  startedAt: Date.now(),
}

describe('App state routing', () => {
  it('shows heading when idle (no state prop)', () => {
    render(<App />)
    expect(screen.getByText('请先配置模型')).toBeVisible()
  })

  it('shows download button for completed task', () => {
    render(<App initialState={completedState} />)
    expect(screen.getByRole('button', { name: '下载 .md' })).toBeVisible()
  })

  it('shows retry button for partial task', () => {
    render(<App initialState={partialState} />)
    expect(screen.getByRole('button', { name: '重试失败部分' })).toBeVisible()
  })

  it('shows error message for failed task', () => {
    render(<App initialState={failedState} />)
    expect(screen.getByText('连接超时')).toBeVisible()
  })

  it('shows progress info for running task', () => {
    render(<App initialState={runningState} />)
    expect(screen.getByText(/AI 精炼/)).toBeVisible()
    expect(screen.getByText(/3.*10/)).toBeVisible()
  })

  it('shows cancel button during running', () => {
    render(<App initialState={runningState} />)
    expect(screen.getByRole('button', { name: '取消' })).toBeVisible()
  })

  it('shows generate button in idle/ready state', () => {
    render(<App initialState={{ status: 'idle' }} />)
    expect(screen.getByText('请先配置模型')).toBeVisible()
  })
})
