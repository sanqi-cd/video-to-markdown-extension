import { z } from 'zod'

export type NDJSONResult<T> = {
  records: T[]
  fallback: boolean
  error?: Error
}

export class NDJSONBuffer<T> {
  private buffer = ''
  private mode: 'pending' | 'ndjson' | 'fallback' = 'pending'
  private error: Error | undefined
  private readonly schema: z.ZodType<T>

  constructor(schema: z.ZodType<T>) {
    this.schema = schema
  }

  push(chunk: string): NDJSONResult<T> {
    if (this.mode === 'fallback' || this.error) return this.result([])
    this.buffer += chunk
    const records: T[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.consumeLine(line, records)
      if (this.shouldStop()) break
      newline = this.buffer.indexOf('\n')
    }
    return this.result(records)
  }

  finish(): NDJSONResult<T> {
    if (this.mode === 'fallback' || this.error) return this.result([])
    const records: T[] = []
    const line = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    if (line.trim().length > 0) this.consumeLine(line, records)
    return this.result(records)
  }

  private consumeLine(line: string, records: T[]): void {
    if (line.trim().length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      if (this.mode === 'pending') this.mode = 'fallback'
      else this.error = new Error('NDJSON 行不是有效 JSON')
      return
    }

    const result = this.schema.safeParse(parsed)
    if (!result.success) {
      if (this.mode === 'pending') this.mode = 'fallback'
      else this.error = new Error('NDJSON 行不符合协议')
      return
    }
    this.mode = 'ndjson'
    records.push(result.data)
  }

  private result(records: T[]): NDJSONResult<T> {
    return {
      records,
      fallback: this.mode === 'fallback',
      ...(this.error ? { error: this.error } : {}),
    }
  }

  private shouldStop(): boolean {
    return this.mode === 'fallback' || this.error !== undefined
  }
}

export function parseNDJSON<T>(content: string, schema: z.ZodType<T>): T[] {
  const records: T[] = []
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error('NDJSON 行不是有效 JSON')
    }
    const result = schema.safeParse(parsed)
    if (!result.success) throw new Error('NDJSON 行不符合协议')
    records.push(result.data)
  }
  if (records.length === 0) throw new Error('NDJSON 没有可用记录')
  return records
}
