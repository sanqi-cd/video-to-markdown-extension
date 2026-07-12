import '@testing-library/jest-dom/vitest'

// Minimal Chrome API mock for tests
if (!globalThis.chrome) {
  const storage = new Map<string, unknown>()
  ;(globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: (keys: string[]) => {
          const result: Record<string, unknown> = {}
          for (const k of keys) {
            if (storage.has(k)) result[k] = storage.get(k)
          }
          return Promise.resolve(result)
        },
        set: (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) storage.set(k, v)
          return Promise.resolve()
        },
        remove: (keys: string[]) => {
          for (const k of keys) storage.delete(k)
          return Promise.resolve()
        },
      },
    },
    tabs: {
      query: () => Promise.reject(new Error('chrome.tabs not available in test')),
      sendMessage: () => Promise.reject(new Error('chrome.tabs not available in test')),
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: () => Promise.reject(new Error('chrome.runtime not available in test')),
    },
    sidePanel: {
      setPanelBehavior: () => Promise.resolve(),
    },
    downloads: {
      download: () => {},
    },
  }
}

