import { useState } from 'react'
import type { ModelConfig } from '../model/config-store'
import {
  getProviderPreset,
  PROVIDER_PRESETS,
  type ProviderId,
} from '../model/provider-presets'
import { Button } from './ui/Button'
import { SettingRow } from './ui/SettingRow'

interface ModelSettingsProps {
  onSave: (config: ModelConfig) => Promise<void>
  onSaveAndTest: (config: ModelConfig) => Promise<void>
  onDelete: () => Promise<void>
  onProviderChange?: (providerId: ProviderId) => void
  savedConfig: ModelConfig | null
  preferredProviderId?: ProviderId
  formError?: string | null
}

export function ModelSettings({
  onSave,
  onSaveAndTest,
  onDelete,
  onProviderChange,
  savedConfig,
  preferredProviderId = 'deepseek',
  formError,
}: ModelSettingsProps) {
  const initialProviderId = savedConfig?.providerId ?? preferredProviderId
  const initialPreset = getProviderPreset(initialProviderId)
  const [providerId, setProviderId] = useState<ProviderId>(initialProviderId)
  const [apiKey, setApiKey] = useState(savedConfig?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(savedConfig?.baseUrl ?? initialPreset.baseUrl)
  const [model, setModel] = useState(savedConfig?.model ?? initialPreset.model)
  const [contextWindow, setContextWindow] = useState(
    savedConfig?.contextWindow ?? initialPreset.contextWindow,
  )
  const [streamMode, setStreamMode] = useState<ModelConfig['streamMode']>(
    savedConfig?.streamMode ?? 'auto',
  )
  const [submitting, setSubmitting] = useState<'save' | 'test' | null>(null)

  const formFilled = Boolean(apiKey.trim() && baseUrl.trim() && model.trim())

  const selectProvider = (nextProviderId: ProviderId) => {
    const preset = getProviderPreset(nextProviderId)
    setProviderId(nextProviderId)
    setBaseUrl(preset.baseUrl)
    setModel(preset.model)
    setContextWindow(preset.contextWindow)
    onProviderChange?.(nextProviderId)
  }

  const buildConfig = (): ModelConfig => ({
    version: 2,
    providerId,
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    contextWindow,
    streamMode,
  })

  const submit = async (intent: 'save' | 'test') => {
    setSubmitting(intent)
    try {
      if (intent === 'test') await onSaveAndTest(buildConfig())
      else await onSave(buildConfig())
    } catch {
      // The parent keeps the route open and displays the actionable error.
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit('test')
      }}
    >
      <div className="section-heading">
        <h2>模型设置</h2>
        <p>仅在翻译或 AI 精炼时调用你配置的模型</p>
      </div>

      <fieldset className="provider-selector">
        <legend>模型服务商</legend>
        <div className="provider-grid">
          {PROVIDER_PRESETS.map((provider) => (
            <label className="provider-option" key={provider.id}>
              <input
                type="radio"
                name="provider"
                value={provider.id}
                checked={providerId === provider.id}
                onChange={() => selectProvider(provider.id)}
              />
              <span>{provider.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <SettingRow label="API Key" htmlFor="api-key">
        <input
          id="api-key"
          name="api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          placeholder="输入服务商提供的 API Key"
        />
      </SettingRow>

      <SettingRow label="Base URL" htmlFor="base-url">
        <input
          id="base-url"
          name="base-url"
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.com/v1"
        />
      </SettingRow>

      <SettingRow label="模型名称" htmlFor="model-name">
        <input
          id="model-name"
          name="model-name"
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="模型 ID"
        />
      </SettingRow>

      <SettingRow label="上下文窗口" htmlFor="context-window">
        <input
          id="context-window"
          name="context-window"
          type="number"
          min={4096}
          step={1}
          value={contextWindow}
          onChange={(event) => setContextWindow(Number(event.target.value))}
        />
      </SettingRow>

      <SettingRow
        label="流式模式"
        description="自动模式会在服务商不支持时安全降级"
        htmlFor="stream-mode"
      >
        <select
          id="stream-mode"
          value={streamMode}
          onChange={(event) => setStreamMode(event.target.value as ModelConfig['streamMode'])}
        >
          <option value="auto">自动</option>
          <option value="on">始终开启</option>
          <option value="off">关闭</option>
        </select>
      </SettingRow>

      {formError && <p role="alert" className="error">{formError}</p>}

      <div className="settings-form__actions">
        <Button
          variant="primary"
          type="submit"
          fullWidth
          disabled={submitting !== null || !formFilled}
        >
          {submitting === 'test' ? '正在保存…' : '保存并测试'}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          disabled={submitting !== null || !formFilled}
          onClick={() => void submit('save')}
        >
          {submitting === 'save' ? '保存中…' : '仅保存'}
        </Button>
        {savedConfig && (
          <Button variant="danger-outline" fullWidth onClick={() => void onDelete()}>
            删除配置
          </Button>
        )}
      </div>
    </form>
  )
}
