import type { VideoMetadata } from '../../core/contracts'
import { StatusBadge } from './StatusBadge'

interface VideoCardProps {
  metadata: VideoMetadata
  subtitle?: string
  onRedetect?: () => void
}

export function VideoCard({ metadata, subtitle, onRedetect }: VideoCardProps) {
  const platform = metadata.platform === 'youtube' ? 'YouTube' : '哔哩哔哩'
  const details = [metadata.author, formatDuration(metadata.durationMs)].filter(Boolean).join(' · ')

  return (
    <article className="video-card">
      <div className="video-card__topline">
        <StatusBadge tone="info">{platform}</StatusBadge>
        {subtitle && <span className="video-card__subtitle">{subtitle}</span>}
        {onRedetect && <button type="button" className="video-card__redetect" onClick={onRedetect}
          title="重新读取视频和字幕，不会刷新网页">↻ 重新检测</button>}
      </div>
      <h2 className="video-card__title">{metadata.title}</h2>
      {details && <p className="video-card__details">{details}</p>}
    </article>
  )
}

function formatDuration(ms?: number): string | undefined {
  if (!ms) return undefined
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
