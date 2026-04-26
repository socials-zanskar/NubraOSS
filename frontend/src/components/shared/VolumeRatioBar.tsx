import { memo, useMemo } from 'react'

interface VolumeRatioBarProps {
  volumeRatio: number
  percentile: number
}

export const VolumeRatioBar = memo(function VolumeRatioBar({
  volumeRatio,
  percentile,
}: VolumeRatioBarProps) {
  const barColor = useMemo(() => {
    if (percentile >= 90) return 'var(--color-accent)'
    if (percentile >= 70) return 'var(--color-bearish)'
    if (percentile >= 50) return 'var(--color-alert)'
    return 'var(--color-neutral)'
  }, [percentile])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minWidth: '140px',
      }}
    >
      <div style={{ flex: 1, minWidth: '0' }}>
        <div
          style={{
            height: '8px',
            background: 'var(--bg-tertiary)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: barColor,
              width: `${Math.min(percentile, 100)}%`,
              animation: `barGrow 300ms ease-out`,
            }}
          />
        </div>
      </div>
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: '600',
          color: barColor,
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
          minWidth: '36px',
          textAlign: 'right',
        }}
      >
        {volumeRatio.toFixed(2)}x
      </span>
    </div>
  )
})
