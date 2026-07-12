import { describe, expect, it } from 'vitest'
import { AppError, redactSecrets } from '../../src/errors/app-error'

describe('AppError', () => {
  it('redacts bearer tokens and configured secrets', () => {
    expect(redactSecrets('Bearer sk-secret failed', ['sk-secret'])).toBe(
      'Bearer [REDACTED] failed',
    )
  })

  it('exposes a stable error code without a secret cause', () => {
    const error = new AppError('MODEL_AUTH_FAILED', '认证失败', { cause: 'sk-secret' })
    expect(error.toJSON(['sk-secret'])).toEqual({
      code: 'MODEL_AUTH_FAILED',
      message: '认证失败',
    })
  })
})
