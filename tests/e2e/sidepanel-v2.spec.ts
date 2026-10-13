import { test, expect, chromium, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'

type MockPanelOptions = {
  platform?: 'youtube' | 'bilibili'
  language: 'zh-Hans' | 'en'
  title: string
  captionBody: string
  initiallyUnavailable?: boolean
  stream?: 'success' | 'partial-retry'
  initialConfig?: boolean
  transcription?: boolean
  unreliableSubtitle?: boolean
}

test('blocks incomplete subtitles before generation and offers redetection and speech setup', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    platform: 'bilibili', language: 'zh-Hans', title: '长访谈', captionBody: '', unreliableSubtitle: true,
  })
  try {
    await expect(app.page.getByRole('heading', { name: '字幕暂时无法可靠使用' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: '开始生成', exact: true })).toHaveCount(0)
    await expect(app.page.getByLabel('接口类型')).toBeVisible()
    await app.page.getByRole('button', { name: '↻ 重新检测', exact: true }).click()
    await expect(app.page.getByRole('heading', { name: '字幕暂时无法可靠使用' })).toBeVisible()
    await app.page.getByLabel('接口类型').selectOption('ark-responses')
    await expect(app.page.getByLabel('转写接口')).toHaveValue('https://ark.cn-beijing.volces.com/api/v3/responses')
    await expect(app.page.getByLabel('API Key', { exact: true })).toBeEmpty()
  } finally { await app.context.close() }
})

test('turns direct Bilibili audio transcription into a selectable Markdown source', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    platform: 'bilibili',
    language: 'en',
    title: 'B站无字幕访谈',
    captionBody: '',
    transcription: true,
  })
  try {
    await expect(app.page.getByRole('heading', { name: '直接转录当前视频' })).toBeVisible()
    await app.page.getByLabel('API Key').fill('sk-local-e2e')
    await app.page.getByRole('button', { name: '保存配置并开始转录' }).click()
    await expect(app.page.getByText(/正在转写第/)).toBeVisible()
    await expect(app.page.getByRole('heading', { name: 'B站无字幕访谈' })).toBeVisible()
    await expect(app.page.getByText('字幕：音频转写', { exact: true })).toBeVisible()

    await app.page.getByRole('radio', { name: 'English' }).click()
    await app.page.getByRole('button', { name: '开始生成' }).click()
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).toBeVisible()
    await expect(app.page.getByRole('article', { name: '阅读预览' }))
      .toContainText('Direct audio transcript')
  } finally {
    await app.context.close()
  }
})

test('loads an exact manual YouTube source for a Bilibili video without subtitles', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const app = await openMockedPanel(testInfo, {
    platform: 'bilibili',
    language: 'en',
    title: 'B站转载视频',
    captionBody: captionXml(['Exact manual source transcript.']),
  })
  try {
    await expect(app.page.getByRole('heading', { name: '未找到可直接提取的字幕' })).toBeVisible()
    await app.page.getByText('不发送音频的其他方式').click()
    await app.page.getByRole('textbox', { name: 'YouTube 原视频链接' }).fill(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    await app.page.getByRole('button', { name: '读取字幕' }).click()

    await expect(app.page.getByRole('heading', { name: 'B站转载视频' })).toBeVisible()
    await app.page.getByRole('radio', { name: 'English' }).click()
    await app.page.getByRole('button', { name: '开始生成' }).click()
    await expect(app.page.getByRole('heading', { name: 'Markdown 已生成' })).toBeVisible()
    await expect(app.page.getByRole('article', { name: '阅读预览' })).toContainText(
      'Exact manual source transcript.',
    )
  } finally {
    await app.context.close()
  }
})

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
      timeout: 15_000,
    })
    await expect(app.page.getByText(/1 个分块需要重试/)).toBeVisible()
    await expect(app.page.getByText(/中文：FIRST_CHUNK/).first()).toBeVisible()

    const successfulChunkRequestsBeforeRetry = await app.page.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdFirstChunkRequests?: number }
    ).__v2mdFirstChunkRequests)
    expect(successfulChunkRequestsBeforeRetry).toBeGreaterThan(0)
    const failedChunkRequestsBeforeRetry = await app.page.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdSecondChunkRequests?: number }
    ).__v2mdSecondChunkRequests)
    expect(failedChunkRequestsBeforeRetry).toBeGreaterThan(0)

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
    ).__v2mdFirstChunkRequests)).toBe(successfulChunkRequestsBeforeRetry)
    expect(await app.page.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdSecondChunkRequests?: number }
    ).__v2mdSecondChunkRequests)).toBe((failedChunkRequestsBeforeRetry ?? 0) + 1)
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
  if (options.platform === 'bilibili') {
    await context.route('https://api.bilibili.com/**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: options.unreliableSubtitle ? {
        bvid: 'BV1manual123', aid: 101, cid: 202,
        subtitle: { subtitles: [{ id: 1, lan: 'zh', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/test.json' }] },
      } : {} }),
    }))
    await context.route('https://aisubtitle.hdslb.com/test.json', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ body: [{ from: 0, to: 423, content: '这是不完整的短字幕' }] }),
    }))
    await context.route('https://www.youtube.com/youtubei/v1/player**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: {
          videoId: 'dQw4w9WgXcQ',
          title: 'Exact YouTube source',
          author: 'Source author',
          lengthSeconds: '120',
        },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en',
              languageCode: 'en',
              name: { simpleText: 'English' },
              vssId: '.en',
            }],
          },
        },
      }),
    }))
    await context.route('https://www.youtube.com/api/timedtext**', (route) => route.fulfill({
      contentType: 'text/xml',
      body: options.captionBody,
    }))
  }
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
  const isBilibili = options.platform === 'bilibili'
  const videoUrl = isBilibili
    ? 'https://www.bilibili.com/video/BV1manual123?p=1'
    : 'https://www.youtube.com/watch?v=mock-video'
  const trackId = options.language === 'en' ? '.en' : '.zh-Hans'
  const contextResponse = isBilibili ? {
    success: true,
    bridgeVersion: 2,
    platform: 'bilibili',
    data: {
      bvid: 'BV1manual123',
      aid: 101,
      cid: 202,
      page: 1,
      title: options.title,
      author: 'E2E B站作者',
      durationMs: options.unreliableSubtitle ? 10_330_000 : 120_000,
      description: '',
    },
  } : {
    success: true,
    bridgeVersion: 2,
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
  const runtimeMessageListeners = new Set<MessageListener>()
  Object.defineProperty(runtime, 'onMessage', {
    configurable: true,
    value: {
      addListener: (listener: MessageListener) => runtimeMessageListeners.add(listener),
      removeListener: (listener: MessageListener) => runtimeMessageListeners.delete(listener),
    },
  })
  Object.defineProperty(runtime, 'sendMessage', {
    configurable: true,
    value: async (message: { type?: string; taskId?: string }) => {
      if (options.transcription && message.type === 'TRANSCRIPTION_START_REQUEST') {
        const taskId = message.taskId
        const emitRuntime = (event: unknown) => {
          for (const listener of runtimeMessageListeners) {
            listener({ type: 'TRANSCRIPTION_EVENT', event })
          }
        }
        setTimeout(() => emitRuntime({ type: 'started', taskId, metadata: contextResponse.data }), 0)
        setTimeout(() => emitRuntime({
          type: 'progress',
          taskId,
          recordedMs: 30_000,
          transcribedMs: 30_000,
          chunkIndex: 1,
          newCues: [{ id: 'asr-1', startMs: 0, endMs: 8_000, text: 'Direct audio transcript.' }],
        }), 80)
        setTimeout(() => emitRuntime({
          type: 'completed',
          taskId,
          recordedMs: 30_000,
          language: 'english',
          stoppedEarly: false,
          cues: [{ id: 'asr-1', startMs: 0, endMs: 8_000, text: 'Direct audio transcript.' }],
        }), 160)
        return { success: true, data: { taskId } }
      }
      return { success: true, data: { ok: true } }
    },
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
              && state.secondChunkRequests <= 4
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
