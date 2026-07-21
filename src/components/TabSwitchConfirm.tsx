import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { ActiveTabSnapshot } from '../browser/active-tab'
import { Button } from './ui/Button'
import { StatusBadge } from './ui/StatusBadge'

interface TabSwitchConfirmProps {
  nextTab: ActiveTabSnapshot
  onContinueCurrent: () => void
  onStopAndSwitch: () => void
}

export function TabSwitchConfirm({
  nextTab,
  onContinueCurrent,
  onStopAndSwitch,
}: TabSwitchConfirmProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const switchRef = useRef<HTMLButtonElement>(null)
  const target = nextTab.video
    ? `${nextTab.video.platform === 'youtube' ? 'YouTube' : '哔哩哔哩'}视频`
    : '当前非视频页面'

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    continueRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onContinueCurrent()
      return
    }
    if (event.key !== 'Tab') return
    const first = continueRef.current
    const last = switchRef.current
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="confirm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tab-switch-title"
        aria-describedby="tab-switch-description"
        onKeyDown={handleKeyDown}
      >
        <StatusBadge tone="warning">检测到页面变化</StatusBadge>
        <div className="confirm-sheet__copy">
          <h2 id="tab-switch-title">要切换到新页面吗？</h2>
          <p id="tab-switch-description">
            当前内容仍与原视频关联。切换会停止当前任务并加载{target}。
          </p>
        </div>
        <div className="confirm-sheet__actions">
          <Button ref={continueRef} variant="secondary" fullWidth onClick={onContinueCurrent}>
            继续当前任务
          </Button>
          <Button ref={switchRef} variant="primary" fullWidth onClick={onStopAndSwitch}>
            停止并加载新视频
          </Button>
        </div>
      </section>
    </div>
  )
}
