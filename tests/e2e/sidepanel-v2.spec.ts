import { test, expect, chromium, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'

type MockPanelOptions = {
  language: 'zh-Hans' | 'en'
  title: string
  captionBody: string
  initiallyUnavailable?: boolean
  stream?: 'success' | 'partial-retry'
  initialConfig?: boolean
}

test('refreshes a supported page whose content script was initially unavailable', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    language: 'zh-Hans',
    title: '刷新后的视频',
    captionBody: captionXml(['刷新后的字幕。']),
    initiallyUnavailable: true,
  })
  try {
    await expect(app.page.getByRole('heading', { name: '需要刷新视频页面' })).toBeVisible()
    await app.page.getByRole('button', { name: '刷新并重新检测' }).click()
    await expect(app.page.getByRole('heading', { name: '刷新后的视频' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: '开始生成' })).toBeVisible()
  } finally {
    await app.context.close()
  }
})

test('configures an English high-fidelity task and returns with its selections preserved', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    language: 'en',
    title: 'English Accessibility Video',
    captionBody: captionXml(['First English paragraph.', 'Second English paragraph.']),
  })
  try {
    await expect(app.page.getByRole('heading', { name: 'English Accessibility Video' })).toBeVisible()
    await app.page.setViewportSize({ width: 320, height: 760 })
    await app.page.getByLabel('保留时间戳').check()
    await app.page.getByRole('button', { name: '配置模型并继续' }).click()
    await expect(app.page.getByRole('heading', { name: '模型设置' })).toBeVisible()
    const providerBoxes = await app.page.locator('.provider-option').evaluateAll((elements) => (
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { x: Math.round(box.x), y: Math.round(box.y) }
      })
    ))
    expect(providerBoxes).toHaveLength(4)
    expect(providerBoxes[0]?.x).toBe(providerBoxes[2]?.x)
    expect(providerBoxes[1]?.x).toBe(providerBoxes[3]?.x)
    expect(providerBoxes[2]?.y).toBeGreaterThan(providerBoxes[0]?.y ?? 0)
    const actionBoxes = await app.page.locator('.settings-form__actions .button').evaluateAll(
      (elements) => elements.map((element) => {
        const box = element.getBoundingClientRect()
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) }
      }),
    )
    expect(actionBoxes[0]?.x).toBe(actionBoxes[1]?.x)
    expect(actionBoxes[0]?.width).toBe(actionBoxes[1]?.width)
    expect(actionBoxes[1]?.y).toBeGreaterThan(actionBoxes[0]?.y ?? 0)
    expect(await hasHorizontalOverflow(app.page)).toBe(false)
    await app.page.getByLabel('API Key').fill('sk-e2e-model-key')
    await app.page.getByRole('button', { name: '保存并测试' }).click()

    await expect(app.page.getByText('连接成功')).toBeVisible()
    await app.page.getByRole('button', { name: '返回视频继续' }).click()
    await expect(app.page.getByRole('heading', { name: 'English Accessibility Video' })).toBeVisible()
    await app.page.getByText('字幕来源', { exact: true }).click()
    await expect(app.page.getByRole('combobox', { name: '字幕来源' })).toHaveValue('auto')
    await expect(app.page.getByRole('radio', { name: '中文' })).toBeChecked()
    await expect(app.page.getByLabel('保留时间戳')).toBeChecked()
    await expect(app.page.getByRole('button', { name: '开始生成' })).toBeVisible()
  } finally {
    await app.context.close()
  }
})

test('generates English high-fidelity locally when English subtitles and output match', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    language: 'en',
    title: 'English Local Output',
    captionBody: captionXml(['Keep this paragraph in English.']),
  })
  try {
    await app.page.getByRole('radio', { name: 'English' }).click()
    await expect(app.page.getByText('无需模型')).toBeVisible()
    await app.page.getByRole('button', { name: '开始生成' }).click()
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).toBeVisible()
    await expect(app.page.getByRole('article', { name: '阅读预览' })).toContainText(
      'Keep this paragraph in English.',
    )
  } finally {
    await app.context.close()
  }
})

test('shows validated SSE content before completion', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    language: 'en',
    title: 'Streaming Video',
    captionBody: captionXml(['First streamed paragraph.', 'Second streamed paragraph.']),
    stream: 'success',
    initialConfig: true,
  })
  try {
    await expect(app.page.getByRole('heading', { name: 'Streaming Video' })).toBeVisible()
    await app.page.getByRole('button', { name: '开始生成' }).click()

    await expect(app.page.getByText(/已接收 \d+ 个字符/)).toBeVisible()
    await expect(app.page.getByLabel('已生成内容')).toContainText('中文：First streamed paragraph.')
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).not.toBeVisible()
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).toBeVisible()
    await expect(app.page.getByRole('article', { name: '阅读预览' })).toContainText(
      '中文：Second streamed paragraph.',
    )
  } finally {
    await app.context.close()
  }
})

test('keeps successful chunks and retries only the failed chunk', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const longFirstChunk = `${'FIRST_CHUNK '.repeat(350)}。`
  const secondChunk = `${'SECOND_CHUNK '.repeat(120)}。`
  const app = await openMockedPanel(testInfo, {
    language: 'en',
    title: 'Partial Retry Video',
    captionBody: captionXml([longFirstChunk, secondChunk]),
    stream: 'partial-retry',
    initialConfig: true,
  })
  try {
    await app.page.getByRole('button', { name: '开始生成' }).click()
    await expect(app.page.getByRole('heading', { name: '部分内容生成成功' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(app.page.getByText(/1 个分块需要重试/)).toBeVisible()
    await expect(app.page.getByText(/中文：FIRST_CHUNK/).first()).toBeVisible()

    await app.page.getByRole('button', { name: '重试失败部分' }).click()
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(app.page.getByRole('article', { name: '阅读预览' })).toContainText(
      '中文：SECOND_CHUNK',
    )
    expect(await app.page.evaluate(() => (
      globalThis as typeof globalThis & {
        __v2mdFirstChunkRequests?: number
        __v2mdSecondChunkRequests?: number
      }
    ).__v2mdFirstChunkRequests)).toBe(1)
    expect(await app.page.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdSecondChunkRequests?: number }
    ).__v2mdSecondChunkRequests)).toBe(4)
  } finally {
    await app.context.close()
  }
})

async function openMockedPanel(testInfo: TestInfo, options: MockPanelOptions): Promise<{
  context: BrowserContext
  page: Page
}> {
  const extensionPath = path.resolve('.output/chrome-mv3')
  const context = await chromium.launchPersistentContext(
    testInfo.outputPath('user-data-dir'),
    {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    },
  )
  let [worker] = context.serviceWorkers()
  worker ??= await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const page = await context.newPage()
  await page.setViewportSize({ width: 380, height: 760 })
  await page.addInitScript(installMockBrowserState, options)
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)

  if (options.initialConfig) {
    await page.evaluate(() => chrome.storage.local.set({
      modelConfig: {
        version: 2,
        providerId: 'deepseek',
        apiKey: 'sk-e2e-stream',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        contextWindow: 16_000,
        streamMode: 'auto',
        lastTest: { status: 'success', testedAt: Date.now(), latencyMs: 10 },
      },
    }))
    await page.reload()
  }
  return { context, page }
}

function installMockBrowserState(options: MockPanelOptions) {
  type UpdatedListener = (
    tabId: number,
    changeInfo: { status?: string },
    tab: { id: number; url: string },
  ) => void
  type MessageListener = (message: unknown) => void
  const state = {
    refreshed: !options.initiallyUnavailable,
    firstChunkRequests: 0,
    secondChunkRequests: 0,
  }
  const updatedListeners = new Set<UpdatedListener>()
  const videoUrl = 'https://www.youtube.com/watch?v=mock-video'
  const trackId = options.language === 'en' ? '.en' : '.zh-Hans'
  const contextResponse = {
    success: true,
    bridgeVersion: 1,
    platform: 'youtube',
    data: {
      videoId: 'mock-video',
      metadata: { title: options.title, author: 'E2E 作者', durationMs: 120_000 },
      tracks: [{
        baseUrl: `https://www.youtube.com/api/timedtext?v=mock-video&lang=${options.language}`,
        languageCode: options.language,
        label: options.language === 'en' ? 'English' : '中文（简体）',
        vssId: trackId,
        isAutoGenerated: false,
      }],
    },
  }

  const tabs = chrome.tabs as unknown as Record<string, unknown> & {
    onUpdated: {
      addListener: (listener: UpdatedListener) => void
      removeListener: (listener: UpdatedListener) => void
    }
  }
  Object.defineProperty(tabs, 'query', {
    configurable: true,
    value: async () => [{ id: 101, url: videoUrl }],
  })
  Object.defineProperty(tabs, 'sendMessage', {
    configurable: true,
    value: async (_tabId: number, message: { type?: string }) => {
      if (message.type === 'VIDEO_CONTEXT_REQUEST') {
        if (!state.refreshed) throw new Error('Receiving end does not exist')
        return contextResponse
      }
      if (message.type === 'YOUTUBE_CAPTION_FETCH_REQUEST') {
        return { success: true, status: 200, body: options.captionBody }
      }
      return undefined
    },
  })
  Object.defineProperty(tabs, 'reload', {
    configurable: true,
    value: async () => {
      state.refreshed = true
      setTimeout(() => {
        for (const listener of updatedListeners) {
          listener(101, { status: 'complete' }, { id: 101, url: videoUrl })
        }
      }, 0)
    },
  })
  Object.defineProperty(tabs.onUpdated, 'addListener', {
    configurable: true,
    value: (listener: UpdatedListener) => updatedListeners.add(listener),
  })
  Object.defineProperty(tabs.onUpdated, 'removeListener', {
    configurable: true,
    value: (listener: UpdatedListener) => updatedListeners.delete(listener),
  })

  const runtime = chrome.runtime as unknown as Record<string, unknown>
  Object.defineProperty(runtime, 'sendMessage', {
    configurable: true,
    value: async () => ({ success: true, data: { ok: true } }),
  })
  const permissions = chrome.permissions as unknown as Record<string, unknown>
  Object.defineProperty(permissions, 'request', {
    configurable: true,
    value: async () => true,
  })

  if (options.stream) {
    Object.defineProperty(runtime, 'connect', {
      configurable: true,
      value: () => {
        const messageListeners = new Set<MessageListener>()
        const disconnectListeners = new Set<() => void>()
        const emit = (message: unknown) => {
          for (const listener of messageListeners) listener(message)
        }
        return {
          name: 'model-stream-v1',
          onMessage: {
            addListener: (listener: MessageListener) => messageListeners.add(listener),
            removeListener: (listener: MessageListener) => messageListeners.delete(listener),
          },
          onDisconnect: {
            addListener: (listener: () => void) => disconnectListeners.add(listener),
            removeListener: (listener: () => void) => disconnectListeners.delete(listener),
          },
          postMessage: (raw: unknown) => {
            if (typeof raw !== 'object' || raw === null) return
            const command = raw as {
              type?: string
              taskId?: string
              requestId?: string
              messages?: Array<{ content: string }>
            }
            if (command.type !== 'START' || !command.taskId || !command.requestId) return
            const common = { taskId: command.taskId, requestId: command.requestId }
            emit({ type: 'STARTED', ...common })
            setTimeout(() => emit({ type: 'CONNECTED', ...common }), 20)

            const userMessage = command.messages?.at(-1)?.content ?? '{}'
            const payload = JSON.parse(userMessage) as {
              paragraphs?: Array<{ id: string; text: string }>
            }
            const paragraphs = payload.paragraphs ?? []
            const isSecondChunk = paragraphs.some((paragraph) => (
              paragraph.text.includes('SECOND_CHUNK')
            ))
            if (isSecondChunk) {
              state.secondChunkRequests += 1
              ;(globalThis as typeof globalThis & { __v2mdSecondChunkRequests?: number })
                .__v2mdSecondChunkRequests = state.secondChunkRequests
            } else {
              state.firstChunkRequests += 1
              ;(globalThis as typeof globalThis & { __v2mdFirstChunkRequests?: number })
                .__v2mdFirstChunkRequests = state.firstChunkRequests
            }
            if (
              options.stream === 'partial-retry'
              && isSecondChunk
              && state.secondChunkRequests <= 3
            ) {
              setTimeout(() => emit({
                type: 'ERROR',
                ...common,
                error: { code: 'NETWORK_FAILED', message: '模拟第二分块网络失败' },
              }), 60)
              return
            }

            const lines = paragraphs.map((paragraph) => JSON.stringify({
              type: 'paragraph',
              id: paragraph.id,
              text: `中文：${paragraph.text}`,
            }))
            const content = lines.join('\n')
            const firstDelta = lines.length > 1 ? `${lines[0]}\n` : content
            const remaining = content.slice(firstDelta.length)
            setTimeout(() => emit({
              type: 'DELTA',
              ...common,
              text: firstDelta,
              receivedChars: firstDelta.length,
            }), 80)
            if (remaining) {
              setTimeout(() => emit({
                type: 'DELTA',
                ...common,
                text: remaining,
                receivedChars: content.length,
              }), 500)
            }
            setTimeout(() => emit({ type: 'DONE', ...common, content }), remaining ? 560 : 140)
          },
          disconnect: () => {},
        }
      },
    })
  }
}

function captionXml(paragraphs: string[]): string {
  return [
    '<transcript>',
    ...paragraphs.map((text, index) => (
      `<text start="${index * 3}" dur="1">${escapeXml(text)}</text>`
    )),
    '</transcript>',
  ].join('')
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))
}
