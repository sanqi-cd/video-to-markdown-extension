import { useState, useEffect } from 'react'

interface ProgressViewProps {
  stage: string
  completed: number
  total: number
  startedAt: number
  onCancel: () => void
}

export function ProgressView({ stage, completed, total, startedAt, onCancel }: ProgressViewProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(id)
  }, [startedAt])

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div>
      <p>
        {stage}：{completed} / {total}
      </p>
      <progress value={completed} max={total} aria-label="处理进度" />
      <p>{pct}%</p>
      <p>已用时：{formatElapsed(elapsed)}</p>
      <button type="button" onClick={onCancel}>
        取消
      </button>
    </div>
  )
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
