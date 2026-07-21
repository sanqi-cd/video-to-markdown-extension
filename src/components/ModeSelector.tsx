import { requiresModel } from '../core/product-state'
import { StatusBadge } from './ui/StatusBadge'
import type { OutputLanguage } from '../core/language'

export type Mode = 'high-fidelity' | 'refined'
export type ModelConnectionStatus = 'missing' | 'configured' | 'connected'

interface ModeSelectorProps {
  value: Mode
  sourceLanguage: string
  outputLanguage: OutputLanguage
  modelStatus: ModelConnectionStatus
  onChange: (mode: Mode) => void
}

const MODES: Array<{ value: Mode; title: string; description: string }> = [
  {
    value: 'high-fidelity',
    title: '高保真',
    description: '尽量保留视频原有表达和段落结构',
  },
  {
    value: 'refined',
    title: 'AI 精炼',
    description: '提炼重点并生成结构化笔记',
  },
]

export function ModeSelector({
  value,
  sourceLanguage,
  outputLanguage,
  modelStatus,
  onChange,
}: ModeSelectorProps) {
  return (
    <section className="setting-group" aria-labelledby="processing-mode-title">
      <div className="setting-group__heading">
        <h3 id="processing-mode-title">处理模式</h3>
        <ModelStatusBadge status={modelStatus} />
      </div>
      <div className="mode-options" role="radiogroup" aria-labelledby="processing-mode-title">
        {MODES.map((mode) => {
          const modelRequired = requiresModel(mode.value, sourceLanguage, outputLanguage)
          return (
            <label className="mode-option" key={mode.value}>
              <input
                type="radio"
                name="mode"
                value={mode.value}
                checked={value === mode.value}
                onChange={() => onChange(mode.value)}
              />
              <span className="mode-option__copy">
                <span className="mode-option__title-row">
                  <strong>{mode.title}</strong>
                  {!modelRequired && <StatusBadge tone="success">无需模型</StatusBadge>}
                </span>
                <small>{mode.description}</small>
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function ModelStatusBadge({
  status,
}: {
  status: ModelConnectionStatus
}) {
  if (status === 'connected') return <StatusBadge tone="success">模型已连接</StatusBadge>
  if (status === 'configured') return <StatusBadge tone="warning">模型已配置 · 未测试</StatusBadge>
  return <StatusBadge tone="warning">模型未配置</StatusBadge>
}
