interface ProgressBarProps {
  value: number
  max: number
  label: string
  showValue?: boolean
}

export function ProgressBar({ value, max, label, showValue = false }: ProgressBarProps) {
  const safeMax = Math.max(1, max)
  const safeValue = Math.min(Math.max(0, value), safeMax)
  const percent = Math.round((safeValue / safeMax) * 100)

  return (
    <div className="progress-bar">
      <div
        className="progress-bar__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
      >
        <span className="progress-bar__value" style={{ width: `${percent}%` }} />
      </div>
      {showValue && <span className="progress-bar__label">{percent}%</span>}
    </div>
  )
}
