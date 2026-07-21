import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabSwitchConfirm } from '../../src/components/TabSwitchConfirm'
import { WelcomeView } from '../../src/components/WelcomeView'
import { RefreshRequiredView } from '../../src/components/RefreshRequiredView'
import { NoSubtitleView } from '../../src/components/NoSubtitleView'

const nextTab = {
  tabId: 9,
  url: 'https://www.bilibili.com/video/BV123',
  video: { platform: 'bilibili' as const, videoId: 'BV123' },
}

describe('TabSwitchConfirm', () => {
  it('announces the pending platform and exposes two explicit decisions', () => {
    render(
      <TabSwitchConfirm
        nextTab={nextTab}
        onContinueCurrent={() => {}}
        onStopAndSwitch={() => {}}
      />,
    )

    expect(screen.getByRole('dialog', { name: '要切换到新页面吗？' })).toBeVisible()
    expect(screen.getByText(/哔哩哔哩视频/)).toBeVisible()
    expect(screen.getByRole('button', { name: '继续当前任务' })).toBeVisible()
    expect(screen.getByRole('button', { name: '停止并加载新视频' })).toBeVisible()
  })

  it('keeps the current task when the user chooses continue', async () => {
    const onContinueCurrent = vi.fn()
    const user = userEvent.setup()
    render(
      <TabSwitchConfirm
        nextTab={nextTab}
        onContinueCurrent={onContinueCurrent}
        onStopAndSwitch={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: '继续当前任务' }))
    expect(onContinueCurrent).toHaveBeenCalledOnce()
  })

  it('requests cancellation and switching as one explicit action', async () => {
    const onStopAndSwitch = vi.fn()
    const user = userEvent.setup()
    render(
      <TabSwitchConfirm
        nextTab={nextTab}
        onContinueCurrent={() => {}}
        onStopAndSwitch={onStopAndSwitch}
      />,
    )
    await user.click(screen.getByRole('button', { name: '停止并加载新视频' }))
    expect(onStopAndSwitch).toHaveBeenCalledOnce()
  })
})

describe('video context state views', () => {
  it('keeps welcome and refresh-required as separate instructions', () => {
    const { rerender } = render(<WelcomeView />)
    expect(screen.getByRole('heading', { name: '打开一个视频开始' })).toBeVisible()

    rerender(<RefreshRequiredView />)
    expect(screen.getByRole('heading', { name: '需要刷新视频页面' })).toBeVisible()
    expect(screen.queryByText('打开一个视频开始')).not.toBeInTheDocument()
  })

  it('does not direct no-subtitle users to model configuration', () => {
    render(
      <NoSubtitleView
        metadata={{
          platform: 'youtube',
          videoId: 'video-1',
          title: '无字幕视频',
          canonicalUrl: 'https://www.youtube.com/watch?v=video-1',
        }}
      />,
    )
    expect(screen.getByRole('heading', { name: '这个视频没有可用字幕' })).toBeVisible()
    expect(screen.getByText(/不会调用模型生成字幕/)).toBeVisible()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  })
})
