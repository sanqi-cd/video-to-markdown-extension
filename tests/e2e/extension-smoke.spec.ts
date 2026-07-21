import { test, expect, chromium } from '@playwright/test'
import path from 'node:path'

test('loads the built extension and renders its side panel', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
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

  try {
    let [worker] = context.serviceWorkers()
    worker ??= await context.waitForEvent('serviceworker')
    const extensionId = new URL(worker.url()).host
    const sidePanel = await context.newPage()
    await sidePanel.addInitScript(() => {
      const state = globalThis as typeof globalThis & {
        __v2mdClipboard?: string
        __v2mdDownload?: { filename?: string }
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            state.__v2mdClipboard = text
          },
        },
      })
      Object.defineProperty(chrome.downloads, 'download', {
        configurable: true,
        value: (options: { filename?: string }, callback?: () => void) => {
          state.__v2mdDownload = options
          callback?.()
        },
      })
    })
    await sidePanel.setViewportSize({ width: 380, height: 760 })
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`)

    await expect(sidePanel.getByRole('heading', { name: 'Video to Markdown' })).toBeVisible()
    await expect(sidePanel.getByRole('button', { name: '模型设置' })).toBeVisible()
    expect(await hasHorizontalOverflow(sidePanel)).toBe(false)

    await sidePanel.setViewportSize({ width: 320, height: 760 })
    expect(await hasHorizontalOverflow(sidePanel)).toBe(false)
    await sidePanel.setViewportSize({ width: 600, height: 760 })
    expect(await hasHorizontalOverflow(sidePanel)).toBe(false)
    expect((await sidePanel.locator('.app-shell__content > *').first().boundingBox())?.width)
      .toBeLessThanOrEqual(520)
    await sidePanel.setViewportSize({ width: 380, height: 760 })

    await context.route('https://www.youtube.com/watch**', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>E2E 视频</title></head><body><video></video></body></html>',
    }))
    await context.route('https://www.youtube.com/youtubei/v1/player**', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: 'https://www.youtube.com/api/timedtext?v=e2e-video&lang=zh-Hans&fmt=srv3',
              languageCode: 'zh-Hans',
              vssId: '.zh-Hans',
            }],
          },
        },
      }),
    }))
    await context.route('https://www.youtube.com/api/timedtext**', (route) => route.fulfill({
      contentType: 'text/xml',
      body: [
        '<transcript>',
        '<text start="0" dur="1">第一段字幕。</text>',
        '<text start="1.2" dur="1">第二段字幕。</text>',
        '</transcript>',
      ].join(''),
    }))
    const videoPage = await context.newPage()
    await videoPage.addInitScript((playerResponse) => {
      ;(window as Window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse = playerResponse
      ;(window as Window & { ytcfg?: unknown }).ytcfg = {
        get: (key: string) => key === 'INNERTUBE_API_KEY' ? 'e2e-api-key' : undefined,
      }
    }, {
      videoDetails: {
        videoId: 'e2e-video',
        title: 'E2E 视频',
        author: '测试频道',
        lengthSeconds: '120',
      },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: 'https://www.youtube.com/api/timedtext?v=e2e-video&lang=zh-Hans',
            languageCode: 'zh-Hans',
            name: { simpleText: '中文（简体）' },
            vssId: '.zh-Hans',
          }],
        },
      },
    })
    await videoPage.goto('https://www.youtube.com/watch?v=e2e-video')

    await sidePanel.reload()

    await expect(sidePanel.getByRole('heading', { name: 'E2E 视频' })).toBeVisible()
    expect(await hasHorizontalOverflow(sidePanel)).toBe(false)
    expect(await sidePanel.locator('.button--primary').count()).toBeLessThanOrEqual(1)
    const startButton = sidePanel.getByRole('button', { name: '开始生成' })
    await startButton.focus()
    await startButton.press('Enter')
    const readingPreview = sidePanel.getByRole('article', { name: '阅读预览' })
    await expect(readingPreview).toContainText('第一段字幕。')
    await expect(readingPreview).toContainText('第二段字幕。')
    const previewTab = sidePanel.getByRole('tab', { name: '阅读预览' })
    await previewTab.focus()
    await previewTab.press('ArrowRight')
    await expect(sidePanel.getByRole('tab', { name: 'Markdown 源码' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const markdownSource = sidePanel.locator('pre.markdown-source')
    await expect(markdownSource).toContainText('第一段字幕。')
    await expect(markdownSource).toContainText('第二段字幕。')

    const copyButton = sidePanel.getByRole('button', { name: '复制 Markdown' })
    await copyButton.focus()
    await copyButton.press('Enter')
    await expect(sidePanel.getByRole('button', { name: '已复制 Markdown' })).toBeVisible()
    expect(await sidePanel.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdClipboard?: string }
    ).__v2mdClipboard)).toContain('第一段字幕。')

    const downloadButton = sidePanel.getByRole('button', { name: '下载 .md' })
    await downloadButton.focus()
    await downloadButton.press('Enter')
    expect(await sidePanel.evaluate(() => (
      globalThis as typeof globalThis & { __v2mdDownload?: { filename?: string } }
    ).__v2mdDownload?.filename)).toBe('E2E 视频.md')

    for (const width of [320, 380, 600]) {
      await sidePanel.setViewportSize({ width, height: 760 })
      expect(await hasHorizontalOverflow(sidePanel)).toBe(false)
    }
    expect((await sidePanel.locator('.result-view').boundingBox())?.width).toBeLessThanOrEqual(520)
    expect(await sidePanel.locator('.button--primary').count()).toBeLessThanOrEqual(1)
  } finally {
    await context.close()
  }
})

async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ))
}
