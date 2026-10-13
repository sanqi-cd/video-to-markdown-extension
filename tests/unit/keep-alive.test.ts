import { describe, expect, it, vi } from 'vitest'
import { createServiceWorkerKeepAlive } from '../../src/browser/keep-alive'

describe('createServiceWorkerKeepAlive', () => {
  it('pings while acquired and stops after the last release', () => {
    vi.useFakeTimers()
    const ping = vi.fn()
    const keepAlive = createServiceWorkerKeepAlive(ping, 20_000)
    try {
      keepAlive.acquire()
      expect(ping).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(20_000)
      expect(ping).toHaveBeenCalledTimes(2)
      keepAlive.release()
      vi.advanceTimersByTime(20_000)
      expect(ping).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
