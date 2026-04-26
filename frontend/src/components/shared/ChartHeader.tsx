interface ChartHeaderProps {
  symbol: string
  exchange: string
  lastPrice: number | null
  dayChangePct: number | null
  volume: number | null
  onBack: () => void
}

function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '--'
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtVolume(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '--'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K'
  return v.toFixed(0)
}

export function ChartHeader({
  symbol,
  exchange,
  lastPrice,
  dayChangePct,
  volume,
  onBack,
}: ChartHeaderProps) {
  const isUp = dayChangePct != null && dayChangePct >= 0
  const changeColor = isUp ? 'var(--color-bullish)' : 'var(--color-bearish)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '56px',
        padding: '0 16px',
        borderBottom: '1px solid var(--border-color)',
        gap: '16px',
      }}
    >
      {/* Left: Back button + symbol */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            border: 'none',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'background 200ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--border-color-active)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)'
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {symbol}
          </h2>
        </div>
      </div>

      {/* Center: Price + change % */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <strong
          style={{
            fontSize: '1.2rem',
            fontFamily: 'monospace',
            color: 'var(--text-primary)',
          }}
        >
          {fmt(lastPrice)}
        </strong>
        <small
          style={{
            fontSize: '0.8rem',
            color: changeColor,
            fontWeight: 600,
          }}
        >
          {dayChangePct != null ? `${dayChangePct >= 0 ? '+' : ''}${dayChangePct.toFixed(2)}%` : '--'}
        </small>
      </div>

      {/* Right: Exchange badge + volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontWeight: 600,
            }}
          >
            {exchange}
          </span>
          <small style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Vol: {fmtVolume(volume)}
          </small>
        </div>
      </div>
    </div>
  )
}
