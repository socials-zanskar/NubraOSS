import { memo, useMemo } from 'react'

interface SparklineProps {
  prices: number[]
  symbol: string
  size?: { width: number; height: number }
}

export const Sparkline = memo(function Sparkline({
  prices,
  symbol,
  size = { width: 60, height: 24 },
}: SparklineProps) {
  const { pathD, color } = useMemo(() => {
    if (!prices || prices.length === 0) {
      return { pathD: '', color: 'var(--color-neutral)' }
    }

    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const range = max - min || 1

    const width = size.width
    const height = size.height
    const padding = 2

    const points = prices.map((price, idx) => {
      const x = (idx / (prices.length - 1 || 1)) * (width - padding * 2) + padding
      const y = height - padding - ((price - min) / range) * (height - padding * 2)
      return `${x},${y}`
    })

    const pathD = `M ${points.join(' L ')}`
    const isGreen = prices[prices.length - 1] >= prices[0]
    const color = isGreen ? 'var(--color-bullish)' : 'var(--color-bearish)'

    return { pathD, color }
  }, [prices, size])

  return (
    <svg
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      style={{ display: 'block' }}
      aria-label={`${symbol} last ${prices.length} closes`}
    >
      <path
        d={pathD}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
})
