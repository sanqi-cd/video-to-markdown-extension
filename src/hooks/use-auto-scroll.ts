import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const BOTTOM_THRESHOLD_PX = 32

export function useAutoScroll(contentVersion: string | number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFollowing, setIsFollowing] = useState(true)

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current
    if (!container) return
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior })
    } else {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setIsFollowing(distanceFromBottom <= BOTTOM_THRESHOLD_PX)
  }, [])

  const resume = useCallback(() => {
    setIsFollowing(true)
    scrollToLatest('smooth')
  }, [scrollToLatest])

  useLayoutEffect(() => {
    if (isFollowing) scrollToLatest('auto')
  }, [contentVersion, isFollowing, scrollToLatest])

  return {
    containerRef,
    handleScroll,
    isFollowing,
    resume,
  }
}
