import type { ReactNode } from 'react'

interface AppHeaderProps {
  title?: string
  eyebrow?: string
  leading?: ReactNode
  action?: ReactNode
}

export function AppHeader({
  title = 'Video to Markdown',
  eyebrow,
  leading,
  action,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__main">
        {leading}
        <div className="app-header__titles">
          {eyebrow && <p className="app-header__eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
      </div>
      {action && <div className="app-header__action">{action}</div>}
    </header>
  )
}
