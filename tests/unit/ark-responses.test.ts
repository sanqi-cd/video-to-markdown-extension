import { describe, expect, it, vi } from 'vitest'
import { buildArkAudioRequest, encodeMonoWav, parseArkAudioResponse } from '../../src/transcription/ark-responses'
import { normalizeTranscriptionConfig } from '../../src/transcription/config-store'
import { transcribeAudioChunk } from '../../src/transcription/provider'

const config = normalizeTranscriptionConfig({ version: 1, protocol: 'ark-responses',
  endpoint: 'https://ark.cn-beijing.volces.com/api/v3/responses', apiKey: 'test-only',
  model: 'doubao-seed-2-0-lite-260428', language: 'auto', chunkSeconds: 30 })
const response = (text: string) => ({ status: 'completed', output: [
  { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'not transcript' }] },
  { type: 'message', content: [{ type: 'output_text', text }] },
] })

describe('Ark audio protocol', () => {
  it('sends WAV JSON through the provider and parses the transcription', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', class {
      close = close
      decodeAudioData = vi.fn().mockResolvedValue({ numberOfChannels: 1, sampleRate: 16000,
        getChannelData: () => new Float32Array([0, 0.5, -0.5]) })
    })
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(response('{"text":"音频测试"}'))))
      const blob = { arrayBuffer: async () => new ArrayBuffer(1) } as Blob
      const result = await transcribeAudioChunk(blob, config, 30000, fetchImpl)
      expect(result.text).toBe('音频测试')
      const init = fetchImpl.mock.calls[0]![1] as RequestInit
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer test-only' })
      const body = JSON.parse(init.body as string)
      expect(body.input[0].content[0].audio_url).toMatch(/^data:audio\/wav;base64,UklGR/u)
      expect(body.store).toBe(false)
      expect(close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
  it('persists explicit protocol and does not place credentials in JSON', () => {
    expect(config.protocol).toBe('ark-responses')
    const request = buildArkAudioRequest(config, 'data:audio/wav;base64,AAAA')
    expect(request.store).toBe(false)
    expect(request.input[0]?.content[0]).toEqual({ type: 'input_audio', audio_url: 'data:audio/wav;base64,AAAA' })
    expect(JSON.stringify(request)).not.toContain('test-only')
  })
  it('uses measured chunk boundaries and excludes reasoning', () => {
    expect(parseArkAudioResponse(response('{"text":"Hello"}'), 30000)).toEqual({
      text: 'Hello', segments: [{ startMs: 0, endMs: 30000, text: 'Hello' }],
    })
  })
  it('accepts explicit silence but rejects missing or truncated responses', () => {
    expect(parseArkAudioResponse(response('{"text":""}'), 30000).segments).toEqual([])
    expect(() => parseArkAudioResponse(response('{}'), 30000)).toThrow('缺少')
    expect(() => parseArkAudioResponse(response('Hello'), 30000)).toThrow('JSON')
    expect(() => parseArkAudioResponse({ ...response('{"text":"Hello"}'), status: 'incomplete' }, 30000)).toThrow('未完成')
  })
  it('encodes mono PCM16 WAV and mixes channels', () => {
    const wav = encodeMonoWav([new Float32Array([-1, 1, 0]), new Float32Array([-1, 1, 0])], 16000)
    const view = new DataView(wav)
    expect(wav.byteLength).toBe(50)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(0)
    expect(() => encodeMonoWav([], 16000)).toThrow()
  })
  it('closes decoder resources after decoding failure', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', class {
      close = close
      decodeAudioData = vi.fn().mockRejectedValue(new Error('invalid audio'))
    })
    try {
      const { audioToWavDataUrl } = await import('../../src/transcription/ark-responses')
      await expect(audioToWavDataUrl({ arrayBuffer: async () => new ArrayBuffer(1) } as Blob)).rejects.toThrow('invalid audio')
      expect(close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})
