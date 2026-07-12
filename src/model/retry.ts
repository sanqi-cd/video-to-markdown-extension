import { AppError } from '../errors/app-error'

export type RetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

const RETRYABLE_CODES = new Set(['MODEL_RATE_LIMITED', 'NETWORK_FAILED'])

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const retryable =
        error instanceof AppError && RETRYABLE_CODES.has(error.code)
      if (!retryable || attempt === policy.maxAttempts) {
        throw error
      }
      const delay = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * 2 ** (attempt - 1),
      )
      await sleep(delay)
    }
  }
  throw new AppError('NETWORK_FAILED', '模型请求失败')
}
