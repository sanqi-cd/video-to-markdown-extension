import { useEffect, useRef } from 'react'
import {
  activeTabIdentity,
  getActiveTabSnapshot,
  type ActiveTabSnapshot,
} from '../browser/active-tab'

type UseActiveVideoTabOptions = {
  enabled?: boolean
  onChange: (tab: ActiveTabSnapshot) => void
  onError?: (error: unknown) => void
}

export function useActiveVideoTab({
  enabled = true,
  onChange,
  onError,
}: UseActiveVideoTabOptions): void {
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onChangeRef.current = onChange
    onErrorRef.current = onError
  }, [onChange, onError])

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let pendingTimer: ReturnType<typeof globalThis.setTimeout> | undefined
    let lastIdentity: string | undefined

    const detect = () => {
      if (pendingTimer !== undefined) globalThis.clearTimeout(pendingTimer)
      pendingTimer = globalThis.setTimeout(() => {
        void getActiveTabSnapshot()
          .then((tab) => {
            if (disposed) return
            const identity = activeTabIdentity(tab)
            if (identity === lastIdentity) return
            lastIdentity = identity
            onChangeRef.current(tab)
          })
          .catch((error) => {
            if (!disposed) onErrorRef.current?.(error)
          })
      }, 50)
    }

    const onActivated = () => detect()
    const onUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
    ) => {
      if (changeInfo.status || changeInfo.url) detect()
    }

    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    detect()

    return () => {
      disposed = true
      if (pendingTimer !== undefined) globalThis.clearTimeout(pendingTimer)
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [enabled])
}
