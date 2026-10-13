import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ManualYouTubeSourceForm } from '../../src/components/ManualYouTubeSourceForm'

describe('ManualYouTubeSourceForm', () => {
  it('submits the exact URL and reports success', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ManualYouTubeSourceForm onSubmit={onSubmit} />)

    await user.type(
      screen.getByRole('textbox', { name: 'YouTube 原视频链接' }),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    await user.click(screen.getByRole('button', { name: '读取字幕' }))

    expect(onSubmit).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(await screen.findByRole('status')).toHaveTextContent('原视频字幕已加载')
  })

  it('keeps an actionable error visible', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('链接无效'))
    render(<ManualYouTubeSourceForm onSubmit={onSubmit} />)

    await user.type(screen.getByRole('textbox'), 'https://youtu.be/dQw4w9WgXcQ')
    await user.click(screen.getByRole('button', { name: '读取字幕' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('链接无效')
  })
})
