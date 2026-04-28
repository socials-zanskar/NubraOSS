import { memo, useMemo } from 'react'

interface ConfidenceBadgeProps {
  isPriceBreakout: boolean
  meetVolumeRatio: boolean
  isNew?: boolean
}

export const ConfidenceBadge = memo(function ConfidenceBadge({
  isPriceBreakout,
  meetVolumeRatio,
  isNew = false,
}: ConfidenceBadgeProps) {
  const { label, color, bgColor } = useMemo(() => {
    if (isPriceBreakout && meetVolumeRatio) {
      return { label: 'Confirmed', color: 'var(--color-bullish)', bgColor: 'rgba(16, 185, 129, 0.1)' }
    }
    if (meetVolumeRatio) {
      return { label: 'Early', color: 'var(--color-alert)', bgColor: 'rgba(245, 158, 11, 0.1)' }
    }
    return { label: '-', color: 'var(--color-neutral)', bgColor: 'transparent' }
  }, [isPriceBreakout, meetVolumeRatio])

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: '6px',
        background: bgColor,
        color: color,
        fontSize: '0.75rem',
        fontWeight: '600',
        animation: isNew ? 'pulse 5s ease-in-out' : 'none',
      }}
    >
      {label}
    </span>
  )
})
