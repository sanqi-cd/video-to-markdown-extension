import type { ReactNode } from 'react'

interface SettingRowProps {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}

export function SettingRow({ label, description, htmlFor, children }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-row__copy">
        {htmlFor
          ? <label htmlFor={htmlFor} className="setting-row__label">{label}</label>
          : <span className="setting-row__label">{label}</span>}
        {description && <p className="setting-row__description">{description}</p>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  )
}
