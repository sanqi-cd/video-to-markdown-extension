import { useMemo } from 'react'
import type { VideoMetadata } from '../core/contracts'
import type { TaskSnapshot } from '../core/task-events'
import type { OutputLanguage } from '../core/language'
import {
  buildPartialDocument,
  buildRefinedAnalysisPreview,
  visibleCompletedChunks,
} from '../markdown/partial-document'
import { useAutoScroll } from '../hooks/use-auto-scroll'
import { Button } from './ui/Button'
import { StatusBadge } from './ui/StatusBadge'
import { LiveDocumentPreview } from './LiveDocumentPreview'
import { ProgressView } from './ProgressView'
import { RefinedAnalysisPreview } from './RefinedAnalysisPreview'
import { TaskStageList } from './TaskStageList'

interface GeneratingViewProps {
  snapshot: Extract<TaskSnapshot, { status: 'running' }>
  metadata: VideoMetadata
  outputLanguage?: OutputLanguage
  onCancel: () => void
}

export function GeneratingView({
  snapshot,
  metadata,
  outputLanguage,
  onCancel,
}: GeneratingViewProps) {
  const document = useMemo(() => buildPartialDocument({
    metadata,
    mode: snapshot.mode ?? 'high-fidelity',
    completedChunks: snapshot.completedChunks,
    generatedAt: snapshot.startedAt ?? 0,
    incompleteChunkCount: Math.max(
      0,
      snapshot.metrics.totalChunks - snapshot.metrics.completedChunks,
    ),
    outputLanguage,
  }), [
    metadata,
    snapshot.completedChunks,
    snapshot.metrics.completedChunks,
    snapshot.metrics.totalChunks,
    snapshot.mode,
    snapshot.startedAt,
    outputLanguage,
  ])
  const analysisPreview = useMemo(
    () => snapshot.mode === 'refined'
      ? buildRefinedAnalysisPreview(snapshot.completedChunks)
      : null,
    [snapshot.completedChunks, snapshot.mode],
  )
  const visibleChunks = visibleCompletedChunks(snapshot.completedChunks)
  // Raw streamed characters are not rendered in the preview. Only follow when
  // validated, visible content changes so frequent token updates cannot restart scrolling.
  const contentVersion = visibleChunks.map((chunk) => chunk.id).join('|')
  const {
    containerRef,
    handleScroll,
    isFollowing,
    pendingCount,
    resume,
  } = useAutoScroll(contentVersion, visibleChunks.length)
  const hasPreviewContent = document !== null || analysisPreview !== null

  return (
    <div className="generating-view">
      <ProgressView
        stage={snapshot.stage}
        completed={snapshot.metrics.completedChunks}
        total={snapshot.metrics.totalChunks}
        startedAt={snapshot.startedAt ?? 0}
        currentChunkIndex={snapshot.metrics.currentChunkIndex}
        receivedChars={snapshot.metrics.receivedChars}
        modelConnected={snapshot.modelConnectedChunkIndex !== undefined
          && (snapshot.metrics.currentChunkIndex === null
            || snapshot.modelConnectedChunkIndex === snapshot.metrics.currentChunkIndex)}
        retry={snapshot.retry}
        hasContent={hasPreviewContent}
        onCancel={onCancel}
        showAction={false}
      />

      <TaskStageList
        mode={snapshot.mode ?? 'high-fidelity'}
        currentStage={snapshot.stage}
      />

      <section className="live-preview-card" aria-labelledby="live-preview-title">
        <div className="live-preview-card__heading">
          <div>
            <StatusBadge tone={hasPreviewContent ? 'success' : 'info'}>
              {document ? '实时更新中' : analysisPreview ? '内容理解中' : '等待首段'}
            </StatusBadge>
            <h2 id="live-preview-title">实时预览</h2>
          </div>
          {document && <span>笔记持续更新</span>}
          {!document && analysisPreview && (
            <span>{analysisPreview.analyzedChunks} 个分块已理解</span>
          )}
        </div>

        <div
          className="live-preview-card__viewport"
          ref={containerRef}
          onScroll={handleScroll}
          data-testid="live-preview-viewport"
        >
          {document
            ? <LiveDocumentPreview document={document} />
            : analysisPreview
              ? <RefinedAnalysisPreview preview={analysisPreview} />
            : (
              <div className="live-preview-card__empty">
                <span className="loading-indicator" aria-hidden="true" />
                <p>
                  {snapshot.mode === 'refined'
                    ? '首个分块理解完成后会立即显示阶段性结果'
                    : '第一段通过校验后会立即显示在这里'}
                </p>
              </div>
            )}
        </div>

        {!isFollowing && pendingCount > 0 && (
          <Button className="live-preview-card__latest" variant="secondary" onClick={resume}>
            新增 {pendingCount} 段 · 查看最新
          </Button>
        )}
      </section>
    </div>
  )
}
