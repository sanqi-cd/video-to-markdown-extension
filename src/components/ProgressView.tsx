import { useState, useEffect } from 'react'
import { Button } from './ui/Button'
import { ProgressBar } from './ui/ProgressBar'
import { StatusBadge } from './ui/StatusBadge'
import { taskStageLabel, type TaskSnapshot, type TaskStage } from '../core/task-events'

interface ProgressViewProps {
  stage: TaskStage
  completed: number
  total: number
  startedAt: number
  onCancel: () => void
  showAction?: boolean
  hasContent?: boolean
  receivedChars?: number
  currentChunkIndex?: number | null
  retry?: TaskSnapshot['retry']
  modelConnected?: boolean
}

export function ProgressView({
  stage,
  completed,
  total,
  startedAt,
  onCancel,
  showAction = true,
  hasContent = false,
  receivedChars = 0,
  currentChunkIndex = null,
  retry,
  modelConnected = false,
}: ProgressViewProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [startedAt])

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const waitingForModel = !hasContent
    && elapsed >= 2
    && (stage === 'processing-high-fidelity'
      || stage === 'processing-refined-map'
      || stage === 'processing-refined-reduce')

  return (
    <section className="progress-view" aria-label="生成进度">
      <p className="sr-only" aria-live="polite">当前阶段：{taskStageLabel(stage)}</p>
      <div className="progress-view__heading">
        <div>
          <StatusBadge tone="info">生成中</StatusBadge>
          <h2>{taskStageLabel(stage)}</h2>
        </div>
        <span className="progress-view__elapsed">{formatElapsed(elapsed)}</span>
      </div>
      <ProgressBar value={completed} max={total} label="处理进度" />
      <p className="progress-view__summary">
        已完成 {completed} / {total}，{pct}%
      </p>
      <div className="progress-view__activity">
        {modelConnected
          ? <span>模型已连接</span>
          : <span className="progress-view__activity-placeholder" aria-hidden="true">模型已连接</span>}
        {currentChunkIndex !== null && total > 0 ? (
          <span>正在处理第 {currentChunkIndex + 1} / {total} 部分</span>
        ) : (
          <span className="progress-view__activity-placeholder" aria-hidden="true">
            正在处理第 00 / 00 部分
          </span>
        )}
        {receivedChars > 0
          ? <span>已接收 {receivedChars} 个字符</span>
          : <span className="progress-view__activity-placeholder" aria-hidden="true">已接收 0000 个字符</span>}
      </div>
      <div className="progress-view__status-slot">
        {retry ? (
          <p className="progress-view__retry" role="status">
            当前分块正在进行第 {retry.attempt} 次尝试
          </p>
        ) : waitingForModel ? (
          <p className="progress-view__waiting" role="status">
            正在等待模型响应
            <span aria-hidden="true">，已等待 {formatElapsed(elapsed)}</span>
          </p>
        ) : null}
      </div>
      {showAction && <Button variant="secondary" onClick={onCancel}>取消</Button>}
    </section>
  )
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
