import type { VideoMetadata } from '../core/contracts'
import { EmptyState } from './ui/EmptyState'
import { VideoCard } from './ui/VideoCard'

interface NoSubtitleViewProps {
  metadata: VideoMetadata
}

export function NoSubtitleView({ metadata }: NoSubtitleViewProps) {
  return (
    <div className="state-stack">
      <VideoCard metadata={metadata} />
      <EmptyState
        title="这个视频没有可用字幕"
        description="请确认播放器中已经提供字幕，或稍后重新检测。"
      >
        <p>当前功能仅处理视频已有字幕，不会调用模型生成字幕。</p>
      </EmptyState>
    </div>
  )
}
