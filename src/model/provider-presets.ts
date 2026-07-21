export type ProviderId = 'deepseek' | 'openai' | 'openrouter' | 'custom'

export type ProviderPreset = {
  id: ProviderId
  name: string
  description: string
  baseUrl: string
  model: string
  contextWindow: number
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '国内访问友好',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    contextWindow: 64_000,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI 官方接口',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    contextWindow: 128_000,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '聚合多种模型',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    contextWindow: 128_000,
  },
  {
    id: 'custom',
    name: '自定义',
    description: 'OpenAI 兼容接口',
    baseUrl: '',
    model: '',
    contextWindow: 128_000,
  },
] as const

export function getProviderPreset(providerId: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === providerId)!
}

export function inferProviderId(baseUrl: string): ProviderId {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    if (hostname === 'api.deepseek.com') return 'deepseek'
    if (hostname === 'api.openai.com') return 'openai'
    if (hostname === 'openrouter.ai') return 'openrouter'
  } catch {
    // Invalid values are validated by the config store.
  }
  return 'custom'
}
