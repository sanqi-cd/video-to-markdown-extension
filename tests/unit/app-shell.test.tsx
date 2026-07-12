import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../entrypoints/sidepanel/App'

describe('side panel shell', () => {
  it('shows the product name and configuration state', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Video to Markdown' })).toBeVisible()
    expect(screen.getByText('请先配置模型')).toBeVisible()
  })
})
