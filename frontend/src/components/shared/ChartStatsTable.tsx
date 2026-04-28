interface ChartStatsTableProps {
  avgVolume: number | null
  priceBreakoutLevel: number | null
  resistanceLevel: number | null
  supportLevel: number | null
  volumeTrend: number[]
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

export function ChartStatsTable({
  avgVolume,
  priceBreakoutLevel,
  resistanceLevel,
  supportLevel,
  volumeTrend,
}: ChartStatsTableProps) {
  const maxVolume = volumeTrend.length > 0 ? Math.max(...volumeTrend) : 1

  return (
    <div
      style={{
        padding: '16px',
        borderTop: '1px solid var(--border-color)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Average Volume */}
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            AVG VOLUME
          </small>
          <div style={{ marginTop: '6px', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {fmtVolume(avgVolume)}
          </div>
        </div>

        {/* Price Breakout Level */}
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            BREAKOUT LEVEL
          </small>
          <div style={{ marginTop: '6px', fontSize: '1rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
            {fmt(priceBreakoutLevel)}
          </div>
        </div>

        {/* Resistance (52w high) */}
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            RESISTANCE (52W HIGH)
          </small>
          <div style={{ marginTop: '6px', fontSize: '1rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
            {fmt(resistanceLevel)}
          </div>
        </div>

        {/* Support (52w low) */}
        <div
          style={{
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            SUPPORT (52W LOW)
          </small>
          <div style={{ marginTop: '6px', fontSize: '1rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
            {fmt(supportLevel)}
          </div>
        </div>
      </div>

      {/* Volume Trend Sparkline */}
      {volumeTrend.length > 0 && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
          }}
        >
          <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600 }}>
            VOLUME TREND (LAST 5 DAYS)
          </small>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '4px',
              height: '40px',
              marginTop: '10px',
            }}
          >
            {volumeTrend.map((vol, idx) => (
              <div
                key={idx}
                style={{
                  flex: 1,
                  height: `${maxVolume > 0 ? (vol / maxVolume) * 100 : 0}%`,
                  background: 'var(--color-primary)',
                  borderRadius: '2px',
                  minHeight: '2px',
                }}
                title={fmtVolume(vol)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
