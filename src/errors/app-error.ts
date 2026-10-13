export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'ACTIVE_TAB_UNAVAILABLE'
  | 'CONTENT_SCRIPT_UNAVAILABLE'
  | 'PAGE_CONTEXT_INVALID'
  | 'TAB_RELOAD_TIMEOUT'
  | 'NO_SUBTITLE'
  | 'SUBTITLE_UNRELIABLE'
  | 'SUBTITLE_EXTRACTION_FAILED'
  | 'INVALID_TRANSCRIPTION_CONFIG'
  | 'TRANSCRIPTION_CAPTURE_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'INVALID_MODEL_CONFIG'
  | 'MODEL_AUTH_FAILED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_CONTEXT_EXCEEDED'
  | 'MODEL_RESPONSE_INVALID'
  | 'NETWORK_FAILED'
  | 'TASK_CANCELLED'

export type PublicAppError = {
  code: ErrorCode
  message: string
}

const ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  'UNSUPPORTED_PAGE',
  'ACTIVE_TAB_UNAVAILABLE',
  'CONTENT_SCRIPT_UNAVAILABLE',
  'PAGE_CONTEXT_INVALID',
  'TAB_RELOAD_TIMEOUT',
  'NO_SUBTITLE',
  'SUBTITLE_UNRELIABLE',
  'SUBTITLE_EXTRACTION_FAILED',
  'INVALID_TRANSCRIPTION_CONFIG',
  'TRANSCRIPTION_CAPTURE_FAILED',
  'TRANSCRIPTION_FAILED',
  'INVALID_MODEL_CONFIG',
  'MODEL_AUTH_FAILED',
  'MODEL_RATE_LIMITED',
  'MODEL_CONTEXT_EXCEEDED',
  'MODEL_RESPONSE_INVALID',
  'NETWORK_FAILED',
  'TASK_CANCELLED',
])

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as ErrorCode)
}

type AppErrorOptions = {
  cause?: unknown
  /** Hint for callers that can wait before retrying (e.g. HTTP Retry-After). */
  retryAfterMs?: number
  /** Transient failure (network, timeout, 429, 5xx) that a caller may retry. */
  retryable?: boolean
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryAfterMs?: number
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.retryAfterMs = options?.retryAfterMs
    this.retryable = options?.retryable ?? false
  }

  toJSON(secrets: string[] = []): PublicAppError {
    return {
      code: this.code,
      message: redactSecrets(this.message, secrets),
    }
  }
}

export function redactSecrets(text: string, secrets: string[]): string {
  let result = text
  for (const secret of secrets) {
    if (secret.length === 0) continue
    result = result.replaceAll(secret, '[REDACTED]')
  }
  return result
}
