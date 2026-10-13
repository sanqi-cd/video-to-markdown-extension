export type ServiceWorkerKeepAlive = {
  acquire: () => void
  release: () => void
}

/**
 * Chrome MV3 may terminate the worker while a model fetch is still waiting for
 * the first byte. Periodic runtime pings reset the idle timer for as long as
 * any stream port is connected.
 */
export function createServiceWorkerKeepAlive(
  ping: () => void,
  intervalMs = 20_000,
): ServiceWorkerKeepAlive {
  let count = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const sync = () => {
    if (count > 0 && timer === null) {
      ping()
      timer = setInterval(ping, intervalMs)
      return
    }
    if (count <= 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    acquire() {
      count += 1
      sync()
    },
    release() {
      count = Math.max(0, count - 1)
      sync()
    },
  }
}
