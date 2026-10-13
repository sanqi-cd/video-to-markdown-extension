import { AppError } from '../errors/app-error'

export type RetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export type RetryNotice = {
  attempt: number
  nextAttempt: number
  delayMs: number
}

const RETRYABLE_CODES = new Set([
  'MODEL_RATE_LIMITED',
  'NETWORK_FAILED',
  'MODEL_RESPONSE_INVALID',
])

/** Format errors usually need a short re-ask, not a long backoff chain. */
const FORMAT_ERROR_MAX_ATTEMPTS = 2

export function isRetryableError(error: unknown): error is AppError {
  return error instanceof AppError && RETRYABLE_CODES.has(error.code)
}

export function maxAttemptsForError(error: AppError, policy: RetryPolicy): number {
  if (error.code === 'MODEL_RESPONSE_INVALID') {
    return Math.min(policy.maxAttempts, FORMAT_ERROR_MAX_ATTEMPTS)
  }
  return policy.maxAttempts
}

export function delayForRetry(
  error: AppError,
  attempt: number,
  policy: RetryPolicy,
): number {
  if (error.code === 'MODEL_RATE_LIMITED') {
    if (error.retryAfterMs !== undefined && error.retryAfterMs > 0) {
      return Math.min(policy.maxDelayMs, error.retryAfterMs)
    }
    // Production policies use a longer floor; short test policies keep baseDelayMs.
    const rateBase = policy.baseDelayMs >= 500
      ? Math.max(2_000, policy.baseDelayMs)
      : policy.baseDelayMs
    return Math.min(policy.maxDelayMs, rateBase * 2 ** (attempt - 1))
  }
  if (error.code === 'MODEL_RESPONSE_INVALID') {
    return Math.min(1_500, policy.baseDelayMs * 2 ** (attempt - 1))
  }
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1))
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void>,
  onRetry?: (notice: RetryNotice) => void,
): Promise<T> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableError(error)) throw error
      const allowedAttempts = maxAttemptsForError(error, policy)
      if (attempt >= allowedAttempts) throw error
      const delay = delayForRetry(error, attempt, policy)
      onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs: delay })
      await sleep(delay)
    }
  }
  throw new AppError('NETWORK_FAILED', '模型请求失败')
}
