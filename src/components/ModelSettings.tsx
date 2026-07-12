import { useState } from 'react'
import type { ModelConfig } from '../model/config-store'

interface ModelSettingsProps {
  onSave: (config: ModelConfig) => Promise<void>
  onTest: () => Promise<void>
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
  const [apiKey, setApiKey] = useState(savedConfig ? '••••••••' : '')
  const [baseUrl, setBaseUrl] = useState(savedConfig?.baseUrl ?? '')
  const [model, setModel] = useState(savedConfig?.model ?? '')
  const [saving, setSaving] = useState(false)

  const hasSavedConfig = savedConfig !== null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        apiKey,
        baseUrl,
        model,
        contextWindow: savedConfig?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
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

      <div>
        <button type="submit" disabled={saving}>
          保存
        </button>
        <button type="button" onClick={() => void onTest()} disabled={isTesting || !hasSavedConfig}>
          测试连接
        </button>
        <button type="button" onClick={() => void onDelete()} disabled={!hasSavedConfig}>
          删除配置
        </button>
      </div>

      {testError && <p role="alert">{testError}</p>}
    </form>
  )
}
