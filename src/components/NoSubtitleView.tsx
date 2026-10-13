import { useState } from 'react'
import type { VideoMetadata } from '../core/contracts'
import type { PublisherTranscriptDiscovery } from '../adapters/bilibili/publisher-transcript'
import { EmptyState } from './ui/EmptyState'
import { VideoCard } from './ui/VideoCard'
import { ManualYouTubeSourceForm } from './ManualYouTubeSourceForm'
import { Button } from './ui/Button'
import { TranscriptionSetup } from './TranscriptionSetup'
import type { TranscriptionConfig, TranscriptionUiState } from '../transcription/contracts'

interface NoSubtitleViewProps {
  metadata: VideoMetadata
  reason?: 'unreliable'
  onRedetect?: () => void
  onDiscoverPublisherTranscript?: () => Promise<PublisherTranscriptDiscovery>
  onManualYouTubeSource?: (url: string) => Promise<void>
  transcriptionConfig?: TranscriptionConfig | null
  transcriptionState?: TranscriptionUiState
  onSaveTranscriptionConfig?: (config: TranscriptionConfig) => Promise<void>
  onDeleteTranscriptionConfig?: () => Promise<void>
  onStartTranscription?: () => Promise<void>
  onStopTranscription?: () => Promise<void>
}

export function NoSubtitleView({
  metadata,
  reason,
  onRedetect,
  onDiscoverPublisherTranscript,
  onManualYouTubeSource,
  transcriptionConfig = null,
  transcriptionState = { status: 'idle' },
  onSaveTranscriptionConfig,
  onDeleteTranscriptionConfig,
  onStartTranscription,
  onStopTranscription,
}: NoSubtitleViewProps) {
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState<PublisherTranscriptDiscovery | null>(null)

  const discover = async () => {
    if (!onDiscoverPublisherTranscript || isDiscovering) return
    setIsDiscovering(true)
    setDiscovery(null)
    try {
      const result = await onDiscoverPublisherTranscript()
      setDiscovery(result)
    } catch (cause) {
      setDiscovery({
        status: 'not-found',
        message: cause instanceof Error ? cause.message : '发布者文稿查找失败，请稍后重试。',
      })
    } finally {
      setIsDiscovering(false)
    }
  }

  return (
    <div className="state-stack">
      <VideoCard metadata={metadata} onRedetect={isDiscovering ? undefined : onRedetect} />
      <EmptyState
        title={reason === 'unreliable' ? '字幕暂时无法可靠使用' : '未找到可直接提取的字幕'}
        description={reason === 'unreliable'
          ? '检测到字幕，但内容或时间覆盖未通过检查。请重新检测，或通过音频识别生成文字；不会继续使用异常字幕。'
          : '画面中的文字不一定是可读取的字幕轨。B 站视频可以先识别音频，再整理为 Markdown，无需原视频链接。'}
      >
        {metadata.platform === 'bilibili' ? (
          <div className="no-subtitle-recovery">
            {onSaveTranscriptionConfig && onDeleteTranscriptionConfig && onStartTranscription && onStopTranscription && (
              <TranscriptionSetup
                config={transcriptionConfig}
                state={transcriptionState}
                onSave={onSaveTranscriptionConfig}
                onDelete={onDeleteTranscriptionConfig}
                onStart={onStartTranscription}
                onStop={onStopTranscription}
              />
            )}
            {(onDiscoverPublisherTranscript || onManualYouTubeSource) && (
              <details className="no-subtitle-recovery__alternatives">
                <summary>不发送音频的其他方式</summary>
                {onDiscoverPublisherTranscript && (
                  <>
                    <p>先检查 UP 主是否在简介、置顶评论或 B 站文稿中提供了完整文字。</p>
                    <Button
                      variant="secondary"
                      fullWidth
                      disabled={isDiscovering}
                      onClick={() => void discover()}
                    >
                      {isDiscovering ? '正在查找发布者文稿…' : '自动查找发布者文稿'}
                    </Button>
                  </>
                )}
                {isDiscovering && (
                  <p className="no-subtitle-recovery__status" role="status">
                    正在核对视频简介、UP 主置顶评论和文稿访问状态…
                  </p>
                )}
                {discovery?.status === 'locked' && (
                  <div className="no-subtitle-recovery__result no-subtitle-recovery__result--warning" role="status">
                    <strong>已找到发布者文稿，但当前无法读取</strong>
                    <p>{discovery.message}</p>
                    <a href={discovery.url} target="_blank" rel="noreferrer">在 B 站打开文稿</a>
                  </div>
                )}
                {discovery?.status === 'not-found' && (
                  <div className="no-subtitle-recovery__result" role="status">
                    <strong>没有找到可用的完整文稿</strong>
                    <p>{discovery.message}</p>
                  </div>
                )}
                {onManualYouTubeSource && (
                  <>
                    <p>如果你已经知道 YouTube 原视频，也可以读取它的字幕。</p>
                    <ManualYouTubeSourceForm onSubmit={onManualYouTubeSource} />
                  </>
                )}
              </details>
            )}
          </div>
        ) : (
          <p>当前功能仅处理视频已有字幕，不会调用模型生成字幕。</p>
        )}
      </EmptyState>
    </div>
  )
}
