import { describe, expect, it, vi } from 'vitest'
import {
  withRetry,
  delayForRetry,
  maxAttemptsForError,
  type RetryPolicy,
} from '../../src/model/retry'
import { AppError } from '../../src/errors/app-error'

const defaultPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 100,
}

describe('withRetry', () => {
  it('returns the result on first success', async () => {
    const op = vi.fn().mockResolvedValue('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await withRetry(op, defaultPolicy, sleep)
    expect(result).toBe('success')
    expect(op).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries on MODEL_RATE_LIMITED and succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new AppError('MODEL_RATE_LIMITED', '速率限制'))
      .mockResolvedValueOnce('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await withRetry(op, defaultPolicy, sleep)
    expect(result).toBe('success')
    expect(op).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('retries on NETWORK_FAILED and succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new AppError('NETWORK_FAILED', '网络错误'))
      .mockResolvedValueOnce('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await withRetry(op, defaultPolicy, sleep)
    expect(result).toBe('success')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('retries MODEL_RESPONSE_INVALID once then succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new AppError('MODEL_RESPONSE_INVALID', '格式异常'))
      .mockResolvedValueOnce('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(op, defaultPolicy, sleep)).resolves.toBe('success')
    expect(op).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('stops MODEL_RESPONSE_INVALID after two attempts', async () => {
    const op = vi.fn().mockRejectedValue(new AppError('MODEL_RESPONSE_INVALID', '格式异常'))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(op, defaultPolicy, sleep)).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    })
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-retryable errors', async () => {
    const op = vi.fn().mockRejectedValue(new AppError('MODEL_AUTH_FAILED', '认证失败'))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(op, defaultPolicy, sleep)).rejects.toMatchObject({
      code: 'MODEL_AUTH_FAILED',
    })
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('throws after maxAttempts retries', async () => {
    const op = vi.fn().mockRejectedValue(new AppError('MODEL_RATE_LIMITED', '限速'))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(withRetry(op, defaultPolicy, sleep)).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMITED',
    })
    expect(op).toHaveBeenCalledTimes(3)
  })

  it('uses exponential backoff with jitter', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new AppError('MODEL_RATE_LIMITED', '1'))
      .mockRejectedValueOnce(new AppError('NETWORK_FAILED', '2'))
      .mockResolvedValueOnce('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await withRetry(op, defaultPolicy, sleep)

    // First retry: baseDelayMs * 2^0 = 10ms
    expect(sleep.mock.calls[0]![0]).toBe(10)
    // Second retry: baseDelayMs * 2^1 = 20ms
    expect(sleep.mock.calls[1]![0]).toBe(20)
  })

  it('caps delay at maxDelayMs', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new AppError('MODEL_RATE_LIMITED', '1'))
      .mockResolvedValueOnce('success')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await withRetry(op, { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 100 }, sleep)

    expect(sleep.mock.calls[0]![0]).toBe(100)
  })

  it('honors Retry-After hints on rate limits', async () => {
    const error = new AppError('MODEL_RATE_LIMITED', '限速', { retryAfterMs: 7_500 })
    expect(delayForRetry(error, 1, {
      maxAttempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
    })).toBe(7_500)
  })

  it('uses a longer production floor for rate-limit backoff', () => {
    const error = new AppError('MODEL_RATE_LIMITED', '限速')
    expect(delayForRetry(error, 1, {
      maxAttempts: 4,
      baseDelayMs: 500,
      maxDelayMs: 30_000,
    })).toBe(2_000)
    expect(maxAttemptsForError(
      new AppError('MODEL_RESPONSE_INVALID', 'bad'),
      { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 30_000 },
    )).toBe(2)
  })
})
