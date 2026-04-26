import { memo } from 'react'

interface PriceCellProps {
  price: number
  changePercent: number
  isGreen: boolean
}

export const PriceCell = memo(function PriceCell({
  price,
  changePercent,
  isGreen,
}: PriceCellProps) {
  const color = isGreen ? 'var(--color-bullish)' : 'var(--color-bearish)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '8px',
        minWidth: '100px',
      }}
    >
      <div
        style={{
          textAlign: 'right',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '2px',
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            fontWeight: '600',
            color: 'var(--text-primary)',
            animation: `priceFlash 0.6s ease-out`,
          }}
        >
          {price.toFixed(2)}
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            padding: '2px 6px',
            borderRadius: '4px',
            background: `${color}22`,
            color: color,
            fontWeight: '600',
          }}
        >
          {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
        </span>
      </div>
    </div>
  )
})
