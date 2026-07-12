import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/components/App'

describe('side panel shell', () => {
  it('shows the product name', () => {
    // The App will try to access chrome.storage on mount.
    // Since chrome is not defined in jsdom, the useEffect will
    // catch and fall through to the loading state.
    render(<App />)

    // The heading is always rendered
    expect(screen.getByRole('heading', { name: 'Video to Markdown' })).toBeVisible()
  })
})
