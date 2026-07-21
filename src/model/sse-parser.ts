export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  const processLine = (line: string): string | null => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized === '') {
      if (dataLines.length === 0) return null
      const data = dataLines.join('\n')
      dataLines = []
      return data
    }
    if (normalized.startsWith(':')) return null
    if (normalized === 'data') {
      dataLines.push('')
      return null
    }
    if (normalized.startsWith('data:')) {
      const value = normalized.slice(5)
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value)
    }
    return null
  }

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const event = processLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (event !== null) yield event
        newline = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    if (buffer.length > 0) {
      const event = processLine(buffer)
      if (event !== null) yield event
    }
    if (dataLines.length > 0) yield dataLines.join('\n')
  } finally {
    reader.releaseLock()
  }
}
