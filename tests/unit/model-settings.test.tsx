import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSettings } from '../../src/components/ModelSettings'
import type { ModelConfig } from '../../src/model/config-store'

const savedConfig: ModelConfig = {
  apiKey: 'sk-saved-secret-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  contextWindow: 128000,
}

function renderSettings(overrides = {}) {
  const props = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onTest: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    savedConfig: null as ModelConfig | null,
    isTesting: false,
    testError: null as string | null,
    ...overrides,
  }
  return { ...props, ...render(<ModelSettings {...props} />) }
}

describe('ModelSettings', () => {
  it('renders a masked API key input', () => {
    renderSettings()
    const keyInput = screen.getByLabelText('API Key')
    expect(keyInput).toHaveAttribute('type', 'password')
  })

  it('pre-fills fields from saved config', () => {
    renderSettings({ savedConfig })
    const baseUrlInput = screen.getByLabelText('Base URL') as HTMLInputElement
    const modelInput = screen.getByLabelText('模型名称') as HTMLInputElement
    expect(baseUrlInput.value).toBe('https://api.openai.com/v1')
    expect(modelInput.value).toBe('gpt-4o')
  })

  it('calls onSave when the save button is clicked', async () => {
    const { onSave } = renderSettings()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('API Key'), 'sk-new-key')
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1')
    await user.type(screen.getByLabelText('模型名称'), 'gpt-4o-mini')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith({
      apiKey: 'sk-new-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      contextWindow: 128000,
    })
  })

  it('calls onTest with form config when clicked', async () => {
    const { onTest } = renderSettings({ savedConfig })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(onTest).toHaveBeenCalledWith(savedConfig)
  })

  it('calls onDelete when the delete button is clicked', async () => {
    const { onDelete } = renderSettings({ savedConfig })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '删除配置' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('disables the test button while testing', () => {
    renderSettings({ savedConfig, isTesting: true })
    expect(screen.getByRole('button', { name: '测试中…' })).toBeDisabled()
  })

  it('shows test error when provided', () => {
    renderSettings({ savedConfig, testError: '连接超时' })
    expect(screen.getByText('连接超时')).toBeVisible()
  })

  it('disables test button when form is empty', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  })
})
