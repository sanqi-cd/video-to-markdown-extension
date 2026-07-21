import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useActiveVideoTab } from '../../src/hooks/use-active-video-tab'
import type { ActiveTabSnapshot } from '../../src/browser/active-tab'

function HookHarness({ onChange }: { onChange: (tab: ActiveTabSnapshot) => void }) {
  useActiveVideoTab({ onChange })
  return null
}

describe('useActiveVideoTab', () => {
  afterEach(() => vi.restoreAllMocks())

  it('detects initially and re-detects when the active tab changes', async () => {
    let onActivated: ((activeInfo: chrome.tabs.OnActivatedInfo) => void) | undefined
    const query = vi.spyOn(
      chrome.tabs as unknown as { query: () => Promise<chrome.tabs.Tab[]> },
      'query',
    )
    query
      .mockResolvedValueOnce([{
        id: 1,
        url: 'https://example.com/',
      } as chrome.tabs.Tab])
      .mockResolvedValueOnce([{
        id: 2,
        url: 'https://www.youtube.com/watch?v=video-2',
      } as chrome.tabs.Tab])

    vi.spyOn(chrome.tabs.onActivated, 'addListener').mockImplementation((listener) => {
      onActivated = listener
    })
    const onChange = vi.fn()
    render(<HookHarness onChange={onChange} />)

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ tabId: 1, video: null })

    act(() => onActivated?.({ tabId: 2, windowId: 1 }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(onChange.mock.calls[1]?.[0]).toMatchObject({
      tabId: 2,
      video: { platform: 'youtube', videoId: 'video-2' },
    })
  })
})
