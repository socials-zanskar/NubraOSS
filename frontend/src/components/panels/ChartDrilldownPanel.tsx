import { useEffect, useMemo, useState } from 'react'
import { useScanner } from '../../contexts/ScannerContext'
import { useScalperLive } from '../../hooks/useScalperLive'
import ScalperLiveChart from '../ScalperLiveChart'
import { ChartHeader } from '../shared/ChartHeader'
import { ChartStatsTable } from '../shared/ChartStatsTable'

interface SuccessResponse {
  access_token: string
  device_id: string
  environment: 'PROD' | 'UAT'
}

interface ChartDrilldownPanelProps {
  symbol: string
}

function loadStoredSession(): SuccessResponse | null {
  try {
    const stored = localStorage.getItem('nubraoss.session')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function ChartDrilldownPanel({ symbol }: ChartDrilldownPanelProps) {
  const { scannerData, filters, clearSelectedSymbol } = useScanner()
  const [reconnectNonce, setReconnectNonce] = useState(0)

  const session = loadStoredSession()
  const rowData = useMemo(() => {
    return scannerData.find((row) => row.symbol === symbol)
  }, [scannerData, symbol])

  useEffect(() => {
    setReconnectNonce((prev) => prev + 1)
  }, [symbol])

  const approxStrike = Math.max(1, Math.round(rowData?.lastPrice ?? 1))

  const { status, error, connected, panelMeta, registerPanel } = useScalperLive({
    enabled: !!session && !!symbol,
    session_token: session?.access_token || '',
    device_id: session?.device_id || '',
    environment: session?.environment || 'PROD',
    underlying: symbol,
    exchange: rowData?.exchange || 'NSE',
    interval: filters.interval,
    ce_strike_price: approxStrike,
    pe_strike_price: approxStrike,
    expiry: null,
    lookback_days: 5,
    reconnect_nonce: reconnectNonce,
  })

  const underlyingData = panelMeta?.underlying
  const isConnecting = !connected && !error
  const hasError = !!error

  const handleBack = () => {
    clearSelectedSymbol()
  }

  return (
    <div
      className="chart-drilldown-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-color)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <ChartHeader
        symbol={symbol}
        exchange={rowData?.exchange || 'NSE'}
        lastPrice={underlyingData?.last_price || rowData?.lastPrice || null}
        dayChangePct={rowData?.dayChangePct || null}
        volume={rowData?.currentVolume || null}
        onBack={handleBack}
      />

      {/* Error Banner */}
      {hasError && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderLeft: '4px solid var(--color-bearish)',
            color: 'var(--color-bearish)',
            fontSize: '0.875rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--color-bearish)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Status Message */}
      {isConnecting && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(59, 130, 246, 0.1)',
            borderLeft: '4px solid var(--color-primary)',
            color: 'var(--color-primary)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div style={{ animation: 'spin 1s linear infinite' }}>⟳</div>
          <span>{status || 'Connecting to live data...'}</span>
        </div>
      )}

      {/* Chart Container */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '16px',
          overflow: 'auto',
        }}
      >
        {underlyingData && (
          <ScalperLiveChart
            panel="underlying"
            accent="blue"
            title={symbol}
            displayName={underlyingData.display_name}
            lastPrice={underlyingData.last_price}
            interval={underlyingData.interval}
            exchange={underlyingData.exchange}
            height={340}
            onSeriesReady={registerPanel}
          />
        )}
      </div>

      {/* Stats Table */}
      {underlyingData && !hasError && (
        <ChartStatsTable
          avgVolume={rowData?.averageVolume || null}
          priceBreakoutLevel={rowData?.priceBreakoutPct ? rowData.lastPrice * (1 + rowData.priceBreakoutPct / 100) : null}
          resistanceLevel={null}
          supportLevel={null}
          volumeTrend={[]}
        />
      )}
    </div>
  )
}
