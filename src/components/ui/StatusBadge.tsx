import type { HTMLAttributes, ReactNode } from 'react'

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'error'
  children: ReactNode
}

export function StatusBadge({ tone = 'neutral', className, children, ...props }: StatusBadgeProps) {
  return (
    <span
      className={['status-badge', `status-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </span>
  )
}
