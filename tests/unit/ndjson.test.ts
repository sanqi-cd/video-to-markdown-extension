import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NDJSONBuffer, parseNDJSON } from '../../src/processors/ndjson'

const ItemSchema = z.object({ type: z.literal('item'), text: z.string() })

describe('NDJSONBuffer', () => {
  it('保留被分片截断的尾行，并在完整后提交', () => {
    const parser = new NDJSONBuffer(ItemSchema)

    expect(parser.push('{"type":"item","te')).toEqual({
      records: [],
      fallback: false,
    })
    expect(parser.push('xt":"第一段"}\n')).toEqual({
      records: [{ type: 'item', text: '第一段' }],
      fallback: false,
    })
  })

  it('一次分片可以提交多行完整记录，并忽略空行', () => {
    const parser = new NDJSONBuffer(ItemSchema)
    const result = parser.push([
      '{"type":"item","text":"一"}',
      '',
      '{"type":"item","text":"二"}',
      '',
    ].join('\n'))

    expect(result).toEqual({
      records: [
        { type: 'item', text: '一' },
        { type: 'item', text: '二' },
      ],
      fallback: false,
    })
  })

  it('首行不符合流协议时切换到完整 JSON 降级模式', () => {
    const parser = new NDJSONBuffer(ItemSchema)
    const result = parser.push('{\n  "items": []\n}\n')

    expect(result.records).toEqual([])
    expect(result.fallback).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('已进入 NDJSON 模式后拒绝损坏的后续行', () => {
    const parser = new NDJSONBuffer(ItemSchema)
    parser.push('{"type":"item","text":"合法"}\n')
    const result = parser.push('not-json\n')

    expect(result.fallback).toBe(false)
    expect(result.error?.message).toBe('NDJSON 行不是有效 JSON')
  })
})

describe('parseNDJSON', () => {
  it('解析完整 NDJSON，并拒绝不符合 Schema 的行', () => {
    expect(parseNDJSON(
      '{"type":"item","text":"一"}\n{"type":"item","text":"二"}',
      ItemSchema,
    )).toHaveLength(2)

    expect(() => parseNDJSON('{"type":"other","text":"错误"}', ItemSchema))
      .toThrow('NDJSON 行不符合协议')
  })
})
