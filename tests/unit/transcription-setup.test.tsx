import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranscriptionSetup } from '../../src/components/TranscriptionSetup'
import {
  ARK_TRANSCRIPTION_ENDPOINT,
  ARK_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSCRIPTION_ENDPOINT,
} from '../../src/transcription/config-store'
import type { TranscriptionConfig, TranscriptionUiState } from '../../src/transcription/contracts'

const savedConfig: TranscriptionConfig = {
  version: 1,
  protocol: 'openai-transcription',
  endpoint: 'https://speech.example.com/v1/audio/transcriptions',
  apiKey: 'sk-test',
  model: 'whisper-1',
  language: 'zh',
  chunkSeconds: 60,
}

function renderSetup(
  overrides: Partial<Parameters<typeof TranscriptionSetup>[0]> = {},
) {
  const props = {
    config: null,
    state: { status: 'idle' } as TranscriptionUiState,
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onStart: vi.fn().mockResolvedValue(undefined),
    onStop: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  render(<TranscriptionSetup {...props} />)
  return { ...props, user: userEvent.setup() }
}

describe('TranscriptionSetup', () => {
  it('saves the trimmed form and then starts', async () => {
    const s = renderSetup()
    expect(screen.getByText('语音识别未配置')).toBeVisible()
    const submit = screen.getByRole('button', { name: '保存配置并开始转录' })
    expect(submit).toBeDisabled()

    await s.user.type(screen.getByLabelText('API Key'), '  sk-new  ')
    await s.user.selectOptions(screen.getByLabelText('音频语言'), 'en')
    await s.user.selectOptions(screen.getByLabelText('分段时长'), '90')
    await s.user.click(submit)

    expect(s.onSave).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: DEFAULT_TRANSCRIPTION_ENDPOINT,
      apiKey: 'sk-new',
      language: 'en',
      chunkSeconds: 90,
    }))
    expect(s.onStart).toHaveBeenCalledOnce()
  })

  it('shows save or start failures in the form', async () => {
    const s = renderSetup({ onSave: vi.fn().mockRejectedValue(new Error('需要授权')) })
    await s.user.type(screen.getByLabelText('API Key'), 'sk')
    await s.user.click(screen.getByRole('button', { name: '保存配置并开始转录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('需要授权')
    expect(s.onStart).not.toHaveBeenCalled()
  })

  it('switching protocol resets endpoint, model and the API key', async () => {
    const s = renderSetup({ config: savedConfig })
    await s.user.click(screen.getByText('修改语音识别服务'))
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-test')

    await s.user.selectOptions(screen.getByLabelText('接口类型'), 'ark-responses')
    expect(screen.getByLabelText('转写接口')).toHaveValue(ARK_TRANSCRIPTION_ENDPOINT)
    expect(screen.getByLabelText('转写模型')).toHaveValue(ARK_TRANSCRIPTION_MODEL)
    expect(screen.getByLabelText('API Key')).toHaveValue('')

    await s.user.selectOptions(screen.getByLabelText('接口类型'), 'openai-transcription')
    expect(screen.getByLabelText('转写接口')).toHaveValue(DEFAULT_TRANSCRIPTION_ENDPOINT)
  })

  it('starts with an existing config and reports start errors', async () => {
    const s = renderSetup({
      config: savedConfig,
      onStart: vi.fn().mockRejectedValue('not an error'),
    })
    expect(screen.getByText('语音识别已配置 · 待实际转写验证')).toBeVisible()
    await s.user.click(screen.getByRole('button', { name: '开始直接转录' }))
    expect(s.onStart).toHaveBeenCalledOnce()
    await s.user.click(screen.getByText('修改语音识别服务'))
    expect(await screen.findByText('语音转写启动失败')).toBeVisible()
  })

  it('deletes the config and clears the key', async () => {
    const s = renderSetup({ config: savedConfig })
    await s.user.click(screen.getByText('修改语音识别服务'))
    await s.user.click(screen.getByRole('button', { name: '删除语音转写配置' }))
    expect(s.onDelete).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('API Key')).toHaveValue('')
  })

  it('reports a delete failure', async () => {
    const s = renderSetup({ config: savedConfig, onDelete: vi.fn().mockRejectedValue(new Error('存储不可用')) })
    await s.user.click(screen.getByText('修改语音识别服务'))
    await s.user.click(screen.getByRole('button', { name: '删除语音转写配置' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('存储不可用')
  })

  it('shows live progress with the latest cues and allows stopping', async () => {
    const s = renderSetup({
      config: savedConfig,
      state: {
        status: 'running',
        taskId: 't',
        recordedMs: 125_000,
        transcribedMs: 61_000,
        chunkIndex: 2,
        cues: [
          { id: '1', startMs: 0, endMs: 1, text: '第一句' },
          { id: '2', startMs: 1, endMs: 2, text: '第二句' },
          { id: '3', startMs: 2, endMs: 3, text: '第三句' },
        ],
      },
    })
    expect(screen.getByText('正在转写第 3 段')).toBeVisible()
    expect(screen.getByText('已录制 02:05 · 已识别 01:01')).toBeVisible()
    expect(screen.getByText('第二句 第三句')).toBeVisible()
    expect(screen.queryByText('修改语音识别服务')).not.toBeInTheDocument()
    await s.user.click(screen.getByRole('button', { name: '停止并保留已识别内容' }))
    expect(s.onStop).toHaveBeenCalledOnce()
  })

  it('shows a placeholder before the first chunk is recognised', () => {
    renderSetup({
      state: { status: 'running', taskId: 't', recordedMs: 0, transcribedMs: 0, chunkIndex: 0, cues: [] },
    })
    expect(screen.getByText('正在采集首段音频…')).toBeVisible()
  })

  it('shows the starting notice', () => {
    renderSetup({ state: { status: 'starting' } })
    expect(screen.getByText(/正在连接标签页音频/)).toBeVisible()
  })

  it('shows failures with the number of preserved cues', () => {
    renderSetup({
      config: savedConfig,
      state: {
        status: 'failed',
        error: { code: 'TRANSCRIPTION_FAILED', message: '网络中断' },
        cues: [{ id: '1', startMs: 0, endMs: 1, text: 'x' }],
      },
    })
    expect(screen.getByText('网络中断')).toBeVisible()
    expect(screen.getByText('已识别的 1 段文字仍保留在当前页面。')).toBeVisible()
  })
})
