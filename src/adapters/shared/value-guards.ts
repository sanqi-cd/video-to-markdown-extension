export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

export function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
}
