import { describe, expect, it } from 'vitest'
import { parseSSEStream } from '../../src/model/sse-parser'

function byteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const events: string[] = []
  for await (const event of parseSSEStream(stream)) events.push(event)
  return events
}

describe('parseSSEStream', () => {
  it('parses events split across arbitrary chunks and multiple events in one chunk', async () => {
    const encoder = new TextEncoder()
    const chunks = [
      encoder.encode('data: {"choices":[{"del'),
      encoder.encode('ta":{"content":"A"}}]}\n\ndata: {"choices":[] }\n\n'),
      encoder.encode('data: [DONE]\n\n'),
    ]

    await expect(collect(byteStream(chunks))).resolves.toEqual([
      '{"choices":[{"delta":{"content":"A"}}]}',
      '{"choices":[] }',
      '[DONE]',
    ])
  })

  it('preserves UTF-8 characters split inside a multibyte sequence', async () => {
    const bytes = new TextEncoder().encode('data: 中文内容\n\n')
    const splitAt = bytes.indexOf(0xe6) + 1
    const events = await collect(byteStream([
      bytes.slice(0, splitAt),
      bytes.slice(splitAt),
    ]))

    expect(events).toEqual(['中文内容'])
  })

  it('joins multiple data lines and ignores comments and other fields', async () => {
    const body = ': heartbeat\nevent: message\ndata: first\ndata: second\n\n'
    const events = await collect(byteStream([new TextEncoder().encode(body)]))
    expect(events).toEqual(['first\nsecond'])
  })

  it('flushes the final event even when the stream has no trailing blank line', async () => {
    const events = await collect(byteStream([
      new TextEncoder().encode('data: final'),
    ]))
    expect(events).toEqual(['final'])
  })
})
