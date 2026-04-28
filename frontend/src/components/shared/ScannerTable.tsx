import { memo, useMemo, useState } from 'react'
import { PriceCell } from './PriceCell'
import { VolumeRatioBar } from './VolumeRatioBar'
import { ConfidenceBadge } from './ConfidenceBadge'
import { Sparkline } from './Sparkline'
import { useScanner } from '../../contexts/ScannerContext'

interface ScannerTableRow {
  symbol: string
  displayName: string
  exchange: string
  lastPrice: number
  currentVolume: number
  averageVolume: number
  volumeRatio: number
  dayChangePct: number
  isGreen: boolean
  isPriceBreakout: boolean
  meetsBreakout: boolean
  baselineDays: number
  sparklinePrices: number[]
}

type SortColumn = 'symbol' | 'price' | 'dayChg' | 'volumeRatio' | 'sparkline'
type SortOrder = 'asc' | 'desc'

interface SortConfig {
  column: SortColumn
  order: SortOrder
}

const ScannerTableRow = memo(function ScannerTableRow({
  row,
  onRowClick,
}: {
  row: ScannerTableRow
  onRowClick: (symbol: string) => void
}) {
  const { setSelectedSymbol } = useScanner()

  const handleRowClick = () => {
    setSelectedSymbol(row.symbol)
    onRowClick(row.symbol)
  }

  return (
    <div
      className="scanner-table-row"
      onClick={handleRowClick}
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(0, 1.1fr) minmax(0, 0.8fr) 75px minmax(0, 1.3fr) minmax(0, 1fr)',
        gap: '8px',
        alignItems: 'center',
        padding: '6px 12px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-primary)'
      }}
    >
      {/* Symbol */}
      <div style={{ minWidth: '0' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: '600' }}>
          {row.symbol}
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem', marginTop: '2px' }}>
          {row.displayName}
        </div>
      </div>

      {/* Price */}
      <div>
        <PriceCell price={row.lastPrice} changePercent={row.dayChangePct} isGreen={row.isGreen} />
      </div>

      {/* Day Chg % */}
      <div
        style={{
          textAlign: 'right',
          color: row.isGreen ? 'var(--color-bullish)' : 'var(--color-bearish)',
          fontSize: '0.875rem',
          fontWeight: '600',
          fontFamily: 'monospace',
        }}
      >
        {(row.dayChangePct ?? 0) >= 0 ? '+' : ''}{(row.dayChangePct ?? 0).toFixed(2)}%
      </div>

      {/* Volume Ratio */}
      <div>
        <VolumeRatioBar
          volumeRatio={row.volumeRatio}
          percentile={Math.min(row.volumeRatio * 10, 100)}
        />
      </div>

      {/* Price Breakout Status */}
      <div>
        <ConfidenceBadge
          isPriceBreakout={row.isPriceBreakout}
          meetVolumeRatio={row.meetsBreakout}
        />
      </div>

      {/* Sparkline */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Sparkline prices={row.sparklinePrices} symbol={row.symbol} size={{ width: 50, height: 20 }} />
      </div>
    </div>
  )
})

export const ScannerTable = memo(function ScannerTable() {
  const { scannerData, searchFilter } = useScanner()
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    column: 'volumeRatio',
    order: 'desc',
  })

  const filteredAndSortedData = useMemo(() => {
    let filtered = scannerData.filter((row) => {
      const searchLower = searchFilter.toLowerCase()
      return (
        row.symbol.toLowerCase().includes(searchLower) ||
        (row.displayName?.toLowerCase().includes(searchLower) ?? false)
      )
    })

    filtered.sort((a, b) => {
      let aVal: number | string = 0
      let bVal: number | string = 0

      switch (sortConfig.column) {
        case 'symbol':
          aVal = a.symbol
          bVal = b.symbol
          break
        case 'price':
          aVal = a.lastPrice
          bVal = b.lastPrice
          break
        case 'dayChg':
          aVal = a.dayChangePct ?? 0
          bVal = b.dayChangePct ?? 0
          break
        case 'volumeRatio':
          aVal = a.volumeRatio
          bVal = b.volumeRatio
          break
        case 'sparkline':
          aVal = a.sparklinePrices[a.sparklinePrices.length - 1] ?? 0
          bVal = b.sparklinePrices[b.sparklinePrices.length - 1] ?? 0
          break
      }

      const cmp = typeof aVal === 'string' ? aVal.localeCompare(String(bVal)) : aVal - (bVal as number)
      return sortConfig.order === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [scannerData, sortConfig, searchFilter])

  const handleColumnClick = (column: SortColumn) => {
    setSortConfig((prev) => ({
      column,
      order: prev.column === column && prev.order === 'asc' ? 'desc' : 'asc',
    }))
  }

  const getSortIndicator = (column: SortColumn) => {
    if (sortConfig.column !== column) return ''
    return sortConfig.order === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: '0',
      }}
    >

      {/* Table Container */}
      <div
        className="scanner-table-shell"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
          minHeight: '200px',
        }}
      >
        {/* Table Header */}
        <div
          className="scanner-table-header"
          style={{
            display: 'grid',
            gridTemplateColumns:
              'minmax(0, 1.1fr) minmax(0, 0.8fr) 75px minmax(0, 1.3fr) minmax(0, 1fr)',
            gap: '8px',
            alignItems: 'center',
            padding: '8px 12px',
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-color)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => handleColumnClick('symbol')}
            style={{
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              cursor: 'pointer',
              padding: '0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
            }}
          >
            Symbol{getSortIndicator('symbol')}
          </button>

          <button
            onClick={() => handleColumnClick('price')}
            style={{
              textAlign: 'right',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              cursor: 'pointer',
              padding: '0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
            }}
          >
            Price{getSortIndicator('price')}
          </button>

          <button
            onClick={() => handleColumnClick('dayChg')}
            style={{
              textAlign: 'right',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              cursor: 'pointer',
              padding: '0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
            }}
          >
            Day %{getSortIndicator('dayChg')}
          </button>

          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Volume Ratio
          </div>

          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Status
          </div>

          <button
            onClick={() => handleColumnClick('sparkline')}
            style={{
              textAlign: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: '700',
              cursor: 'pointer',
              padding: '0',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              transition: 'color 120ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
            }}
          >
            Chart{getSortIndicator('sparkline')}
          </button>
        </div>

        {/* Table Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {filteredAndSortedData.length > 0 ? (
            filteredAndSortedData.map((row) => (
              <ScannerTableRow
                key={row.symbol}
                row={{
                  ...row,
                  dayChangePct: row.dayChangePct ?? 0,
                }}
                onRowClick={() => {
                  /* Handler for chart drilldown in Phase 3 */
                }}
              />
            ))
          ) : (
            <div
              style={{
                padding: '32px 14px',
                textAlign: 'center',
                color: 'var(--text-tertiary)',
                fontSize: '0.875rem',
              }}
            >
              No breakouts found
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
