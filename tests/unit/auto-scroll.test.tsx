import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutoScroll } from '../../src/hooks/use-auto-scroll'

function AutoScrollHarness({ version }: { version: number }) {
  const {
    containerRef,
    handleScroll,
    isFollowing,
    pendingCount,
    resume,
  } = useAutoScroll(version, version)
  return (
    <div>
      <div ref={containerRef} onScroll={handleScroll} data-testid="viewport">
        内容版本 {version}
      </div>
      <span data-testid="following">{isFollowing ? 'following' : 'paused'}</span>
      <span data-testid="pending">{pendingCount}</span>
      {!isFollowing && <button onClick={resume}>回到最新</button>}
    </div>
  )
}

function configureViewport(viewport: HTMLElement) {
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1_000 })
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 })
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, writable: true, value: 800 })
  const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    viewport.scrollTop = Number(top)
  })
  Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo })
  return scrollTo
}

describe('useAutoScroll', () => {
  it('does not force the viewport down after the user scrolls upward', () => {
    const { rerender } = render(<AutoScrollHarness version={1} />)
    const viewport = screen.getByTestId('viewport')
    const scrollTo = configureViewport(viewport)

    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    expect(screen.getByTestId('following')).toHaveTextContent('paused')
    scrollTo.mockClear()

    rerender(<AutoScrollHarness version={2} />)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '回到最新' })).toBeVisible()
  })

  it('returns to the bottom and resumes following after explicit action', () => {
    render(<AutoScrollHarness version={1} />)
    const viewport = screen.getByTestId('viewport')
    const scrollTo = configureViewport(viewport)
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)

    fireEvent.click(screen.getByRole('button', { name: '回到最新' }))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'smooth' })
    expect(screen.getByTestId('following')).toHaveTextContent('following')
    expect(screen.queryByRole('button', { name: '回到最新' })).not.toBeInTheDocument()
  })

  it('keeps the viewport stable and records new content by default', async () => {
    const { rerender } = render(<AutoScrollHarness version={1} />)
    const viewport = screen.getByTestId('viewport')
    const scrollTo = configureViewport(viewport)

    rerender(<AutoScrollHarness version={2} />)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByTestId('following')).toHaveTextContent('paused')
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('1'))
  })

  it('follows subsequent content only after the user explicitly resumes', () => {
    const { rerender } = render(<AutoScrollHarness version={1} />)
    const viewport = screen.getByTestId('viewport')
    const scrollTo = configureViewport(viewport)

    fireEvent.click(screen.getByRole('button', { name: '回到最新' }))
    scrollTo.mockClear()
    rerender(<AutoScrollHarness version={2} />)

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: 'smooth' })
    expect(screen.getByTestId('pending')).toHaveTextContent('0')
  })
})
