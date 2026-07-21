import { useMemo, useState } from 'react'
import type { VideoMetadata } from '../core/contracts'
import type { TaskSnapshot } from '../core/task-events'
import type { OutputLanguage } from '../core/language'
import {
  buildPartialDocument,
  buildRefinedAnalysisPreview,
} from '../markdown/partial-document'
import { renderMarkdown } from '../markdown/render-markdown'
import { LiveDocumentPreview } from './LiveDocumentPreview'
import { RefinedAnalysisPreview } from './RefinedAnalysisPreview'
import { Button } from './ui/Button'
import { StatusBadge } from './ui/StatusBadge'

type PartialSnapshot = Extract<TaskSnapshot, { status: 'partial' | 'cancelled' }>

interface PartialResultViewProps {
  snapshot: PartialSnapshot
  metadata: VideoMetadata
  includeTimestamps: boolean
  outputLanguage?: OutputLanguage
  onRetry?: () => void
  onExport: (filename: string, markdown: string) => void | Promise<void>
  onBack: () => void
}

export function PartialResultView({
  snapshot,
  metadata,
  includeTimestamps,
  outputLanguage,
  onRetry,
  onExport,
  onBack,
}: PartialResultViewProps) {
  const [generatedAt] = useState(() => Date.now())
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const incompleteChunkCount = Math.max(
    snapshot.failedChunks.length,
    snapshot.metrics.totalChunks - snapshot.metrics.completedChunks,
  )
  const document = useMemo(() => buildPartialDocument({
    metadata,
    mode: snapshot.mode ?? 'high-fidelity',
    completedChunks: snapshot.completedChunks,
    generatedAt,
    incompleteChunkCount,
    outputLanguage,
  }), [
    generatedAt,
    incompleteChunkCount,
    metadata,
    outputLanguage,
    snapshot.completedChunks,
    snapshot.mode,
  ])
  const analysisPreview = useMemo(
    () => snapshot.mode === 'refined'
      ? buildRefinedAnalysisPreview(snapshot.completedChunks)
      : null,
    [snapshot.completedChunks, snapshot.mode],
  )
  const cancelled = snapshot.status === 'cancelled'

  const handleExport = async () => {
    if (!document) return
    setExporting(true)
    setExportFeedback(null)
    try {
      await onExport(
        `${document.metadata.title}-partial`,
        renderMarkdown(document, { includeTimestamps }),
      )
      setExportFeedback({ tone: 'success', message: '下载任务已创建' })
    } catch (error) {
      setExportFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '导出失败，请稍后重试',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="partial-result">
      <div className="partial-result__heading">
        <StatusBadge tone="warning">{cancelled ? '已停止并保留' : '部分完成'}</StatusBadge>
        <h2>{cancelled ? '任务已停止，成功内容已经保留' : '部分内容生成成功'}</h2>
        <p>
          已完成 {snapshot.metrics.completedChunks} / {snapshot.metrics.totalChunks} 个分块
          {!cancelled && `，${snapshot.failedChunks.length} 个分块需要重试`}。
        </p>
      </div>

      {snapshot.failedChunks.length > 0 && (
        <section className="partial-result__failures" aria-labelledby="failure-title">
          <h3 id="failure-title">未完成部分</h3>
          <ul>
            {snapshot.failedChunks.map((chunk) => (
              <li key={chunk.id}>
                <strong>第 {chunk.index + 1} 部分</strong>
                <span>{chunk.error.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {document && (
        <section className="partial-result__preview" aria-labelledby="preserved-title">
          <h3 id="preserved-title">已保留内容</h3>
          <LiveDocumentPreview document={document} />
        </section>
      )}
      {!document && analysisPreview && (
        <section className="partial-result__preview" aria-labelledby="preserved-analysis-title">
          <h3 id="preserved-analysis-title">已保留的内容理解结果</h3>
          <RefinedAnalysisPreview preview={analysisPreview} />
        </section>
      )}

      <div className="partial-result__actions">
        {!cancelled && snapshot.failedChunks.length > 0 && onRetry && (
          <Button variant="primary" fullWidth onClick={onRetry}>重试失败部分</Button>
        )}
        {document && (
          <Button
            variant={cancelled ? 'primary' : 'secondary'}
            fullWidth
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? '正在导出…' : '导出当前结果'}
          </Button>
        )}
        <Button variant="text" fullWidth onClick={onBack}>返回并调整设置</Button>
      </div>
      {exportFeedback && (
        <div
          role={exportFeedback.tone === 'error' ? 'alert' : 'status'}
          className={exportFeedback.tone === 'error' ? 'error' : 'success'}
        >
          {exportFeedback.message}
        </div>
      )}
    </div>
  )
}
