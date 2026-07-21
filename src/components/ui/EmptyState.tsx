import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  children?: ReactNode
  tone?: 'neutral' | 'loading' | 'error' | 'success'
}

export function EmptyState({
  title,
  description,
  icon,
  children,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <section
      className={`empty-state empty-state--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'loading' ? 'polite' : undefined}
    >
      {icon && <div className="empty-state__icon" aria-hidden="true">{icon}</div>}
      <div className="empty-state__copy">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="empty-state__details">{children}</div>}
    </section>
  )
}
