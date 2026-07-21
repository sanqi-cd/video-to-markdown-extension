import { useEffect, useState } from 'react'
import type { ModelTestState } from '../core/product-state'
import type { ProviderId } from '../model/provider-presets'
import { getProviderPreset } from '../model/provider-presets'
import { Button } from './ui/Button'
import { ProgressBar } from './ui/ProgressBar'
import { StatusBadge } from './ui/StatusBadge'

interface ModelTestViewProps {
  state: ModelTestState
  providerId: ProviderId
  baseUrl: string
  onBackToSettings: () => void
  onContinue: () => void
}

export function ModelTestView({
  state,
  providerId,
  baseUrl,
  onBackToSettings,
  onContinue,
}: ModelTestViewProps) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const provider = getProviderPreset(providerId)
  const hostname = safeHostname(baseUrl)

  useEffect(() => {
    if (state.status !== 'testing') return
    const timer = globalThis.setInterval(() => {
      setElapsedMs(Date.now() - state.startedAt)
    }, 200)
    return () => globalThis.clearInterval(timer)
  }, [state])

  if (state.status === 'testing') {
    return (
      <section className="model-test-card" role="status" aria-live="polite">
        <StatusBadge tone="info">测试中</StatusBadge>
        <div className="model-test-card__copy">
          <h2>正在连接 {provider.name}</h2>
          <p>请求目标：{hostname}</p>
        </div>
        <ProgressBar value={Math.min(elapsedMs, 15_000)} max={15_000} label="连接测试进度" />
        <p className="model-test-card__meta">已等待 {(elapsedMs / 1000).toFixed(1)} 秒</p>
      </section>
    )
  }

  if (state.status === 'success') {
    return (
      <section className="model-test-card" role="status">
        <StatusBadge tone="success">连接成功</StatusBadge>
        <div className="model-test-card__copy">
          <h2>{provider.name} 已可用</h2>
          <p>{hostname} · 响应耗时 {state.latencyMs}ms</p>
        </div>
        <Button variant="primary" fullWidth onClick={onContinue}>返回视频继续</Button>
      </section>
    )
  }

  if (state.status === 'failed') {
    return (
      <section className="model-test-card model-test-card--error" role="alert">
        <StatusBadge tone="error">连接失败</StatusBadge>
        <div className="model-test-card__copy">
          <h2>无法连接 {provider.name}</h2>
          <p>{state.error.message}</p>
          <span className="model-test-card__meta">请求目标：{hostname}</span>
        </div>
        <Button variant="primary" fullWidth onClick={onBackToSettings}>返回修改配置</Button>
      </section>
    )
  }

  return (
    <section className="model-test-card" role="status">
      <StatusBadge>尚未测试</StatusBadge>
      <div className="model-test-card__copy">
        <h2>保存配置后测试连接</h2>
        <p>测试只会发送一条最小请求。</p>
      </div>
      <Button variant="secondary" fullWidth onClick={onBackToSettings}>返回模型设置</Button>
    </section>
  )
}

function safeHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return '未识别的 API 地址'
  }
}
