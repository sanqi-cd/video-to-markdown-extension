import { describe, expect, it } from 'vitest'
import { isTrustedExtensionSender } from '../../src/browser/extension-origin'

const runtime = {
  id: 'abcdefghijklmnop',
  getURL: (path: string) => `chrome-extension://abcdefghijklmnop/${path}`,
}

describe('isTrustedExtensionSender', () => {
  it('accepts a side panel URL under the extension origin', () => {
    expect(isTrustedExtensionSender(
      { url: 'chrome-extension://abcdefghijklmnop/sidepanel.html' },
      runtime,
    )).toBe(true)
  })

  it('accepts a sender that only has the extension id (Chrome Port.sender.url gap)', () => {
    expect(isTrustedExtensionSender({ id: 'abcdefghijklmnop' }, runtime)).toBe(true)
  })

  it('accepts an empty Side Panel Port.sender', () => {
    expect(isTrustedExtensionSender({}, runtime)).toBe(true)
  })

  it('rejects a content-script sender even when it carries the extension id', () => {
    expect(isTrustedExtensionSender(
      {
        id: 'abcdefghijklmnop',
        url: 'https://www.bilibili.com/video/BV1s43E6oEhe',
      },
      runtime,
    )).toBe(false)
  })

  it('rejects a content-script sender from the video page', () => {
    expect(isTrustedExtensionSender(
      { url: 'https://www.bilibili.com/video/BV1s43E6oEhe' },
      runtime,
    )).toBe(false)
  })
})
