import { useState } from 'react'
import type {
  TranscriptionConfig,
  TranscriptionUiState,
} from '../transcription/contracts'
import {
  DEFAULT_TRANSCRIPTION_ENDPOINT,
  DEFAULT_TRANSCRIPTION_MODEL,
  ARK_TRANSCRIPTION_ENDPOINT,
  ARK_TRANSCRIPTION_MODEL,
} from '../transcription/config-store'
import { isTranscriptionActive } from '../transcription/ui-state'
import { Button } from './ui/Button'
import { SettingRow } from './ui/SettingRow'

interface TranscriptionSetupProps {
  config: TranscriptionConfig | null
  state: TranscriptionUiState
  onSave: (config: TranscriptionConfig) => Promise<void>
  onDelete: () => Promise<void>
  onStart: () => Promise<void>
  onStop: () => Promise<void>
}

export function TranscriptionSetup({
  config,
  state,
  onSave,
  onDelete,
  onStart,
  onStop,
}: TranscriptionSetupProps) {
  const [protocol, setProtocol] = useState<NonNullable<TranscriptionConfig['protocol']>>(config?.protocol ?? 'openai-transcription')
  const [endpoint, setEndpoint] = useState(config?.endpoint ?? DEFAULT_TRANSCRIPTION_ENDPOINT)
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [model, setModel] = useState(config?.model ?? DEFAULT_TRANSCRIPTION_MODEL)
  const [language, setLanguage] = useState<TranscriptionConfig['language']>(
    config?.language ?? 'auto',
  )
  const [chunkSeconds, setChunkSeconds] = useState(config?.chunkSeconds ?? 30)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const isActive = isTranscriptionActive(state)
  const formFilled = Boolean(endpoint.trim() && apiKey.trim() && model.trim())

  const buildConfig = (): TranscriptionConfig => ({
    version: 1,
    protocol,
    endpoint: endpoint.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    language,
    chunkSeconds,
  })

  const saveAndStart = async () => {
    if (isSaving || isActive) return
    setIsSaving(true)
    setFormError(null)
    try {
      await onSave(buildConfig())
      await onStart()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '语音转写启动失败')
    } finally {
      setIsSaving(false)
    }
  }

  const startExisting = async () => {
    setFormError(null)
    try {
      await onStart()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '语音转写启动失败')
    }
  }

  const deleteConfig = async () => {
    setFormError(null)
    try {
      await onDelete()
      setApiKey('')
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '删除语音转写配置失败')
    }
  }

  return (
    <section className="transcription-setup" aria-labelledby="transcription-heading">
      <div className="transcription-setup__heading">
        <div>
          <span className="transcription-setup__eyebrow">推荐</span>
          <h3 id="transcription-heading">直接转录当前视频</h3>
        </div>
        {!isActive && <span className="status-badge status-badge--info">
          {config ? '语音识别已配置 · 待实际转写验证' : '语音识别未配置'}
        </span>}
      </div>
      <p className="transcription-setup__description">
        插件会从头播放当前 B 站视频，分段识别音频并实时显示文字，不需要原视频链接。
        音频会发送到你配置的服务，可能产生调用费用。
        首次使用或切换视频标签页后，请先点击浏览器工具栏（或扩展菜单）中的本插件图标，授权当前标签页采集。
      </p>

      {state.status === 'running' && (
        <div className="transcription-progress" role="status">
          <div className="transcription-progress__summary">
            <strong>正在转写第 {Math.max(1, state.chunkIndex + 1)} 段</strong>
            <span>
              已录制 {formatTime(state.recordedMs)} · 已识别 {formatTime(state.transcribedMs)}
            </span>
          </div>
          <div className="transcription-progress__bar" aria-hidden="true">
            <span />
          </div>
          <p>{state.cues.length > 0 ? state.cues.slice(-2).map((cue) => cue.text).join(' ') : '正在采集首段音频…'}</p>
          <Button variant="secondary" fullWidth onClick={() => void onStop()}>
            停止并保留已识别内容
          </Button>
        </div>
      )}

      {state.status === 'starting' && (
        <p className="transcription-setup__status" role="status">
          正在连接标签页音频并从视频开头开始播放…
        </p>
      )}

      {state.status === 'failed' && (
        <div className="transcription-setup__error" role="alert">
          <strong>语音转写未完成</strong>
          <p>{state.error.message}</p>
          {state.cues.length > 0 && <p>已识别的 {state.cues.length} 段文字仍保留在当前页面。</p>}
        </div>
      )}

      {!isActive && config && (
        <Button variant="primary" fullWidth onClick={() => void startExisting()}>
          开始直接转录
        </Button>
      )}

      {!isActive && (
        <details className="transcription-config" open={!config}>
          <summary>{config ? '修改语音识别服务' : '配置语音识别'}</summary>
          <form
            className="transcription-config__form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveAndStart()
            }}
          >
            <p className="transcription-config__notice">
              音频分段会发送到你填写的服务。火山方舟模式使用支持音频输入的多模态模型，时间戳精度为录音分段级别。
            </p>
            <SettingRow label="接口类型" htmlFor="transcription-protocol">
              <select id="transcription-protocol" value={protocol} onChange={(event) => {
                const next = event.target.value as NonNullable<TranscriptionConfig['protocol']>
                setProtocol(next)
                setEndpoint(next === 'ark-responses' ? ARK_TRANSCRIPTION_ENDPOINT : DEFAULT_TRANSCRIPTION_ENDPOINT)
                setModel(next === 'ark-responses' ? ARK_TRANSCRIPTION_MODEL : DEFAULT_TRANSCRIPTION_MODEL)
                setApiKey('')
              }}>
                <option value="openai-transcription">OpenAI 兼容音频转写</option>
                <option value="ark-responses">火山方舟 Responses（音频）</option>
              </select>
            </SettingRow>
            <SettingRow label="转写接口" htmlFor="transcription-endpoint">
              <input
                id="transcription-endpoint"
                type="url"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={DEFAULT_TRANSCRIPTION_ENDPOINT}
              />
            </SettingRow>
            <SettingRow label="API Key" htmlFor="transcription-api-key">
              <input
                id="transcription-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                placeholder="输入语音转写服务的 API Key"
              />
            </SettingRow>
            <SettingRow label="转写模型" htmlFor="transcription-model">
              <input
                id="transcription-model"
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={DEFAULT_TRANSCRIPTION_MODEL}
              />
            </SettingRow>
            <div className="transcription-config__grid">
              <SettingRow label="音频语言" htmlFor="transcription-language">
                <select
                  id="transcription-language"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as TranscriptionConfig['language'])}
                >
                  <option value="auto">自动检测</option>
                  <option value="zh">中文</option>
                  <option value="en">英文</option>
                </select>
              </SettingRow>
              <SettingRow label="分段时长" htmlFor="transcription-chunk-seconds">
                <select
                  id="transcription-chunk-seconds"
                  value={chunkSeconds}
                  onChange={(event) => setChunkSeconds(Number(event.target.value))}
                >
                  <option value={30}>30 秒</option>
                  <option value={60}>60 秒</option>
                  <option value={90}>90 秒</option>
                </select>
              </SettingRow>
            </div>
            {formError && <p className="transcription-config__error" role="alert">{formError}</p>}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!formFilled || isSaving}
            >
              {isSaving ? '正在保存并启动…' : '保存配置并开始转录'}
            </Button>
            {config && (
              <Button
                variant="danger-outline"
                fullWidth
                onClick={() => void deleteConfig()}
              >
                删除语音转写配置
              </Button>
            )}
          </form>
        </details>
      )}
    </section>
  )
}

function formatTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
