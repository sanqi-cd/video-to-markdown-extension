import type { ReactNode } from 'react'

interface BottomActionBarProps {
  children: ReactNode
  hint?: string
}

export function BottomActionBar({ children, hint }: BottomActionBarProps) {
  return (
    <div className="bottom-action-bar" data-layout="bottom-action-bar">
      {hint && <p className="bottom-action-bar__hint">{hint}</p>}
      <div className="bottom-action-bar__actions">{children}</div>
    </div>
  )
}
