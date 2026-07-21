import type { ReactNode } from 'react'

interface AppShellProps {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export function AppShell({ header, children, footer }: AppShellProps) {
  return (
    <div className="app-shell" data-layout="app-shell">
      {header}
      <main
        className={[
          'app-shell__content',
          footer ? 'app-shell__content--with-footer' : '',
        ].filter(Boolean).join(' ')}
      >
        {children}
      </main>
      {footer && <footer className="app-shell__footer">{footer}</footer>}
    </div>
  )
}
