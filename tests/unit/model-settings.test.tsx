import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSettings } from '../../src/components/ModelSettings'
import { ModelTestView } from '../../src/components/ModelTestView'
import type { ModelConfig } from '../../src/model/config-store'

const savedConfig: ModelConfig = {
  version: 2,
  providerId: 'openai',
  apiKey: 'sk-saved-secret-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
  streamMode: 'auto',
}

function renderSettings(overrides = {}) {
  const props = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onSaveAndTest: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    savedConfig: null as ModelConfig | null,
    preferredProviderId: 'deepseek' as const,
    formError: null as string | null,
    ...overrides,
  }
  return { ...props, ...render(<ModelSettings {...props} />) }
}

describe('ModelSettings', () => {
  it('renders four provider presets and a masked API key', () => {
    renderSettings()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByLabelText('DeepSeek')).toBeChecked()
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password')
  })

  it('pre-fills fields and provider from saved V2 config', () => {
    renderSettings({ savedConfig })
    expect(screen.getByLabelText('OpenAI')).toBeChecked()
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1')
    expect(screen.getByLabelText('模型名称')).toHaveValue('gpt-4o')
  })

  it('updates endpoint defaults when provider changes without clearing the API key', async () => {
    const user = userEvent.setup()
    renderSettings({ savedConfig })
    const keyInput = screen.getByLabelText('API Key')

    await user.click(screen.getByLabelText('DeepSeek'))
    expect(keyInput).toHaveValue('sk-saved-secret-key')
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com')
    expect(screen.getByLabelText('模型名称')).toHaveValue('deepseek-chat')
  })

  it('calls onSave with a V2 config when only saving', async () => {
    const { onSave } = renderSettings({ savedConfig })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '仅保存' }))

    expect(onSave).toHaveBeenCalledWith(savedConfig)
  })

  it('calls onSaveAndTest from the primary action', async () => {
    const { onSaveAndTest } = renderSettings({ savedConfig })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存并测试' }))
    expect(onSaveAndTest).toHaveBeenCalledWith(savedConfig)
  })

  it('keeps form values when save-and-test fails', async () => {
    const user = userEvent.setup()
    renderSettings({
      savedConfig,
      onSaveAndTest: vi.fn().mockRejectedValue(new Error('连接失败')),
    })
    await user.clear(screen.getByLabelText('模型名称'))
    await user.type(screen.getByLabelText('模型名称'), 'custom-model')
    await user.click(screen.getByRole('button', { name: '保存并测试' }))
    expect(screen.getByLabelText('模型名称')).toHaveValue('custom-model')
  })

  it('shows parent validation errors and supports deletion', async () => {
    const { onDelete } = renderSettings({ savedConfig, formError: 'Base URL 格式无效' })
    const user = userEvent.setup()
    expect(screen.getByRole('alert')).toHaveTextContent('Base URL 格式无效')
    await user.click(screen.getByRole('button', { name: '删除配置' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('disables actions while the API key is empty', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: '保存并测试' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '仅保存' })).toBeDisabled()
  })

  it('renders at most one primary action', () => {
    const { container } = renderSettings({ savedConfig })
    expect(container.querySelectorAll('.button--primary')).toHaveLength(1)
  })
})

describe('ModelTestView', () => {
  const props = {
    providerId: 'deepseek' as const,
    baseUrl: 'https://api.deepseek.com',
    onBackToSettings: vi.fn(),
    onContinue: vi.fn(),
  }

  it('renders testing, success and failed as mutually exclusive states', () => {
    const { rerender } = render(
      <ModelTestView {...props} state={{ status: 'testing', startedAt: Date.now() }} />,
    )
    expect(screen.getByText('测试中')).toBeVisible()
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument()
    expect(screen.queryByText('连接失败')).not.toBeInTheDocument()

    rerender(<ModelTestView {...props} state={{ status: 'success', latencyMs: 320 }} />)
    expect(screen.getByText('连接成功')).toBeVisible()
    expect(screen.queryByText('测试中')).not.toBeInTheDocument()
    expect(screen.queryByText('连接失败')).not.toBeInTheDocument()

    rerender(
      <ModelTestView
        {...props}
        state={{
          status: 'failed',
          error: { code: 'MODEL_AUTH_FAILED', message: '认证失败' },
        }}
      />,
    )
    expect(screen.getByText('连接失败')).toBeVisible()
    expect(screen.queryByText('测试中')).not.toBeInTheDocument()
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument()
  })

  it('shows provider domain and successful latency', () => {
    render(<ModelTestView {...props} state={{ status: 'success', latencyMs: 280 }} />)
    expect(screen.getByText(/api\.deepseek\.com/)).toBeVisible()
    expect(screen.getByText(/280ms/)).toBeVisible()
  })
})
