import { useState, type FormEvent } from 'react'
import { Button } from './ui/Button'

interface ManualYouTubeSourceFormProps {
  onSubmit: (url: string) => Promise<void>
  compact?: boolean
}

export function ManualYouTubeSourceForm({
  onSubmit,
  compact = false,
}: ManualYouTubeSourceFormProps) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = url.trim()
    if (value.length === 0 || status === 'loading') return
    setError(null)
    setStatus('loading')
    try {
      await onSubmit(value)
      setStatus('success')
    } catch (cause) {
      setStatus('idle')
      setError(cause instanceof Error ? cause.message : '原视频字幕读取失败')
    }
  }

  return (
    <form
      className={[
        'manual-youtube-source',
        compact ? 'manual-youtube-source--compact' : '',
      ].filter(Boolean).join(' ')}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="manual-youtube-source__heading">
        <strong>使用 YouTube 原视频字幕</strong>
        <span>仅支持完整的 YouTube 视频链接，不会自动猜测其他视频。</span>
      </div>
      <label htmlFor={compact ? 'manual-youtube-url-compact' : 'manual-youtube-url'}>
        YouTube 原视频链接
      </label>
      <div className="manual-youtube-source__controls">
        <input
          id={compact ? 'manual-youtube-url-compact' : 'manual-youtube-url'}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          disabled={status === 'loading'}
          aria-describedby={error ? 'manual-youtube-source-error' : undefined}
          onChange={(event) => {
            setUrl(event.target.value)
            setError(null)
            if (status === 'success') setStatus('idle')
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={url.trim().length === 0 || status === 'loading'}
        >
          {status === 'loading' ? '正在检测…' : '读取字幕'}
        </Button>
      </div>
      {error && (
        <p id="manual-youtube-source-error" className="manual-youtube-source__error" role="alert">
          {error}
        </p>
      )}
      {status === 'success' && (
        <p className="manual-youtube-source__success" role="status">
          原视频字幕已加载，并已切换到该字幕来源。
        </p>
      )}
    </form>
  )
}
