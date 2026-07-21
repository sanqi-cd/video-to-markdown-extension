import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../../src/components/ui/Button'
import { EmptyState } from '../../src/components/ui/EmptyState'
import { ProgressBar } from '../../src/components/ui/ProgressBar'
import { StatusBadge } from '../../src/components/ui/StatusBadge'
import { VideoCard } from '../../src/components/ui/VideoCard'

describe('Side Panel UI components', () => {
  it('renders the four button levels', () => {
    const { container } = render(
      <div>
        <Button variant="primary">主操作</Button>
        <Button variant="secondary">次操作</Button>
        <Button variant="danger-outline">危险操作</Button>
        <Button variant="text">文字操作</Button>
      </div>,
    )

    expect(container.querySelectorAll('.button--primary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '次操作' })).toHaveClass('button--secondary')
    expect(screen.getByRole('button', { name: '危险操作' })).toHaveClass('button--danger-outline')
    expect(screen.getByRole('button', { name: '文字操作' })).toHaveClass('button--text')
  })

  it('requires an accessible name for an icon-only button', () => {
    render(<Button iconOnly aria-label="返回">←</Button>)
    expect(screen.getByRole('button', { name: '返回' })).toBeVisible()
  })

  it('exposes loading and error empty states with appropriate live semantics', () => {
    const { rerender } = render(<EmptyState tone="loading" title="正在检测" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')

    rerender(<EmptyState tone="error" title="读取失败" />)
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败')
  })

  it('clamps progress and exposes progressbar values', () => {
    render(<ProgressBar value={12} max={10} label="处理进度" showValue />)
    const progress = screen.getByRole('progressbar', { name: '处理进度' })
    expect(progress).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByText('100%')).toBeVisible()
  })

  it('renders status and video information without tiny helper text', () => {
    render(
      <VideoCard
        metadata={{
          platform: 'youtube',
          videoId: 'abc',
          title: '示例视频',
          author: '作者',
          durationMs: 62000,
          canonicalUrl: 'https://www.youtube.com/watch?v=abc',
        }}
        subtitle="2 条字幕"
      />,
    )
    expect(screen.getByText('YouTube')).toHaveClass('status-badge--info')
    expect(screen.getByText('示例视频')).toBeVisible()
    expect(screen.getByText('作者 · 1:02')).toBeVisible()
  })

  it('renders a success status badge', () => {
    render(<StatusBadge tone="success">已连接</StatusBadge>)
    expect(screen.getByText('已连接')).toHaveClass('status-badge--success')
  })
})
