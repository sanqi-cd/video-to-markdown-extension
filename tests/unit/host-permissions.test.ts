import { describe, expect, it, vi } from 'vitest'
import { requestModelOrigin } from '../../src/model/host-permissions'

describe('requestModelOrigin', () => {
  it('requests only the configured origin', async () => {
    const request = vi.fn().mockResolvedValue(true)
    await requestModelOrigin('https://api.example.com/v1', request)
    expect(request).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    })
  })

  it('derives the origin pattern from a base URL with path', async () => {
    const request = vi.fn().mockResolvedValue(true)
    await requestModelOrigin('https://models.company.com/api/chat', request)
    expect(request).toHaveBeenCalledWith({
      origins: ['https://models.company.com/*'],
    })
  })
})
