import { describe, expect, it } from 'vitest'
import { parseExtensionMessage } from '../../src/core/messages'

describe('runtime boundaries', () => {
  it('rejects an unknown extension message', () => {
    expect(() =>
      parseExtensionMessage({ type: 'FETCH_ANY_URL', url: 'https://evil.test' }),
    ).toThrow()
  })
})
