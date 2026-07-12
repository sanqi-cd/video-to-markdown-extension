export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'NO_SUBTITLE'
  | 'SUBTITLE_EXTRACTION_FAILED'
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

type AppErrorOptions = {
  cause?: unknown
}

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
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
