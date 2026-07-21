import type { VideoMetadata, SubtitleTrack } from '../core/contracts'
import { Button } from './ui/Button'
import { VideoCard } from './ui/VideoCard'
import { ModeSelector, type ModelConnectionStatus } from './ModeSelector'
import { OutputLanguageSelector } from './OutputLanguageSelector'
import {
  subtitleTrackLabel,
  type OutputLanguage,
} from '../core/language'

interface PrepareViewProps {
  metadata: VideoMetadata
  tracks: SubtitleTrack[]
  selectedTrackId: string
  trackSelection: 'auto' | string
  outputLanguage: OutputLanguage
  mode: 'high-fidelity' | 'refined'
  includeTimestamps: boolean
  onTrackSelectionChange: (selection: 'auto' | string) => void
  onOutputLanguageChange: (language: OutputLanguage) => void
  onModeChange: (mode: 'high-fidelity' | 'refined') => void
  onTimestampsChange: (v: boolean) => void
  onStart: () => void
  showAction?: boolean
  actionLabel?: string
  modelStatus?: ModelConnectionStatus
}

export function PrepareView({
  metadata,
  tracks,
  selectedTrackId,
  trackSelection,
  outputLanguage,
  mode,
  includeTimestamps,
  onTrackSelectionChange,
  onOutputLanguageChange,
  onModeChange,
  onTimestampsChange,
  onStart,
  showAction = true,
  actionLabel = '开始生成',
  modelStatus = 'missing',
}: PrepareViewProps) {
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId)
  return (
    <div className="prepare-view">
      <VideoCard
        metadata={metadata}
        subtitle={selectedTrack ? `字幕：${subtitleTrackLabel(selectedTrack)}` : '未识别字幕'}
      />

      <section className="settings-section" aria-labelledby="generation-settings-title">
        <div className="section-heading">
          <h2 id="generation-settings-title">生成设置</h2>
          <p>选择最终文档语言和内容处理方式</p>
        </div>

        <OutputLanguageSelector
          value={outputLanguage}
          onChange={onOutputLanguageChange}
        />

        <ModeSelector
          value={mode}
          sourceLanguage={selectedTrack?.language ?? 'zh'}
          outputLanguage={outputLanguage}
          modelStatus={modelStatus}
          onChange={onModeChange}
        />

        <section className="setting-group" aria-labelledby="other-settings-title">
          <div className="setting-group__heading">
            <h3 id="other-settings-title">其他选项</h3>
          </div>
          <div className="auxiliary-settings">
            <label className="toggle-setting">
              <span className="toggle-setting__copy">
                <strong>保留时间戳</strong>
                <small>在正文中添加可跳转的视频时间点</small>
              </span>
              <input
                className="toggle-switch"
                aria-label="保留时间戳"
                type="checkbox"
                checked={includeTimestamps}
                onChange={(event) => onTimestampsChange(event.target.checked)}
              />
            </label>

            <details className="subtitle-source">
              <summary>
                <span>字幕来源</span>
                <span>{selectedTrack ? subtitleTrackLabel(selectedTrack) : '自动选择'}</span>
              </summary>
              <div className="subtitle-source__body">
                <label htmlFor="track-select">选择用于提取的字幕</label>
                <select
                  id="track-select"
                  aria-label="字幕来源"
                  value={trackSelection}
                  onChange={(event) => onTrackSelectionChange(event.target.value)}
                >
                  <option value="auto">自动选择（推荐）</option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {subtitleTrackLabel(track)}
                    </option>
                  ))}
                </select>
                <p>一般无需修改。自动模式会根据输出语言和字幕质量选择合适轨道。</p>
              </div>
            </details>
          </div>
        </section>
      </section>

      {showAction && (
        <Button variant="primary" fullWidth onClick={onStart}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
