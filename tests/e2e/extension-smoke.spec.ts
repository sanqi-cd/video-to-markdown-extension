import { test, expect } from '@playwright/test'
import { chromium } from '@playwright/test'

test.describe('extension smoke test', () => {
  test('opens the side panel shell', async () => {
    const browser = await chromium.launch({
      args: [
        '--disable-extensions-except=.output/chrome-mv3',
        '--load-extension=.output/chrome-mv3',
      ],
    })

    const context = await browser.newContext()
    const page = await context.newPage()

    // Navigate to the fixture page (acts as YouTube)
    const fixtureUrl =
      'file://' + new URL('./fixtures/video-page.html', import.meta.url).pathname
    await page.goto(fixtureUrl)

    // Get the extension background worker
    const worker = context.serviceWorkers()[0]
    expect(worker).toBeDefined()

    // Open the side panel
    const extensionId = new URL(worker.url()).host
    const sidePanel = await context.newPage()
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`)

    // Verify the shell renders
    await expect(
      sidePanel.getByRole('heading', { name: 'Video to Markdown' }),
    ).toBeVisible()

    await browser.close()
  })
})
