import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD_PX = 32
const PROGRAMMATIC_SCROLL_GUARD_MS = 500

export function useAutoScroll(
  contentVersion: string | number,
  contentCount: number,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousVersionRef = useRef(contentVersion)
  const previousContentCountRef = useRef(contentCount)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current
    if (!container) return
    if (behavior === 'smooth') {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current)
      }
      programmaticScrollRef.current = true
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false
        programmaticScrollTimerRef.current = null
      }, PROGRAMMATIC_SCROLL_GUARD_MS)
    }
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior })
    } else {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container || programmaticScrollRef.current) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isAtBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX
    setIsFollowing(isAtBottom)
    if (isAtBottom) setPendingCount(0)
  }, [])

  const resume = useCallback(() => {
    setIsFollowing(true)
    setPendingCount(0)
    scrollToLatest('smooth')
  }, [scrollToLatest])

  useLayoutEffect(() => {
    if (previousVersionRef.current === contentVersion) return

    const addedCount = Math.max(1, contentCount - previousContentCountRef.current)
    previousVersionRef.current = contentVersion
    previousContentCountRef.current = contentCount

    const container = containerRef.current
    if (!container) return

    if (isFollowing) {
      scrollToLatest('smooth')
      return
    }

    if (container.scrollHeight > container.clientHeight) {
      queueMicrotask(() => {
        setPendingCount((current) => current + addedCount)
      })
    }
  }, [contentCount, contentVersion, isFollowing, scrollToLatest])

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current)
    }
  }, [])

  return {
    containerRef,
    handleScroll,
    isFollowing,
    pendingCount,
    resume,
  }
}
