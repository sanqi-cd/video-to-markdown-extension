import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoSubtitleView } from '../../src/components/NoSubtitleView'

const metadata = {
  platform: 'bilibili' as const,
  videoId: 'BV1test',
  title: '无字幕视频',
  canonicalUrl: 'https://www.bilibili.com/video/BV1test',
}

describe('NoSubtitleView recovery', () => {
  it('distinguishes unreliable subtitles and offers read-only redetection', async () => {
    const onRedetect = vi.fn()
    render(<NoSubtitleView metadata={metadata} reason="unreliable" onRedetect={onRedetect} />)
    expect(screen.getByRole('heading', { name: '字幕暂时无法可靠使用' })).toBeVisible()
    expect(screen.queryByText('未找到可直接提取的字幕')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /重新检测/ }))
    expect(onRedetect).toHaveBeenCalledOnce()
  })
  it('keeps publisher discovery as a no-audio alternative', async () => {
    const user = userEvent.setup()
    const onDiscover = vi.fn().mockResolvedValue({
      status: 'not-found',
      message: '没有找到可直接读取的完整发布者文稿。',
    })
    render(
      <NoSubtitleView
        metadata={metadata}
        onDiscoverPublisherTranscript={onDiscover}
        onManualYouTubeSource={async () => {}}
      />,
    )

    await user.click(screen.getByText('不发送音频的其他方式'))
    await user.click(screen.getByRole('button', { name: '自动查找发布者文稿' }))
    expect(onDiscover).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('没有找到可用的完整文稿')).toBeVisible()
    const alternatives = screen.getByText('不发送音频的其他方式').closest('details')
    expect(alternatives).toHaveAttribute('open')
  })

  it('shows a locked publisher transcript with its original link', async () => {
    const user = userEvent.setup()
    render(
      <NoSubtitleView
        metadata={metadata}
        onDiscoverPublisherTranscript={async () => ({
          status: 'locked',
          url: 'https://www.bilibili.com/opus/123',
          message: '加入当前 UP 主充电即可解锁',
        })}
      />,
    )

    await user.click(screen.getByText('不发送音频的其他方式'))
    await user.click(screen.getByRole('button', { name: '自动查找发布者文稿' }))
    expect(await screen.findByText('已找到发布者文稿，但当前无法读取')).toBeVisible()
    expect(screen.getByRole('link', { name: '在 B 站打开文稿' })).toHaveAttribute(
      'href',
      'https://www.bilibili.com/opus/123',
    )
  })

  it('makes direct audio transcription the primary recovery', () => {
    render(
      <NoSubtitleView
        metadata={metadata}
        transcriptionConfig={null}
        transcriptionState={{ status: 'idle' }}
        onSaveTranscriptionConfig={async () => {}}
        onDeleteTranscriptionConfig={async () => {}}
        onStartTranscription={async () => {}}
        onStopTranscription={async () => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: '直接转录当前视频' })).toBeVisible()
    expect(screen.getByText(/不需要原视频链接/)).toBeVisible()
    expect(screen.getByLabelText('转写接口')).toHaveValue(
      'https://api.openai.com/v1/audio/transcriptions',
    )
  })
})
