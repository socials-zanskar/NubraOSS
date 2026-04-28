import { useEffect, useMemo, useState } from 'react'
import { useVolumeBreakoutWS, type DebugLog } from '../../hooks/useVolumeBreakoutWS'
import { useScanner } from '../../contexts/ScannerContext'
import { ScannerTable } from '../shared/ScannerTable'
import { DebugPanel } from './DebugPanel'

const SESSION_STORAGE_KEY = 'nubraoss.session'

interface StoredSession {
  access_token: string
  device_id: string
  environment: 'PROD' | 'UAT'
}

function loadStoredSession(): StoredSession | null {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function buildInitParams(
  session: StoredSession | null,
  filters: { interval: string; minVolumeRatio: number; universe: string },
): Record<string, unknown> | null {
  if (!session) return null
  return {
    session_token: session.access_token,
    device_id: session.device_id,
    environment: session.environment,
    interval: filters.interval,
    min_volume_ratio: filters.minVolumeRatio,
    universe_slug: `volume-dashboard-liquidity-${filters.universe}`,
    universe_mode: filters.universe === 'nifty300' ? 'top300' : 'top120',
  }
}

export function ScannerPanel() {
  const { filters, updateScannerData, isCachedSnapshot, lastUpdateTime, isPartialScan } = useScanner()
  const [wsEnabled, setWsEnabled] = useState(true)
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([])

  const session = useMemo(() => loadStoredSession(), [])

  const [initParams, setInitParams] = useState<Record<string, unknown> | null>(() =>
    buildInitParams(session, filters),
  )

  const { wsState, gapFill } = useVolumeBreakoutWS(wsEnabled, initParams, (payload) => {
    updateScannerData(payload)
  }, undefined, (log) => {
    setDebugLogs((prev) => {
      const newLogs = [...prev, log]
      return newLogs.slice(-50)
    })
  })

  useEffect(() => {
    setInitParams(buildInitParams(session, filters))
  }, [filters, session])

  const gapFillPercent = gapFill?.pct_complete ?? 0
  const isConnecting = wsState === 'connecting'
  const isConnected = wsState === 'connected'
  const hasError = wsState === 'error'

  if (!session) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '32px',
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Session Required
        </div>
        <div style={{ fontSize: '0.875rem', textAlign: 'center' }}>
          Please log in to use the Volume Breakout scanner.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: '8px',
        padding: '12px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-primary)' }}>
          Volume Breakout
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {isConnected && !gapFill && !isCachedSnapshot && <span style={{ color: 'var(--color-bullish)' }}>● Live</span>}
          {isConnecting && <span style={{ color: 'var(--color-primary)' }}>⟳ Connecting</span>}
          {hasError && <span style={{ color: 'var(--color-bearish)' }}>✕ Error</span>}
          {isCachedSnapshot && <span style={{ color: 'var(--color-warning)' }}>⟳ Updating</span>}
        </div>
      </div>

      {/* Progress bar during gap-fill */}
      {gapFill && (
        <div style={{ height: '3px', background: 'rgba(59, 130, 246, 0.2)', borderRadius: '2px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              background: 'var(--color-primary)',
              width: `${gapFillPercent}%`,
              transition: 'width 200ms ease',
            }}
          />
        </div>
      )}

      {/* Table */}
      <div
        style={{
          flex: 1,
          minHeight: '0',
          position: 'relative',
          opacity: isPartialScan ? 0.7 : 1,
          transition: 'opacity 200ms ease',
        }}
      >
        <ScannerTable />
        {isPartialScan && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '12px 20px',
              borderRadius: '4px',
              fontSize: '0.875rem',
              whiteSpace: 'nowrap',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div
              style={{
                animation: 'spin 1.5s linear infinite',
              }}
            >
              ⟳
            </div>
            Updating leaders...
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <DebugPanel logs={debugLogs} isOpen={debugOpen} onToggle={() => setDebugOpen(!debugOpen)} />
    </div>
  )
}
