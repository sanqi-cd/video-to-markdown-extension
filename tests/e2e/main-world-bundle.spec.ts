import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const MAIN_WORLD_BUNDLES = [
  'youtube-main.js',
  'bilibili-main.js',
]

test('keeps MAIN world bundles compatible with page Trusted Types policies', async () => {
  for (const filename of MAIN_WORLD_BUNDLES) {
    const bundle = await readFile(
      path.resolve('.output/chrome-mv3/content-scripts', filename),
      'utf8',
    )

    expect(bundle, `${filename} must not bundle Zod runtime code`).not.toContain('__zod')
    expect(bundle, `${filename} must not evaluate dynamic scripts`).not.toMatch(/\bFunction\s*\(/)
  }
})
