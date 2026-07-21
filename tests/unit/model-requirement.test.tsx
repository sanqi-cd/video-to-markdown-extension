import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { requiresModel } from '../../src/core/product-state'
import { ModeSelector } from '../../src/components/ModeSelector'
import { inferProviderId, PROVIDER_PRESETS } from '../../src/model/provider-presets'

describe('model requirement', () => {
  it('does not require a model for Chinese high-fidelity', () => {
    expect(requiresModel('high-fidelity', 'zh-Hans', 'zh')).toBe(false)
  })

  it('requires a model for cross-language high-fidelity and every refined task', () => {
    expect(requiresModel('high-fidelity', 'en', 'en')).toBe(false)
    expect(requiresModel('high-fidelity', 'en', 'zh')).toBe(true)
    expect(requiresModel('refined', 'zh-CN', 'zh')).toBe(true)
  })

  it('shows one model status at group level and marks local modes', () => {
    render(
      <ModeSelector
        value="high-fidelity"
        sourceLanguage="zh-CN"
        outputLanguage="zh"
        modelStatus="missing"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('无需模型')).toBeVisible()
    expect(screen.getByText('模型未配置')).toBeVisible()
  })

  it('shows a tested model as connected for model-dependent modes', () => {
    render(
      <ModeSelector
        value="refined"
        sourceLanguage="en"
        outputLanguage="zh"
        modelStatus="connected"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('模型已连接')).toBeVisible()
    expect(screen.queryByText('无需模型')).not.toBeInTheDocument()
  })
})

describe('provider presets', () => {
  it('includes DeepSeek, OpenAI, OpenRouter and custom providers', () => {
    expect(PROVIDER_PRESETS.map((provider) => provider.id)).toEqual([
      'deepseek', 'openai', 'openrouter', 'custom',
    ])
  })

  it('infers known providers during V1 migration', () => {
    expect(inferProviderId('https://api.deepseek.com')).toBe('deepseek')
    expect(inferProviderId('https://api.openai.com/v1')).toBe('openai')
    expect(inferProviderId('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(inferProviderId('https://models.example.com/v1')).toBe('custom')
  })
})
