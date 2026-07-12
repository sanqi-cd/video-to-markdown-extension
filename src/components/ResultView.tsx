import { useState } from 'react'
import type { ProcessedDocument } from '../core/orchestrator'
import type { PublicAppError } from '../errors/app-error'

interface ResultViewProps {
  document: ProcessedDocument
  markdown: string
  onCopy: () => Promise<void>
  onDownload: () => void
}

export function ResultView({ document, markdown, onCopy, onDownload }: ResultViewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <h2>{document.metadata.title}</h2>
      <pre>{markdown}</pre>
      <button type="button" onClick={handleCopy}>
        {copied ? '已复制' : '复制'}
      </button>
      <button type="button" onClick={onDownload}>
        下载 .md
      </button>
    </div>
  )
}

interface PartialResultViewProps {
  failedCount: number
  onRetry: () => void
}

export function PartialResultView({ failedCount, onRetry }: PartialResultViewProps) {
  return (
    <div>
      <p>{failedCount} 个分块处理失败</p>
      <button type="button" onClick={onRetry}>
        重试失败部分
      </button>
    </div>
  )
}

interface ErrorViewProps {
  error: PublicAppError
}

export function ErrorView({ error }: ErrorViewProps) {
  return (
    <div role="alert">
      <p>{error.message}</p>
    </div>
  )
}
