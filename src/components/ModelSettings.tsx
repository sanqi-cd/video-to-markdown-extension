import { useState } from 'react'
import type { ModelConfig } from '../model/config-store'

interface ModelSettingsProps {
  onSave: (config: ModelConfig) => Promise<void>
  onTest: (config: ModelConfig) => Promise<void>
  onDelete: () => Promise<void>
  savedConfig: ModelConfig | null
  isTesting: boolean
  testError: string | null
}

const DEFAULT_CONTEXT_WINDOW = 128000

export function ModelSettings({
  onSave,
  onTest,
  onDelete,
  savedConfig,
  isTesting,
  testError,
}: ModelSettingsProps) {
  const [apiKey, setApiKey] = useState(savedConfig?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(savedConfig?.baseUrl ?? '')
  const [model, setModel] = useState(savedConfig?.model ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!savedConfig)

  const formFilled = apiKey.trim() && baseUrl.trim() && model.trim()

  const buildConfig = (): ModelConfig => ({
    apiKey: apiKey.trim(),
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(buildConfig())
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    await onTest(buildConfig())
  }

  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault()
        void handleSave()
      }}
    >
      <label htmlFor="api-key">API Key</label>
      <input
        id="api-key"
        name="api-key"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        autoComplete="off"
        placeholder="sk-..."
      />

      <label htmlFor="base-url">Base URL</label>
      <input
        id="base-url"
        name="base-url"
        type="url"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://api.openai.com/v1"
      />

      <label htmlFor="model-name">模型名称</label>
      <input
        id="model-name"
        name="model-name"
        type="text"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="gpt-4o"
      />

      <div className="button-row">
        <button type="submit" disabled={saving || !formFilled}>
          {saving ? '保存中…' : saved ? '更新配置' : '保存'}
        </button>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={isTesting || !formFilled}
        >
          {isTesting ? '测试中…' : '测试连接'}
        </button>
        {savedConfig && (
          <button
            type="button"
            className="danger"
            onClick={() => void onDelete()}
          >
            删除配置
          </button>
        )}
      </div>

      {testError && <p role="alert" className="error">{testError}</p>}
    </form>
  )
}
