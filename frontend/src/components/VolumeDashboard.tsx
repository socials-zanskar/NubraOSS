import { useEffect, useMemo, useRef, useState } from 'react'
import { DATA_ENVIRONMENT } from '../constants/environment'
import { useVolumeBreakoutWS } from '../hooks/useVolumeBreakoutWS'
import { useVolumeQuotesWS, type VolumeLiveQuote } from '../hooks/useVolumeQuotesWS'
import type { GapFillProgress } from '../hooks/useVolumeBreakoutWS'
import '../volume-dashboard.css'

type Interval = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1h'
type TradingViewAction = 'BUY' | 'SELL'
type OrderDeliveryType = 'ORDER_DELIVERY_TYPE_CNC' | 'ORDER_DELIVERY_TYPE_IDAY'

const API_BASE_URL = ''
const SESSION_STORAGE_KEY = 'nubraoss.session'
const VOLUME_BREAKOUT_CACHE_KEY = 'nubraoss.volume-breakout-cache'
const VOLUME_PANEL_LIMITS = {
  opportunityMap: 36,
  leaders: 6,
  confirmed: 12,
  moversTable: 20,
} as const
const VOLUME_EXCLUDED_SYMBOL_TOKENS = ['BEES', 'ETF', 'LIQUID', 'GILT', 'SDL', 'NIFTY', 'SENSEX']
const VOLUME_MIN_AVERAGE_VOLUME = 1000
const VOLUME_MIN_CURRENT_VOLUME = 1000
const VOLUME_MIN_AVERAGE_TRADED_VALUE = 2_500_000


interface VolumeBreakoutStockRow {
  symbol: string
  display_name: string
  exchange: string
  sector?: string | null
  industry?: string | null
  candle_time_ist: string
  last_price: number
  current_volume: number
  average_volume: number
  volume_ratio: number
  price_change_pct: number | null
  day_change_pct: number | null
  price_breakout_pct: number | null
  is_green: boolean
  is_price_breakout: boolean
  meets_breakout: boolean
  baseline_days: number
}

interface VolumeBreakoutStatus {
  running: boolean
  universe_slug: string
  universe_mode?: 'top120' | 'top300' | 'all_nse'
  universe_label?: string
  interval: Interval
  lookback_days: number
  refresh_seconds: number
  min_volume_ratio: number
  universe_size: number
  sync: {
    db_enabled: boolean
    cache_mode: 'database' | 'memory'
    universe_ready: boolean
    symbols_synced: number
    symbols_missing_history: number
    history_range_ist: string | null
    last_history_sync_ist: string | null
    next_refresh_ist: string | null
  }
  last_run_ist: string | null
  next_run_ist: string | null
  last_error: string | null
  summary: {
    tracked_stocks: number
    active_breakouts: number
    fresh_breakouts: number
    leaders_with_price_breakout: number
    latest_candle_ist: string | null
    market_status: string
  }
  market_breakouts: VolumeBreakoutStockRow[]
  recent_breakouts: VolumeBreakoutStockRow[]
  confirmed_breakouts: VolumeBreakoutStockRow[]
  movers_up: VolumeBreakoutStockRow[]
  movers_down: VolumeBreakoutStockRow[]
  sector_heatmap_rows?: VolumeBreakoutStockRow[]
}

interface VolumeBreakoutDrilldownPoint {
  time_ist: string
  close: number
  volume: number
}

interface VolumeBreakoutDrilldownResponse {
  symbol: string
  display_name: string
  exchange: string
  sector?: string | null
  interval: Interval
  latest_candle_ist: string | null
  baseline_average_volume: number | null
  points: VolumeBreakoutDrilldownPoint[]
}

interface VolumeBreakoutStartResponse {
  status: string
  message: string
  job: VolumeBreakoutStatus
}

interface ApiErrorPayload {
  detail?: unknown
  message?: unknown
  error?: unknown
}

interface ScannerOrderPreviewResponse {
  status: 'success'
  message: string
  environment: 'PROD' | 'UAT'
  symbol: string
  instrument_display_name: string
  exchange: 'NSE' | 'BSE'
  instrument_ref_id: number
  order_side: 'ORDER_SIDE_BUY' | 'ORDER_SIDE_SELL'
  requested_qty: number
  order_qty: number
  lot_size: number
  tick_size: number
  ltp_price: number
  preview_limit_price: number
  estimated_order_value: number
  order_delivery_type: OrderDeliveryType
  tag: string
}

interface ScannerOrderSubmitResponse {
  status: 'success'
  message: string
  order_id: number | null
  order_status: string | null
  order_side: 'ORDER_SIDE_BUY' | 'ORDER_SIDE_SELL'
  requested_qty: number
  order_qty: number
  order_price: number | null
  instrument_display_name: string
  symbol: string
  environment: 'PROD' | 'UAT'
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatCompactVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '--'
  if (Math.abs(value) >= 10000000) return `${(value / 10000000).toFixed(2)}Cr`
  if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(2)}L`
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}K`
  return value.toFixed(0)
}

function formatPercentDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatCompactNumberDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)}Cr`
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(2)}L`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function logVolumeFrontend(event: string, detail?: Record<string, unknown>) {
  console.debug(`[volume-breakout][ui] ${event}`, detail ?? {})
}

function extractErrorMessage(payload: ApiErrorPayload | null | undefined, fallback: string): string {
  if (!payload) return fallback
  const detail = payload.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0]
    if (typeof first === 'string' && first.trim()) return first
    if (first && typeof first === 'object' && 'msg' in first && typeof first.msg === 'string' && first.msg.trim()) return first.msg
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return fallback
}

function loadStoredVolumeBreakoutStatus(): VolumeBreakoutStatus | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(VOLUME_BREAKOUT_CACHE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as VolumeBreakoutStatus
  } catch {
    window.localStorage.removeItem(VOLUME_BREAKOUT_CACHE_KEY)
    return null
  }
}

function hasRenderableVolumeSnapshot(status: VolumeBreakoutStatus | null): boolean {
  if (!status) return false
  return (
    status.summary.tracked_stocks > 0 ||
    status.market_breakouts.length > 0 ||
    status.recent_breakouts.length > 0 ||
    status.confirmed_breakouts.length > 0 ||
    status.movers_up.length > 0 ||
    status.movers_down.length > 0
  )
}

function isQualityVolumeRow(row: VolumeBreakoutStockRow): boolean {
  const symbol = row.symbol.toUpperCase()
  if (VOLUME_EXCLUDED_SYMBOL_TOKENS.some((token) => symbol.includes(token))) return false
  if (row.average_volume < VOLUME_MIN_AVERAGE_VOLUME) return false
  if (row.current_volume < VOLUME_MIN_CURRENT_VOLUME) return false
  if (row.average_volume * row.last_price < VOLUME_MIN_AVERAGE_TRADED_VALUE) return false
  return true
}

function VolumeSummarySkeletonCard() {
  return (
    <article className="dashboard-module-card compact-card skeleton-card" aria-hidden="true">
      <span className="summary-label skeleton-line skeleton-line-label" />
      <span className="skeleton-line skeleton-line-value" />
      <span className="skeleton-line skeleton-line-copy" />
      <span className="skeleton-line skeleton-line-copy short" />
    </article>
  )
}

function VolumeTableSkeleton({
  gridClassName,
  columns,
  rows = 6,
}: {
  gridClassName: string
  columns: string[]
  rows?: number
}) {
  return (
    <div className="table-shell volume-table-skeleton" aria-hidden="true">
      <div className={`table-row table-head ${gridClassName}`}>
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={`skeleton-row-${rowIndex}`} className={`table-row ${gridClassName} skeleton-row`}>
          {columns.map((column, columnIndex) => (
            <span
              key={`${column}-${rowIndex}`}
              className={`skeleton-line ${columnIndex === 0 ? 'skeleton-line-copy' : 'skeleton-line-chip'}${columnIndex === columns.length - 1 ? ' short' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function getVolumeOpportunityState(row: VolumeBreakoutStockRow, freshSymbols: Set<string>): 'confirmed' | 'fresh' | 'weak' | 'neutral' {
  if (row.is_price_breakout) return 'confirmed'
  if (freshSymbols.has(row.symbol)) return 'fresh'
  if ((row.day_change_pct ?? 0) < 0) return 'weak'
  return 'neutral'
}

function getReadableSetupLabel(row: VolumeBreakoutStockRow, freshSymbols: Set<string>): string {
  if (row.is_price_breakout) return 'Confirmed breakout'
  if (freshSymbols.has(row.symbol)) return 'New this cycle'
  if ((row.day_change_pct ?? 0) < 0) return 'Weak participation'
  return 'Active volume'
}

function getVolumeOpportunityColor(state: 'confirmed' | 'fresh' | 'weak' | 'neutral'): string {
  if (state === 'confirmed') return '#16a34a'
  if (state === 'fresh') return '#d4a017'
  if (state === 'weak') return '#dc2626'
  return '#315efb'
}

function OpportunityMap({
  rows,
  freshSymbols,
  selectedSymbol,
  onSelect,
}: {
  rows: VolumeBreakoutStockRow[]
  freshSymbols: Set<string>
  selectedSymbol: string | null
  onSelect: (symbol: string) => void
}) {
  const width = 820
  const height = 250
  const padLeft = 50
  const padRight = 26
  const padTop = 10
  const padBottom = 34

  if (rows.length === 0) {
    return <div className="table-empty">No symbols available for the opportunity map yet.</div>
  }

  const xValues = rows.map((row) => row.day_change_pct ?? 0).sort((a, b) => a - b)
  const yValues = rows.map((row) => row.volume_ratio).sort((a, b) => a - b)
  const volumeValues = rows.map((row) => row.current_volume)
  const xQuantile = xValues[Math.max(Math.floor(xValues.length * 0.9) - 1, 0)] ?? 1
  const xMinQuantile = xValues[Math.min(Math.floor(xValues.length * 0.1), Math.max(xValues.length - 1, 0))] ?? -1
  const xExtent = Math.max(Math.abs(xQuantile), Math.abs(xMinQuantile), 2.5)
  const xMin = -xExtent
  const xMax = xExtent
  const yUpper = yValues[Math.max(Math.floor(yValues.length * 0.95) - 1, 0)] ?? Math.max(...yValues, 2)
  const yMin = 0.4
  const yCap = Math.max(3.2, Math.min(yUpper * 1.18, 12))
  const yMinScaled = Math.log1p(yMin)
  const yMaxScaled = Math.log1p(yCap)
  const volumeMax = Math.max(...volumeValues, 1)
  const safeXMax = xMax === xMin ? xMax + 1 : xMax
  const safeYSpan = Math.max(yMaxScaled - yMinScaled, 0.1)
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const breakoutLine = 1.5
  const xZero = padLeft + clamp((0 - xMin) / (safeXMax - xMin), 0, 1) * plotWidth
  const yBreakout = padTop + (1 - clamp((Math.log1p(breakoutLine) - yMinScaled) / safeYSpan, 0, 1)) * plotHeight
  const leftWidth = Math.max(xZero - padLeft, 0)
  const rightWidth = Math.max(width - padRight - xZero, 0)
  const topHeight = Math.max(yBreakout - padTop, 0)
  const bottomHeight = Math.max(height - padBottom - yBreakout, 0)
  return (
    <div className="volume-opportunity-map">
      <div className="volume-map-legend">
        <span><i className="legend-dot confirmed" /> Confirmed breakout</span>
        <span><i className="legend-dot fresh" /> Fresh spike</span>
        <span><i className="legend-dot neutral" /> Active volume</span>
        <span><i className="legend-dot weak" /> Weak setup</span>
        <span className="volume-map-note">Bubble size = current volume</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="volume-map-svg" role="img" aria-label="Volume opportunity map">
        <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} rx="18" className="volume-map-surface" />
        <clipPath id="volume-map-clip">
          <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} rx="18" />
        </clipPath>
        <g clipPath="url(#volume-map-clip)">
          <rect x={padLeft} y={padTop} width={leftWidth} height={topHeight} className="volume-map-zone watch" />
          <rect x={xZero} y={padTop} width={rightWidth} height={topHeight} className="volume-map-zone best" />
          <rect x={padLeft} y={yBreakout} width={leftWidth} height={bottomHeight} className="volume-map-zone weak" />
          <rect x={xZero} y={yBreakout} width={rightWidth} height={bottomHeight} className="volume-map-zone momentum" />
        </g>
        {Array.from({ length: 4 }).map((_, index) => {
          const y = padTop + (plotHeight / 3) * index
          return <line key={`grid-y-${index}`} x1={padLeft} y1={y} x2={width - padRight} y2={y} className="volume-map-grid" />
        })}
        {Array.from({ length: 5 }).map((_, index) => {
          const x = padLeft + (plotWidth / 4) * index
          return <line key={`grid-x-${index}`} x1={x} y1={padTop} x2={x} y2={height - padBottom} className="volume-map-grid" />
        })}
        <line x1={xZero} y1={padTop} x2={xZero} y2={height - padBottom} className="volume-map-axis" />
        <line x1={padLeft} y1={yBreakout} x2={width - padRight} y2={yBreakout} className="volume-map-axis" />
        <text x={padLeft} y={padTop - 6} className="volume-map-label">Higher RVOL</text>
        <text x={padLeft + 16} y={padTop + 24} className="volume-map-zone-label">Watch: volume first</text>
        <text x={width - padRight - 16} y={padTop + 24} textAnchor="end" className="volume-map-zone-label best">Breakout zone</text>
        <text x={padLeft + 16} y={height - padBottom - 18} className="volume-map-zone-label weak">Weak tape</text>
        <text x={width - padRight - 16} y={height - padBottom - 18} textAnchor="end" className="volume-map-zone-label momentum">Momentum only</text>
        <text x={padLeft} y={height - 16} className="volume-map-label">Weaker day momentum</text>
        <text x={width - padRight} y={height - 16} textAnchor="end" className="volume-map-label">Stronger day momentum</text>
        <g className="volume-map-threshold-pill">
          <rect x={width - padRight - 142} y={yBreakout - 18} width="136" height="18" rx="9" />
          <text x={width - padRight - 74} y={yBreakout - 5} textAnchor="middle">RVOL threshold</text>
        </g>
        {rows.map((row) => {
          const x = padLeft + (clamp((row.day_change_pct ?? 0), xMin, xMax) - xMin) / (safeXMax - xMin) * plotWidth
          const scaledYValue = Math.log1p(Math.min(Math.max(row.volume_ratio, yMin), yCap))
          const y = padTop + (1 - (scaledYValue - yMinScaled) / safeYSpan) * plotHeight
          const state = getVolumeOpportunityState(row, freshSymbols)
          const color = getVolumeOpportunityColor(state)
          const radius = 6 + Math.sqrt(row.current_volume / volumeMax) * 16
          const isSelected = row.symbol === selectedSymbol
          const labelY = Math.max(padTop + 14, y - radius - 6)
          const prefersRightLabel = x < padLeft + 96
          const prefersLeftLabel = x > width - padRight - 96
          const labelX = prefersRightLabel ? x + radius + 8 : prefersLeftLabel ? x - radius - 8 : x
          const labelAnchor = prefersRightLabel ? 'start' : prefersLeftLabel ? 'end' : 'middle'
          return (
            <g key={`bubble-${row.symbol}`} onClick={() => onSelect(row.symbol)} className="volume-map-point">
              <circle cx={x} cy={y} r={radius} fill={color} opacity={isSelected ? 0.92 : 0.72} stroke={isSelected ? '#0f172a' : '#ffffff'} strokeWidth={isSelected ? 2.5 : 1.2}>
                <title>{`${row.symbol} | Price ${formatPrice(row.last_price)} | RVOL ${row.volume_ratio.toFixed(2)}x | Day ${formatPercentDisplay(row.day_change_pct)} | Baseline ${row.baseline_days}d | ${row.candle_time_ist}`}</title>
              </circle>
              {isSelected && (
                <text x={labelX} y={labelY} textAnchor={labelAnchor} className="volume-map-point-label">
                  {row.symbol}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function VolumeSparkline({
  points,
  accent,
}: {
  points: VolumeBreakoutDrilldownPoint[]
  accent: string
}) {
  if (points.length < 2) {
    return <div className="leader-sparkline-empty">Awaiting bars</div>
  }
  const width = 100
  const height = 34
  const values = points.map((point) => point.close)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = Math.max(maxValue - minValue, 1)
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width
      const y = height - ((point.close - minValue) / range) * (height - 4) - 2
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="leader-sparkline" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VolumeDrilldownChart({ drilldown }: { drilldown: VolumeBreakoutDrilldownResponse | null }) {
  if (!drilldown || drilldown.points.length === 0) {
    return <div className="table-empty">Select a leader to inspect its recent price and volume rhythm.</div>
  }

  const points = drilldown.points
  const width = 360
  const height = 220
  const volumeHeight = 58
  const values = points.map((point) => point.close)
  const volumes = points.map((point) => point.volume)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = Math.max(maxValue - minValue, 1)
  const maxVolume = Math.max(...volumes, drilldown.baseline_average_volume ?? 0, 1)
  const pricePath = points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width
      const y = height - volumeHeight - ((point.close - minValue) / range) * (height - volumeHeight - 20) - 12
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const baselineY =
    drilldown.baseline_average_volume !== null
      ? height - ((drilldown.baseline_average_volume / maxVolume) * (volumeHeight - 8)) - 4
      : null

  return (
    <div className="volume-drilldown-chart">
      <div className="volume-drilldown-meta">
        <div>
          <span className="summary-label">Drilldown</span>
          <h3>{drilldown.display_name}</h3>
          <small>{drilldown.symbol} â€¢ {drilldown.exchange} â€¢ {drilldown.interval}{drilldown.sector ? ` â€¢ ${drilldown.sector}` : ''}</small>
        </div>
        <div className="volume-drilldown-stats">
          <span className="pill">Latest: {drilldown.latest_candle_ist ?? '--'}</span>
          <span className="pill">Baseline vol: {formatCompactNumberDisplay(drilldown.baseline_average_volume)}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="volume-drilldown-svg" preserveAspectRatio="none" aria-label={`${drilldown.symbol} price and volume drilldown`}>
        {Array.from({ length: 4 }).map((_, index) => {
          const y = 18 + ((height - volumeHeight - 28) / 3) * index
          return <line key={`price-grid-${index}`} x1="0" y1={y} x2={width} y2={y} className="volume-map-grid" />
        })}
        {points.map((point, index) => {
          const step = width / Math.max(points.length, 1)
          const x = step * index + step * 0.18
          const barHeight = (point.volume / maxVolume) * (volumeHeight - 8)
          return (
            <rect
              key={`${point.time_ist}-${index}`}
              x={x}
              y={height - barHeight - 4}
              width={Math.max(step * 0.62, 1.4)}
              height={Math.max(barHeight, 1)}
              rx="1.2"
              className="volume-drilldown-bar"
            />
          )
        })}
        {baselineY !== null ? (
          <line x1="0" y1={baselineY} x2={width} y2={baselineY} className="volume-drilldown-baseline" />
        ) : null}
        <path d={pricePath} fill="none" stroke="#315efb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="volume-drilldown-footer">
        <span>{points[0]?.time_ist ?? '--'}</span>
        <span>{points[Math.floor(points.length / 2)]?.time_ist ?? '--'}</span>
        <span>{points[points.length - 1]?.time_ist ?? '--'}</span>
      </div>
    </div>
  )
}

function SelectedVolumeSnapshot({
  row,
  freshSymbols,
  latestCandle,
  quote,
}: {
  row: VolumeBreakoutStockRow | null
  freshSymbols: Set<string>
  latestCandle: string | null | undefined
  quote?: VolumeLiveQuote | null
}) {
  if (!row) {
    return <div className="table-empty">Select a leader to inspect its live snapshot.</div>
  }

  const displayPrice = quote?.last_price ?? row.last_price
  const isLive = quote?.source === 'websocket'
  const setupLabel = getReadableSetupLabel(row, freshSymbols)
  const chartUrl = `https://nubra.io/dashboard/overview/stocks/${encodeURIComponent(row.symbol)}?exchange=${encodeURIComponent(row.exchange)}`

  return (
    <div className={`volume-drilldown-shell selected-volume-card${isLive ? ' quote-live-pulse' : ''}`}>
      <div className="volume-drilldown-header">
        <div>
          <span className="summary-label">Selected Leader</span>
          <h3>{row.symbol}</h3>
          <p>{formatPrice(displayPrice)} - {row.volume_ratio.toFixed(2)}x RVOL{row.sector ? ` - ${row.sector}` : ''}</p>
        </div>
        <a
          className="ghost-inline volume-open-chart"
          href={chartUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open Chart
        </a>
      </div>
      <div className="volume-drilldown-chart">
        <div className="selected-volume-metrics">
          <div>
            <span>LTP</span>
            <strong>{formatPrice(displayPrice)}</strong>
          </div>
          <div>
            <span>Day</span>
            <strong className={(row.day_change_pct ?? 0) >= 0 ? 'tone-positive' : 'tone-negative'}>{formatPercentDisplay(row.day_change_pct)}</strong>
          </div>
          <div>
            <span>RVOL</span>
            <strong>{row.volume_ratio.toFixed(2)}x</strong>
          </div>
          <div>
            <span>Volume</span>
            <strong>{formatCompactNumberDisplay(row.current_volume)}</strong>
          </div>
          <div>
            <span>Setup</span>
            <strong>{setupLabel}</strong>
          </div>
          <div>
            <span>Breakout</span>
            <strong>{row.is_price_breakout ? formatPercentDisplay(row.price_breakout_pct) : 'Not yet'}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function VolumeTradeTicket({
  row,
  quote,
  liveState,
  liveStatus,
  executionEnvironment,
  executionSessionToken,
  executionDeviceId,
  hasExecutionSession,
  onExecutionEnvironmentSelect,
}: {
  row: VolumeBreakoutStockRow | null
  quote?: VolumeLiveQuote | null
  liveState: string
  liveStatus: string
  executionEnvironment: 'PROD' | 'UAT'
  executionSessionToken: string
  executionDeviceId: string
  hasExecutionSession: boolean
  onExecutionEnvironmentSelect: (environment: 'PROD' | 'UAT', returnContext?: VolumeAuthReturnContext) => void
}) {
  const [side, setSide] = useState<TradingViewAction>('BUY')
  const [quantity, setQuantity] = useState('1')
  const [product, setProduct] = useState<OrderDeliveryType>('ORDER_DELIVERY_TYPE_IDAY')
  const [preview, setPreview] = useState<ScannerOrderPreviewResponse | null>(null)
  const [busyState, setBusyState] = useState<'preview' | 'submit' | null>(null)
  const [orderError, setOrderError] = useState('')
  const [orderMessage, setOrderMessage] = useState('')

  const qty = Math.max(1, Number(quantity) || 1)
  const price = quote?.last_price ?? row?.last_price ?? 0
  const estimatedValue = price * qty
  const isLive = quote?.source === 'websocket'
  const executionReady = executionEnvironment === 'PROD' || hasExecutionSession
  const executionStatusLabel = executionReady
    ? `${executionEnvironment} ready`
    : `${executionEnvironment} auth required`
  const orderSide = side === 'BUY' ? 'ORDER_SIDE_BUY' : 'ORDER_SIDE_SELL'
  const isPreviewing = busyState === 'preview'
  const isSubmitting = busyState === 'submit'
  const previewButtonLabel = !executionReady
    ? `Authenticate ${executionEnvironment}`
    : (isPreviewing ? 'Preparing preview...' : 'Preview Order')
  const submitButtonLabel = isSubmitting
    ? `Placing ${executionEnvironment} order...`
    : `Place ${executionEnvironment} Order`

  useEffect(() => {
    setPreview(null)
    setOrderError('')
    setOrderMessage('')
  }, [row?.symbol, executionEnvironment, side, qty, product, price])

  if (!row) return null

  async function handlePreviewOrder() {
    if (!row) return
    if (!executionReady) {
      onExecutionEnvironmentSelect(executionEnvironment, { scannerSymbol: row.symbol, focusScannerTicket: true })
      return
    }
    if (!executionSessionToken || !executionDeviceId) {
      setOrderError(`Authenticate your ${executionEnvironment} execution session before previewing this order.`)
      return
    }
    setBusyState('preview')
    setOrderError('')
    setOrderMessage('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/scanner/order-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: executionSessionToken,
          device_id: executionDeviceId,
          environment: executionEnvironment,
          symbol: row.symbol,
          instrument_display_name: row.display_name,
          exchange: row.exchange,
          order_side: orderSide,
          quantity: qty,
          ltp_price: price,
          order_delivery_type: product,
        }),
      })
      const data = (await response.json()) as ScannerOrderPreviewResponse | ApiErrorPayload
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Scanner order preview is not available on the running backend yet. Restart the backend server and try again.')
        }
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to preview the scanner order.'))
      }
      const result = data as ScannerOrderPreviewResponse
      setPreview(result)
      setOrderMessage(result.message)
    } catch (err) {
      setPreview(null)
      setOrderError(err instanceof Error ? err.message : 'Unable to preview the scanner order.')
    } finally {
      setBusyState(null)
    }
  }

  async function handlePlaceOrder() {
    if (!preview) {
      void handlePreviewOrder()
      return
    }
    if (!executionSessionToken || !executionDeviceId) {
      setOrderError(`Authenticate your ${executionEnvironment} execution session before placing this order.`)
      return
    }
    setBusyState('submit')
    setOrderError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/scanner/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: executionSessionToken,
          device_id: executionDeviceId,
          environment: executionEnvironment,
          symbol: preview.symbol,
          instrument_display_name: preview.instrument_display_name,
          exchange: preview.exchange,
          instrument_ref_id: preview.instrument_ref_id,
          order_side: preview.order_side,
          quantity: preview.requested_qty,
          lot_size: preview.lot_size,
          tick_size: preview.tick_size,
          ltp_price: preview.ltp_price,
          order_delivery_type: preview.order_delivery_type,
          tag: preview.tag,
        }),
      })
      const data = (await response.json()) as ScannerOrderSubmitResponse | ApiErrorPayload
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Scanner order placement is not available on the running backend yet. Restart the backend server and try again.')
        }
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to place the scanner order.'))
      }
      const result = data as ScannerOrderSubmitResponse
      setOrderMessage(`${result.message} Order ${result.order_id ?? ''} ${result.order_status ?? ''}`.trim())
      setPreview(null)
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Unable to place the scanner order.')
    } finally {
      setBusyState(null)
    }
  }

  return (
    <div className={`volume-trade-ticket${isLive ? ' quote-live-pulse' : ''}`}>
      <div className="volume-ticket-head">
        <div>
          <span className="summary-label">Trade Ticket</span>
          <h3>{side} {row.symbol}</h3>
          <p>{isLive ? 'Live LTP connected' : 'Using scanner cache until live quote arrives'}</p>
        </div>
        <span className={isLive ? 'pill pill-success' : 'pill'}>
          {liveState === 'connected' ? 'Quote live' : 'Quote warming'}
        </span>
      </div>

      <div className="volume-ticket-routing-row">
        <div className="volume-ticket-routing-copy">
          <span>Execution environment</span>
          <strong>{executionStatusLabel}</strong>
        </div>
        <div className="volume-ticket-env-toggle" role="tablist" aria-label="Scanner execution environment">
          <button
            type="button"
            className={executionEnvironment === 'PROD' ? 'active' : ''}
            onClick={() => onExecutionEnvironmentSelect('PROD')}
          >
            PROD
          </button>
          <button
            type="button"
            className={executionEnvironment === 'UAT' ? 'active' : ''}
            onClick={() => onExecutionEnvironmentSelect('UAT', { scannerSymbol: row.symbol, focusScannerTicket: true })}
          >
            UAT
          </button>
        </div>
      </div>

      <div className="volume-ticket-price">
        <span>LTP</span>
        <strong>{formatPrice(price)}</strong>
        <small>{quote?.updated_at_ist ?? row.candle_time_ist}</small>
      </div>

      <div className="volume-ticket-controls">
        <div className="volume-side-toggle" role="group" aria-label="Order side">
          <button type="button" className={side === 'BUY' ? 'active buy' : ''} onClick={() => setSide('BUY')}>Buy</button>
          <button type="button" className={side === 'SELL' ? 'active sell' : ''} onClick={() => setSide('SELL')}>Sell</button>
        </div>
        <label>
          Qty
          <input value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/\D/g, '') || '1')} />
        </label>
        <label>
          Product
          <select value={product} onChange={(event) => setProduct(event.target.value as OrderDeliveryType)}>
            <option value="ORDER_DELIVERY_TYPE_IDAY">Intraday</option>
            <option value="ORDER_DELIVERY_TYPE_CNC">CNC</option>
          </select>
        </label>
      </div>

      <div className="volume-ticket-locked-strip">
        <div>
          <span>{preview ? 'Preview limit value' : 'Estimated value'}</span>
          <strong>{formatPrice(preview ? preview.estimated_order_value : estimatedValue)}</strong>
        </div>
        <div className="volume-ticket-action-group">
          <button
            type="button"
            className="secondary-button volume-ticket-secondary"
            disabled={busyState !== null}
            title={executionReady ? 'Prepare a fresh order preview' : `Authenticate ${executionEnvironment} first`}
            onClick={() => {
              if (!executionReady) {
                onExecutionEnvironmentSelect(executionEnvironment, { scannerSymbol: row.symbol, focusScannerTicket: true })
                return
              }
              void handlePreviewOrder()
            }}
          >
            {previewButtonLabel}
          </button>
          <button
            type="button"
            className={`primary-button volume-ticket-action${executionEnvironment === 'PROD' ? ' prod' : ''}`}
            disabled={!executionReady || !preview || busyState !== null}
            title={!preview ? 'Preview the order first to unlock placement' : `Send a real ${executionEnvironment} order`}
            onClick={() => void handlePlaceOrder()}
          >
            {submitButtonLabel}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="volume-ticket-preview-card">
          <div className="volume-ticket-preview-head">
            <strong>Preview ready</strong>
            <span>{preview.environment} execution</span>
          </div>
          <div className="volume-ticket-preview-grid">
            <span>{preview.instrument_display_name}</span>
            <strong>{side} {preview.order_qty}</strong>
            <span>Limit</span>
            <strong>{formatPrice(preview.preview_limit_price)}</strong>
            <span>Requested qty</span>
            <strong>{preview.requested_qty}</strong>
            <span>Normalized qty</span>
            <strong>{preview.order_qty}</strong>
            <span>Product</span>
            <strong>{preview.order_delivery_type === 'ORDER_DELIVERY_TYPE_IDAY' ? 'Intraday' : 'CNC'}</strong>
            <span>Est. order value</span>
            <strong>{formatPrice(preview.estimated_order_value)}</strong>
          </div>
          <div className="volume-ticket-preview-actions">
            <button type="button" className="secondary-button volume-ticket-secondary" onClick={() => setPreview(null)} disabled={busyState !== null}>
              Edit Ticket
            </button>
            <button type="button" className="secondary-button volume-ticket-secondary" onClick={() => void handlePreviewOrder()} disabled={busyState !== null}>
              Refresh Preview
            </button>
          </div>
        </div>
      ) : null}
      <p className="volume-ticket-note">
        {executionReady
          ? (preview
            ? 'Review the preview carefully. The confirm button will send a real order using the selected execution session.'
            : 'Preview Order is active now. Place Order unlocks immediately after a fresh preview.')
          : `Authenticate your ${executionEnvironment} execution session to unlock routing controls for this ticket.`}
      </p>
      {orderError ? <p className="volume-ticket-note volume-ticket-note-error">{orderError}</p> : null}
      {orderMessage ? <p className="volume-ticket-note volume-ticket-note-success">{orderMessage}</p> : null}
      {liveStatus ? <p className="volume-ticket-note">{liveStatus}</p> : null}
    </div>
  )
}

function MoversArrowChart({
  moversUp,
  moversDown,
  quotes,
  onSelectSymbol,
}: {
  moversUp: VolumeBreakoutStockRow[]
  moversDown: VolumeBreakoutStockRow[]
  quotes: Record<string, VolumeLiveQuote>
  onSelectSymbol: (symbol: string) => void
}) {
  const [hovered, setHovered] = useState<VolumeBreakoutStockRow | null>(null)
  const upRows = moversUp.slice(0, 20)
  const downRows = moversDown.slice(0, 20)
  const chartRows = [...upRows, ...downRows]

  if (chartRows.length === 0) {
    return <div className="table-empty">No mover data yet.</div>
  }

  const width = 980
  const height = 320
  const padLeft = 44
  const padRight = 44
  const padTop = 48
  const padBottom = 46
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom
  const centerX = padLeft + plotWidth / 2
  const maxAbsMove = Math.max(
    ...chartRows.map((row) => Math.abs(row.day_change_pct ?? 0)),
    1.5,
  )
  const baselineY = height - padBottom
  const mountainHalfWidth = plotWidth / 2 - 32
  const upBarWidth = upRows.length > 0 ? Math.min(26, mountainHalfWidth / Math.max(upRows.length, 1) - 4) : 18
  const downBarWidth = downRows.length > 0 ? Math.min(26, mountainHalfWidth / Math.max(downRows.length, 1) - 4) : 18
  const activeRow = hovered ?? upRows[0] ?? downRows[0] ?? null
  const activeQuote = activeRow ? quotes[activeRow.symbol] ?? null : null

  return (
    <div className="movers-arrow-chart-shell">
      <div className="movers-arrow-chart-summary">
        {activeRow ? (
          <>
            <div>
              <span className="summary-label">Hovered Mover</span>
              <strong>{activeRow.symbol}</strong>
              <small>
                {activeRow.display_name} â€¢ {activeRow.exchange}
                {activeRow.sector ? ` â€¢ ${activeRow.sector}` : ''}
              </small>
            </div>
            <div className="movers-arrow-chart-chips">
              <span className={(activeRow.day_change_pct ?? 0) >= 0 ? 'pill pill-success' : 'pill pill-danger'}>
                Day {formatPercentDisplay(activeRow.day_change_pct)}
              </span>
              <span className="pill">RVOL {activeRow.volume_ratio.toFixed(2)}x</span>
              <span className={activeQuote?.source === 'websocket' ? 'pill pill-success' : 'pill'}>
                LTP {formatPrice(activeQuote?.last_price ?? activeRow.last_price)}
              </span>
              <span className="pill">Vol {formatCompactNumberDisplay(activeRow.current_volume)}</span>
              <span className="pill">Time {activeRow.candle_time_ist}</span>
            </div>
          </>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="movers-arrow-chart" role="img" aria-label="Combined movers chart">
        <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} rx="18" className="volume-map-surface" />
        <line x1={padLeft} y1={baselineY} x2={width - padRight} y2={baselineY} className="volume-map-axis" />
        <line x1={centerX} y1={padTop} x2={centerX} y2={baselineY} className="volume-map-axis movers-arrow-centerline" />
        <text x={padLeft} y={padTop - 14} className="volume-map-label">Top 20 losers</text>
        <text x={width - padRight} y={padTop - 14} textAnchor="end" className="volume-map-label">Top 20 gainers</text>
        <text x={centerX - 12} y={height - 14} textAnchor="end" className="volume-map-label">Down</text>
        <text x={centerX + 12} y={height - 14} className="volume-map-label">Up</text>

        {downRows.map((row, index) => {
          const progress = index / Math.max(downRows.length - 1, 1)
          const x = centerX - 18 - downBarWidth - progress * (mountainHalfWidth - downBarWidth)
          const isHovered = hovered?.symbol === row.symbol
          const rawHeight = (Math.abs(row.day_change_pct ?? 0) / maxAbsMove) * (plotHeight - 26)
          const barHeight = Math.max(isHovered ? rawHeight + 8 : rawHeight, 18)
          const labelY = baselineY - barHeight - 8
          const shouldLabel = isHovered || index < 2
          return (
            <g
              key={`mover-down-${row.symbol}-${row.candle_time_ist}`}
              className="movers-arrow-point"
              onMouseEnter={() => setHovered(row)}
              onMouseLeave={() => setHovered((current) => (current?.symbol === row.symbol ? null : current))}
              onClick={() => onSelectSymbol(row.symbol)}
            >
              <rect
                x={x}
                y={baselineY - barHeight}
                width={downBarWidth}
                height={barHeight}
                rx="10"
                className="movers-arrow-bar down"
              />
              {shouldLabel ? (
                <text x={x + downBarWidth / 2} y={Math.max(padTop + 10, labelY)} textAnchor="middle" className="movers-arrow-label">
                  {row.symbol}
                </text>
              ) : null}
            </g>
          )
        })}

        {upRows.map((row, index) => {
          const progress = index / Math.max(upRows.length - 1, 1)
          const x = centerX + 18 + progress * (mountainHalfWidth - upBarWidth)
          const isHovered = hovered?.symbol === row.symbol
          const rawHeight = (Math.abs(row.day_change_pct ?? 0) / maxAbsMove) * (plotHeight - 26)
          const barHeight = Math.max(isHovered ? rawHeight + 8 : rawHeight, 18)
          const labelY = baselineY - barHeight - 8
          const shouldLabel = isHovered || index < 2
          return (
            <g
              key={`mover-up-${row.symbol}-${row.candle_time_ist}`}
              className="movers-arrow-point"
              onMouseEnter={() => setHovered(row)}
              onMouseLeave={() => setHovered((current) => (current?.symbol === row.symbol ? null : current))}
              onClick={() => onSelectSymbol(row.symbol)}
            >
              <rect
                x={x}
                y={baselineY - barHeight}
                width={upBarWidth}
                height={barHeight}
                rx="10"
                className="movers-arrow-bar up"
              />
              {shouldLabel ? (
                <text x={x + upBarWidth / 2} y={Math.max(padTop + 10, labelY)} textAnchor="middle" className="movers-arrow-label">
                  {row.symbol}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SectorHeatmap({
  rows,
  freshSymbols,
  onSelectSectorSymbol,
}: {
  rows: VolumeBreakoutStockRow[]
  freshSymbols: Set<string>
  onSelectSectorSymbol: (symbol: string) => void
}) {
  const sectorTaggedRows = rows.filter((row) => row.sector?.trim() && row.sector.trim().toLowerCase() !== 'other')
  const sectors = Array.from(
    sectorTaggedRows.reduce((acc, row) => {
      const sectorName = row.sector?.trim() || 'Other'
      const bucket = acc.get(sectorName) ?? []
      bucket.push(row)
      acc.set(sectorName, bucket)
      return acc
    }, new Map<string, VolumeBreakoutStockRow[]>()),
  )
    .map(([sector, sectorRows]) => {
      const avgDay = sectorRows.reduce((sum, row) => sum + (row.day_change_pct ?? 0), 0) / sectorRows.length
      const avgRvol = sectorRows.reduce((sum, row) => sum + row.volume_ratio, 0) / sectorRows.length
      const leader = [...sectorRows].sort((a, b) => b.volume_ratio - a.volume_ratio)[0]
      return { sector, rows: sectorRows, avgDay, avgRvol, leader }
    })
    .sort((a, b) => b.avgRvol - a.avgRvol)
    .slice(0, 8)

  if (sectors.length < 3) {
    return <div className="table-empty">Sector tiles will appear once enough sector-tagged leaders are available.</div>
  }

  return (
    <div className="sector-heatmap-grid">
      {sectors.map((sector) => {
        const heat = clamp(Math.abs(sector.avgDay) / 6, 0.15, 1)
        const background =
          sector.avgDay >= 0
            ? `linear-gradient(180deg, rgba(34,197,94,${0.08 + heat * 0.12}) 0%, rgba(240,253,244,0.92) 100%)`
            : `linear-gradient(180deg, rgba(239,68,68,${0.08 + heat * 0.12}) 0%, rgba(254,242,242,0.92) 100%)`
        return (
          <button
            key={sector.sector}
            type="button"
            className="sector-heatmap-tile"
            style={{ background }}
            onClick={() => onSelectSectorSymbol(sector.leader.symbol)}
          >
            <div className="sector-heatmap-head">
              <strong className="sector-heatmap-title">{sector.sector}</strong>
              <span className={sector.avgDay >= 0 ? 'sector-heatmap-change tone-positive' : 'sector-heatmap-change tone-negative'}>
                {formatPercentDisplay(sector.avgDay)}
              </span>
            </div>
            <div className="sector-heatmap-body">
              <span className="sector-heatmap-cell">{sector.rows.length} active names</span>
              <span className="sector-heatmap-cell sector-heatmap-cell-right">Avg RVOL {sector.avgRvol.toFixed(2)}x</span>
            </div>
            <div className="sector-heatmap-foot">
              <span className="sector-heatmap-cell">Leader {sector.leader.symbol}</span>
              <span className="sector-heatmap-cell sector-heatmap-cell-right">{getReadableSetupLabel(sector.leader, freshSymbols)}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}


interface VolumeDashboardSession {
  access_token: string
  device_id: string
  environment: 'PROD' | 'UAT'
  is_demo?: boolean
  broker: string
  user_name: string
  account_id: string
}

interface VolumeDashboardProps {
  session: VolumeDashboardSession
  executionEnvironment: 'PROD' | 'UAT'
  executionSessionToken: string
  executionDeviceId: string
  hasExecutionSession: boolean
  authReturnContext?: VolumeAuthReturnContext | null
  onAuthReturnContextConsumed?: () => void
  onExecutionEnvironmentSelect: (environment: 'PROD' | 'UAT', returnContext?: VolumeAuthReturnContext) => void
  onBack: () => void
  renderNav: (activeTab: string) => React.ReactNode
}

interface VolumeAuthReturnContext {
  scannerSymbol?: string
  focusScannerTicket?: boolean
}



export default function VolumeDashboard({
  session,
  executionEnvironment,
  executionSessionToken,
  executionDeviceId,
  hasExecutionSession,
  authReturnContext,
  onAuthReturnContextConsumed,
  onExecutionEnvironmentSelect,
  onBack,
  renderNav,
}: VolumeDashboardProps) {
  const derivedDeviceId = session.device_id || 'Nubra-OSS-default'


  const [volumeBreakoutStatus, setVolumeBreakoutStatus] = useState<VolumeBreakoutStatus | null>(() => loadStoredVolumeBreakoutStatus())
  const [volumeBreakoutMessage, setVolumeBreakoutMessage] = useState(
    'The dashboard syncs missing history quietly, then refreshes rankings on the configured interval.',
  )
  const [volumeBreakoutError, setVolumeBreakoutError] = useState('')
  const [volumeGapFill, setVolumeGapFill] = useState<GapFillProgress | null>(null)
  const [volumeBreakoutLoading, setVolumeBreakoutLoading] = useState<boolean>(() => !hasRenderableVolumeSnapshot(loadStoredVolumeBreakoutStatus()))
  const [volumeBreakoutRefreshing, setVolumeBreakoutRefreshing] = useState(false)
  const [selectedVolumeSymbol, setSelectedVolumeSymbol] = useState<string | null>(null)
  const [marketStatus, setMarketStatus] = useState<{
    is_open: boolean
    reason: string
    last_session_date: string
    next_open_ist: string
  } | null>(null)
  const [volumeEodMode, setVolumeEodMode] = useState(false)
  const volumeBreakoutStatusRef = useRef<VolumeBreakoutStatus | null>(volumeBreakoutStatus)
  const volumeActionPanelRef = useRef<HTMLElement | null>(null)


  function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  function formatCompactNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '-'
    if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)}Cr`
    if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(2)}L`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
    return value.toFixed(0)
  }


  const hasVolumeSnapshot = hasRenderableVolumeSnapshot(volumeBreakoutStatus)
  const showVolumeSkeleton = volumeBreakoutLoading && !hasVolumeSnapshot
  const showVolumeSoftRefresh = volumeBreakoutRefreshing && hasVolumeSnapshot
  const volumeMissingCache = volumeBreakoutStatus?.sync.symbols_missing_history ?? 0
  const volumeCoverageHealthy = volumeMissingCache === 0
  const volumeFreshSymbols = useMemo(
    () => new Set((volumeBreakoutStatus?.recent_breakouts ?? []).map((row) => row.symbol)),
    [volumeBreakoutStatus?.recent_breakouts],
  )
  const volumeOpportunityRows = useMemo(() => {
    const seen = new Set<string>()
    const combined = [
      ...(volumeBreakoutStatus?.market_breakouts ?? []),
      ...(volumeBreakoutStatus?.recent_breakouts ?? []),
      ...(volumeBreakoutStatus?.confirmed_breakouts ?? []),
      ...(volumeBreakoutStatus?.movers_up ?? []),
      ...(volumeBreakoutStatus?.movers_down ?? []),
    ].filter(isQualityVolumeRow)
    return combined
      .filter((row) => {
        if (seen.has(row.symbol)) return false
        seen.add(row.symbol)
        return true
      })
      .sort((a, b) => {
        const score = (r: VolumeBreakoutStockRow) =>
          (r.is_price_breakout ? 120 : 0) +
          (volumeFreshSymbols.has(r.symbol) ? 80 : 0) +
          (r.meets_breakout ? 25 : 0) +
          Math.min(r.volume_ratio, 10) * 12 +
          Math.abs(r.day_change_pct ?? 0) * 5
        return score(b) - score(a)
      })
      .slice(0, VOLUME_PANEL_LIMITS.opportunityMap)
  }, [
    volumeFreshSymbols,
    volumeBreakoutStatus?.market_breakouts,
    volumeBreakoutStatus?.recent_breakouts,
    volumeBreakoutStatus?.confirmed_breakouts,
    volumeBreakoutStatus?.movers_up,
    volumeBreakoutStatus?.movers_down,
  ])
  const volumeLeaderRows = useMemo(
    () => (volumeBreakoutStatus?.market_breakouts ?? []).filter(isQualityVolumeRow).slice(0, VOLUME_PANEL_LIMITS.leaders),
    [volumeBreakoutStatus?.market_breakouts],
  )
  const volumeAllQualityRows = useMemo(() => {
    const seen = new Set<string>()
    return [
      ...(volumeBreakoutStatus?.sector_heatmap_rows ?? []),
      ...(volumeBreakoutStatus?.market_breakouts ?? []),
      ...(volumeBreakoutStatus?.recent_breakouts ?? []),
      ...(volumeBreakoutStatus?.confirmed_breakouts ?? []),
      ...(volumeBreakoutStatus?.movers_up ?? []),
      ...(volumeBreakoutStatus?.movers_down ?? []),
    ]
      .filter(isQualityVolumeRow)
      .filter((row) => {
        if (seen.has(row.symbol)) return false
        seen.add(row.symbol)
        return true
      })
  }, [
    volumeBreakoutStatus?.sector_heatmap_rows,
    volumeBreakoutStatus?.market_breakouts,
    volumeBreakoutStatus?.recent_breakouts,
    volumeBreakoutStatus?.confirmed_breakouts,
    volumeBreakoutStatus?.movers_up,
    volumeBreakoutStatus?.movers_down,
  ])
  const confirmedDisplayRows = useMemo(
    () => (volumeBreakoutStatus?.confirmed_breakouts ?? []).filter(isQualityVolumeRow).slice(0, VOLUME_PANEL_LIMITS.confirmed),
    [volumeBreakoutStatus?.confirmed_breakouts],
  )
  const moversUpDisplayRows = useMemo(
    () => (volumeBreakoutStatus?.movers_up ?? []).filter(isQualityVolumeRow).slice(0, VOLUME_PANEL_LIMITS.moversTable),
    [volumeBreakoutStatus?.movers_up],
  )
  const moversDownDisplayRows = useMemo(
    () => (volumeBreakoutStatus?.movers_down ?? []).filter(isQualityVolumeRow).slice(0, VOLUME_PANEL_LIMITS.moversTable),
    [volumeBreakoutStatus?.movers_down],
  )
  const volumeSectorRows = useMemo(
    () => (volumeBreakoutStatus?.sector_heatmap_rows ?? volumeAllQualityRows).filter(isQualityVolumeRow),
    [volumeBreakoutStatus?.sector_heatmap_rows, volumeAllQualityRows],
  )
  const selectedVolumeRow = useMemo(
    () => volumeAllQualityRows.find((row) => row.symbol === selectedVolumeSymbol) ?? volumeLeaderRows[0] ?? volumeOpportunityRows[0] ?? null,
    [selectedVolumeSymbol, volumeAllQualityRows, volumeLeaderRows, volumeOpportunityRows],
  )
  const volumeQuoteSymbols = useMemo(() => {
    const symbols = new Set<string>()
    if (selectedVolumeRow?.symbol) symbols.add(selectedVolumeRow.symbol)
    for (const row of volumeLeaderRows.slice(0, 8)) symbols.add(row.symbol)
    for (const row of volumeOpportunityRows.slice(0, 8)) symbols.add(row.symbol)
    for (const row of moversUpDisplayRows.slice(0, 20)) symbols.add(row.symbol)
    for (const row of moversDownDisplayRows.slice(0, 20)) symbols.add(row.symbol)
    return Array.from(symbols).slice(0, 24)
  }, [selectedVolumeRow?.symbol, volumeLeaderRows, volumeOpportunityRows, moversUpDisplayRows, moversDownDisplayRows])
  const volumeQuotes = useVolumeQuotesWS({
    enabled: Boolean(session) && !session?.is_demo && volumeQuoteSymbols.length > 0,
    session_token: session?.access_token ?? '',
    device_id: derivedDeviceId,
    environment: DATA_ENVIRONMENT,
    symbols: volumeQuoteSymbols,
  })
  const selectedVolumeQuote = selectedVolumeRow ? volumeQuotes.quotes[selectedVolumeRow.symbol] ?? null : null
  const selectVolumeSymbolForTicket = (symbol: string) => {
    setSelectedVolumeSymbol(symbol)
    window.requestAnimationFrame(() => {
      volumeActionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  useEffect(() => {
    if (!authReturnContext) return
    if (authReturnContext.scannerSymbol) {
      setSelectedVolumeSymbol(authReturnContext.scannerSymbol)
    }
    if (authReturnContext.focusScannerTicket) {
      window.requestAnimationFrame(() => {
        volumeActionPanelRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' })
      })
    }
    onAuthReturnContextConsumed?.()
  }, [authReturnContext, onAuthReturnContextConsumed])


  const volumeInitParams = session
    ? {
        session_token: session.access_token,
        device_id: derivedDeviceId,
        environment: DATA_ENVIRONMENT,
        universe_mode: 'all_nse' as const,
        interval: '5m',
        lookback_days: 10,
        refresh_seconds: 30,
        min_volume_ratio: 1.5,
        limit: 50,
        universe_limit: 300,
        universe_slug: 'volume-dashboard-all-nse',
      }
    : null

  const { wsState: volumeWsState, gapFill: volumeGapFillFromWs } = useVolumeBreakoutWS(
    !!session && marketStatus?.is_open === true,
    marketStatus?.is_open === true ? volumeInitParams : null,
    (payload) => {
      logVolumeFrontend('status_from_ws', {
        summary: (payload as Record<string, unknown>).summary,
        sync: (payload as Record<string, unknown>).sync,
        last_error: (payload as Record<string, unknown>).last_error,
      })
      const nextStatus = payload as unknown as VolumeBreakoutStatus
      if (!hasRenderableVolumeSnapshot(nextStatus) && hasRenderableVolumeSnapshot(volumeBreakoutStatusRef.current)) {
        logVolumeFrontend('status_from_ws.skipped_empty_snapshot', {
          summary: (payload as Record<string, unknown>).summary,
          sync: (payload as Record<string, unknown>).sync,
        })
        return
      }
      setVolumeBreakoutStatus(payload as any)
    },
  )


  useEffect(() => {
    volumeBreakoutStatusRef.current = volumeBreakoutStatus
    if (typeof window === 'undefined') return
    if (volumeBreakoutStatus && hasRenderableVolumeSnapshot(volumeBreakoutStatus)) {
      window.localStorage.setItem(VOLUME_BREAKOUT_CACHE_KEY, JSON.stringify(volumeBreakoutStatus))
      return
    }
    if (!session) {
      window.localStorage.removeItem(VOLUME_BREAKOUT_CACHE_KEY)
    }
  }, [session, volumeBreakoutStatus])

  useEffect(() => {
    setVolumeGapFill(volumeGapFillFromWs)
    if (volumeGapFillFromWs) {
      logVolumeFrontend('gap_fill_progress', volumeGapFillFromWs as unknown as Record<string, unknown>)
    }
  }, [volumeGapFillFromWs])

  useEffect(() => {
    if (!session) {
      setMarketStatus(null)
      setVolumeEodMode(false)
      setVolumeBreakoutLoading(false)
      setVolumeBreakoutRefreshing(false)
      return
    }

    let cancelled = false

    async function checkMarketAndLoad() {
      const hasSnapshot = hasRenderableVolumeSnapshot(volumeBreakoutStatusRef.current)
      setVolumeBreakoutLoading(!hasSnapshot)
      setVolumeBreakoutRefreshing(hasSnapshot)
      setVolumeBreakoutMessage(
        hasSnapshot
          ? 'Showing your last cached volume snapshot while the dashboard refreshes quietly.'
          : 'Loading the latest volume snapshot and rebuilding the dashboard from cache.',
      )
      try {
        logVolumeFrontend('market_status_fetch.start')
        const res = await fetch('/api/system/market-status')
        if (!res.ok || cancelled) {
          if (!cancelled) {
            setVolumeBreakoutLoading(false)
            setVolumeBreakoutRefreshing(false)
          }
          return
        }
        const ms = await res.json()
        if (cancelled) return
        logVolumeFrontend('market_status_fetch.success', ms)
        setMarketStatus(ms)

        if (!ms.is_open && volumeInitParams) {
          setVolumeEodMode(true)
          logVolumeFrontend('eod_fetch.start')
          const eodRes = await fetch('/api/volume-breakout/eod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(volumeInitParams),
          })
          if (!eodRes.ok || cancelled) {
            if (!cancelled) {
              setVolumeBreakoutLoading(false)
              setVolumeBreakoutRefreshing(false)
            }
            return
          }
          const eodData = await eodRes.json()
          logVolumeFrontend('eod_fetch.success', {
            summary: eodData?.summary,
            sync: eodData?.sync,
          })
          if (!cancelled) setVolumeBreakoutStatus(eodData)
        } else {
          setVolumeEodMode(false)
          if (hasSnapshot && !cancelled) {
            setVolumeBreakoutRefreshing(false)
            setVolumeBreakoutMessage('Showing the last volume snapshot while the live feed reconnects.')
          }
        }
      } catch (error) {
        logVolumeFrontend('market_or_eod_fetch.error', {
          message: error instanceof Error ? error.message : String(error),
        })
        if (!cancelled) {
          setVolumeBreakoutLoading(false)
          setVolumeBreakoutRefreshing(false)
        }
      }
    }

    checkMarketAndLoad()
    return () => { cancelled = true }
  }, [session?.access_token])

  useEffect(() => {
    if (!volumeBreakoutStatus) return
    setVolumeBreakoutLoading(false)
    setVolumeBreakoutRefreshing(false)
    if (hasRenderableVolumeSnapshot(volumeBreakoutStatus)) {
      if (volumeBreakoutStatus.universe_mode === 'all_nse') {
        const synced = volumeBreakoutStatus.sync.symbols_synced ?? 0
        const total = volumeBreakoutStatus.universe_size ?? 0
        if (synced > 0 && synced < total) {
          setVolumeBreakoutMessage(`Showing the first synced NSE slice while the scanner expands beyond ${synced} symbols in background batches.`)
        } else {
          setVolumeBreakoutMessage('Showing the latest All NSE snapshot. New batches will keep widening coverage quietly.')
        }
      } else {
        setVolumeBreakoutMessage('Showing the latest cached volume snapshot. New refreshes will update this view quietly.')
      }
    }
  }, [volumeBreakoutStatus])

  useEffect(() => {
    if (selectedVolumeSymbol && volumeOpportunityRows.some((row) => row.symbol === selectedVolumeSymbol)) return
    setSelectedVolumeSymbol(volumeLeaderRows[0]?.symbol ?? volumeOpportunityRows[0]?.symbol ?? null)
  }, [selectedVolumeSymbol, volumeLeaderRows, volumeOpportunityRows])


  return (
      <div className="subview-shell volume-page-shell">
        {renderNav('Scanner')}
        <main className="subview-main volume-page-panel">

          <section className="subview-page-head volume-page-head">
            <div className="subview-page-hero volume-page-hero">
              <div className="subview-page-crumbs volume-page-crumbs">
                <button type="button" className="ghost-inline" onClick={() => onBack()}>
                  Back to Dashboard
                </button>
                <span className="builder-crumb-sep">/</span>
                <span className="subview-page-crumb-label volume-page-crumb-label">Scanner</span>
              </div>
              <h1 className="hero-title subview-page-title volume-page-title">Volume Breakout</h1>
              <p className="hero-sub subview-page-subtitle volume-page-subtitle">
                Action workspace for volume spikes, live movers, sector rotation, and staged trade tickets.
              </p>
            </div>
            <div className="subview-page-pills volume-page-pills">
              <a className="pill-v2 volume-diagnostics-link" href="#volume-diagnostics">Diagnostics</a>
              <span className="pill-v2">{volumeBreakoutStatus?.interval ?? '5m'} scanner</span>
              <span className={volumeBreakoutStatus?.sync.db_enabled ? 'pill-v2 pill-success' : 'pill-v2'}>
                {volumeBreakoutStatus?.sync.cache_mode === 'database' ? 'DB cache' : 'Memory cache'}
              </span>
              <span className={
                volumeEodMode
                  ? 'pill-v2 volume-pill-warning'
                  : volumeWsState === 'connected' ? 'pill-v2 pill-success'
                  : volumeWsState === 'error' ? 'pill-v2 pill-danger'
                  : 'pill-v2'
              }>
                {volumeEodMode
                  ? 'Market Closed'
                  : volumeWsState === 'connecting' ? 'Connecting...'
                  : volumeWsState === 'connected' ? 'Live'
                  : volumeWsState === 'error' ? 'Error'
                  : 'Disconnected'}
              </span>
            </div>
          </section>

          <section className={`volume-command-strip${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            <div>
              <strong>{volumeEodMode ? 'Using last completed market session' : 'Live opportunity scan is warming up'}</strong>
              <p>Current leaders are ready to inspect while NSE coverage expands quietly in the background.</p>
            </div>
            <div className="volume-command-pills">
              <span className="pill">Cached {volumeBreakoutStatus?.sync.symbols_synced ?? 0} / {volumeBreakoutStatus?.universe_size ?? 0}</span>
              <span className={volumeCoverageHealthy ? 'pill pill-success' : 'pill pill-warning'}>{volumeCoverageHealthy ? 'Coverage healthy' : `${volumeMissingCache} missing`}</span>
              <span className="pill">Last run {volumeBreakoutStatus?.last_run_ist ?? 'Waiting...'}</span>
              <span className="pill">Candle {volumeBreakoutStatus?.summary.latest_candle_ist ?? 'Waiting...'}</span>
            </div>
          </section>

          {volumeEodMode && marketStatus && (
            <div style={{
              background: '#1a1a2e',
              border: '1px solid #f6c90e44',
              borderRadius: 8,
              padding: '10px 16px',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#f6c90e', fontSize: 15 }}>?</span>
                <span style={{ color: '#f6c90e', fontSize: 13, fontWeight: 600 }}>
                  Markets closed
                </span>
                <span style={{ color: '#7aa2f7', fontSize: 13 }}>
                  - Showing last session: {marketStatus.last_session_date}
                </span>
              </div>
              <span style={{ color: '#565f89', fontSize: 12 }}>
                Next open: {marketStatus.next_open_ist}
              </span>
            </div>
          )}

          {volumeGapFill && !volumeEodMode && (
            <div className="volume-progress-strip" style={{ marginBottom: 16 }}>
              <div>
                <div className="volume-progress-head">
                  <span>
                    {volumeBreakoutStatus?.universe_mode === 'all_nse'
                      ? `Booted with the first ${Math.min(120, volumeGapFill.symbols_total ?? 120)} symbols - expanding across NSE: ${volumeGapFill.symbols_done} / ${volumeGapFill.symbols_total}`
                      : `Syncing gap data - ${volumeGapFill.symbols_done} / ${volumeGapFill.symbols_total} symbols`}
                  </span>
                  <span>{volumeGapFill.pct_complete}%</span>
                </div>
                <div className="volume-progress-track">
                  <div style={{ width: `${volumeGapFill.pct_complete}%` }} />
                </div>
              </div>
            </div>
          )}

          <section className={`volume-summary-grid${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            {showVolumeSkeleton ? (
              <>
                <VolumeSummarySkeletonCard />
                <VolumeSummarySkeletonCard />
                <VolumeSummarySkeletonCard />
                <VolumeSummarySkeletonCard />
              </>
            ) : (
              <>
                <article className="dashboard-module-card compact-card">
                  <span className="summary-label">Scanned Stocks</span>
                  <strong>{volumeBreakoutStatus?.summary.tracked_stocks ?? 0}</strong>
                  <small>Symbols with enough cached history and liquidity to rank.</small>
                </article>
                <article className="dashboard-module-card compact-card">
                  <span className="summary-label">Active Breakouts</span>
                  <strong>{volumeBreakoutStatus?.summary.active_breakouts ?? 0}</strong>
                  <small>Names currently above the configured volume-ratio threshold.</small>
                </article>
                <article className="dashboard-module-card compact-card">
                  <span className="summary-label">Fresh Entrants</span>
                  <strong>{volumeBreakoutStatus?.summary.fresh_breakouts ?? 0}</strong>
                  <small>New threshold crosses since the previous ranking cycle.</small>
                </article>
                <article className="dashboard-module-card compact-card">
                  <span className="summary-label">Confirmed</span>
                  <strong>{volumeBreakoutStatus?.summary.leaders_with_price_breakout ?? 0}</strong>
                  <small>Breakouts that also have price confirmation structure.</small>
                </article>
              </>
            )}
          </section>

          <section className={`volume-action-grid volume-reveal${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            <div className="volume-action-main-column">
              <article className="dashboard-module-card volume-panel volume-visual-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Volume Opportunity Map</h2>
                    <p>Find where participation and day momentum line up. Best setups cluster in the upper-right.</p>
                  </div>
                </div>
                {showVolumeSkeleton ? (
                  <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Name', 'Momentum', 'RVOL', 'Volume', 'State']} rows={7} />
                ) : (
                  <OpportunityMap
                    rows={volumeOpportunityRows}
                    freshSymbols={volumeFreshSymbols}
                    selectedSymbol={selectedVolumeRow?.symbol ?? null}
                    onSelect={selectVolumeSymbolForTicket}
                  />
                )}
              </article>

              <article className={`dashboard-module-card volume-panel${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
                <div className="panel-heading">
                  <div>
                    <h2>Leaders</h2>
                    <p>Top ranked names for quick switching.</p>
                  </div>
                </div>
                {showVolumeSkeleton ? (
                  <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Stock', 'Day', 'RVOL', 'Volume', 'Setup']} rows={6} />
                ) : (
                  <div className="volume-leader-list">
                    {volumeLeaderRows.length === 0 ? (
                      <div className="table-empty">No ranked leaders yet. The backend may still be syncing baseline history.</div>
                    ) : (
                      volumeLeaderRows.map((row, index) => {
                        const isSelected = row.symbol === selectedVolumeRow?.symbol
                        const rowQuote = volumeQuotes.quotes[row.symbol]
                        const displayPrice = rowQuote?.last_price ?? row.last_price
                        return (
                          <button
                            key={`leader-${row.symbol}-${row.candle_time_ist}`}
                            type="button"
                            className={isSelected ? 'leader-strip-card active' : 'leader-strip-card'}
                            onClick={() => selectVolumeSymbolForTicket(row.symbol)}
                          >
                            <div className="leader-strip-head">
                              <div>
                                <strong>{index + 1}. {row.symbol}</strong>
                                <small>{row.display_name}</small>
                              </div>
                              <span className={(row.day_change_pct ?? 0) >= 0 ? 'tone-positive' : 'tone-negative'}>
                                {formatPercent(row.day_change_pct)}
                              </span>
                            </div>
                            <div className="leader-strip-metrics">
                              <span className="text-muted">{row.candle_time_ist}</span>
                              <span className={rowQuote?.source === 'websocket' ? 'metric-chip success' : 'metric-chip'}>LTP {formatPrice(displayPrice)}</span>
                              <span className="metric-chip">RVOL {row.volume_ratio.toFixed(2)}x</span>
                              <span className="metric-chip">Vol {formatCompactNumber(row.current_volume)}</span>
                              <span className={row.is_price_breakout ? 'metric-chip success' : volumeFreshSymbols.has(row.symbol) ? 'metric-chip fresh' : 'metric-chip'}>
                                {getReadableSetupLabel(row, volumeFreshSymbols)}
                              </span>
                            </div>
                            <div className="leader-strip-bar">
                              <div className="leader-strip-bar-fill" style={{ width: `${clamp(((row.day_change_pct ?? 0) + 8) / 16 * 100, 6, 100)}%` }} />
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </article>
            </div>

            <article ref={volumeActionPanelRef} className="dashboard-module-card volume-panel volume-visual-panel">
              <div className="panel-heading">
                <div>
                  <h2>Selected Leader</h2>
                  <p>Instant snapshot for the currently selected symbol.</p>
                </div>
              </div>
              {showVolumeSkeleton ? (
                <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Stock', 'Day', 'RVOL', 'Volume', 'Setup']} rows={7} />
              ) : (
                <div className="volume-leader-workspace">
                  <SelectedVolumeSnapshot
                    row={selectedVolumeRow}
                    freshSymbols={volumeFreshSymbols}
                    latestCandle={volumeBreakoutStatus?.summary.latest_candle_ist}
                    quote={selectedVolumeQuote}
                  />
                  <VolumeTradeTicket
                    row={selectedVolumeRow}
                    quote={selectedVolumeQuote}
                    liveState={volumeQuotes.state}
                    liveStatus={volumeQuotes.status}
                    executionEnvironment={executionEnvironment}
                    executionSessionToken={executionSessionToken}
                    executionDeviceId={executionDeviceId}
                    hasExecutionSession={hasExecutionSession}
                    onExecutionEnvironmentSelect={onExecutionEnvironmentSelect}
                  />
                </div>
              )}
            </article>
          </section>

          <section className={`dashboard-module-card volume-panel volume-movers-panel${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            <div className="panel-heading">
              <div>
                <h2>Market Movers</h2>
                <p>Click a bar or row to route that stock into the selected setup and ticket.</p>
              </div>
            </div>
            {showVolumeSkeleton ? (
              <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Stock', 'Day Change', 'Ratio', 'Volume', 'Time']} rows={8} />
            ) : (
              <div className="movers-combined-panel">
                <MoversArrowChart
                  moversUp={moversUpDisplayRows}
                  moversDown={moversDownDisplayRows}
                  quotes={volumeQuotes.quotes}
                  onSelectSymbol={selectVolumeSymbolForTicket}
                />
                <div className="movers-table-grid">
                  <article className="movers-table-card">
                    <div className="panel-heading">
                      <div>
                        <h2>Movers Up</h2>
                        <p>Top 10 gainers with volume support.</p>
                      </div>
                    </div>
                    <div className="table-shell">
                      <div className="table-row table-head volume-recent-grid">
                        <span>Stock</span>
                        <span>Day Change</span>
                        <span>Ratio</span>
                        <span>Volume</span>
                        <span>Time</span>
                      </div>
                      {moversUpDisplayRows.length === 0 ? (
                        <div className="table-empty">No upward movers yet.</div>
                      ) : (
                        moversUpDisplayRows.slice(0, 10).map((row) => (
                          <div
                            key={`up-${row.symbol}-${row.candle_time_ist}`}
                            className="table-row volume-recent-grid clickable-row"
                            onClick={() => selectVolumeSymbolForTicket(row.symbol)}
                          >
                            <span>{row.symbol}</span>
                            <span className="text-success">{formatPercent(row.day_change_pct)}</span>
                            <span>{row.volume_ratio.toFixed(2)}x</span>
                            <span>{formatCompactNumber(row.current_volume)}</span>
                            <span>{row.candle_time_ist}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                  <article className="movers-table-card">
                    <div className="panel-heading">
                      <div>
                        <h2>Movers Down</h2>
                        <p>Top 10 decliners with unusual participation.</p>
                      </div>
                    </div>
                    <div className="table-shell">
                      <div className="table-row table-head volume-recent-grid">
                        <span>Stock</span>
                        <span>Day Change</span>
                        <span>Ratio</span>
                        <span>Volume</span>
                        <span>Time</span>
                      </div>
                      {moversDownDisplayRows.length === 0 ? (
                        <div className="table-empty">No downward movers yet.</div>
                      ) : (
                        moversDownDisplayRows.slice(0, 10).map((row) => (
                          <div
                            key={`down-${row.symbol}-${row.candle_time_ist}`}
                            className="table-row volume-recent-grid clickable-row"
                            onClick={() => selectVolumeSymbolForTicket(row.symbol)}
                          >
                            <span>{row.symbol}</span>
                            <span className="text-danger">{formatPercent(row.day_change_pct)}</span>
                            <span>{row.volume_ratio.toFixed(2)}x</span>
                            <span>{formatCompactNumber(row.current_volume)}</span>
                            <span>{row.candle_time_ist}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                </div>
              </div>
            )}
          </section>

          <section className={`volume-secondary-grid${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            <article className="dashboard-module-card volume-panel">
              <div className="panel-heading">
                <div>
                  <h2>Confirmed Leaders</h2>
                  <p>Volume spikes with price confirmation.</p>
                </div>
              </div>
              {showVolumeSkeleton ? (
                <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Stock', 'Ratio', 'Price Breakout', 'Baseline Days', 'Time']} rows={6} />
              ) : (
                <div className="table-shell">
                  <div className="table-row table-head volume-recent-grid">
                    <span>Stock</span>
                    <span>Ratio</span>
                    <span>Price Breakout</span>
                    <span>Baseline Days</span>
                    <span>Time</span>
                  </div>
                  {confirmedDisplayRows.length === 0 ? (
                    <div className="table-empty">No confirmed price breakouts yet.</div>
                  ) : (
                    confirmedDisplayRows.slice(0, 5).map((row) => (
                      <div
                        key={`confirmed-${row.symbol}-${row.candle_time_ist}`}
                        className="table-row volume-recent-grid clickable-row"
                        onClick={() => selectVolumeSymbolForTicket(row.symbol)}
                      >
                        <span>{row.symbol}</span>
                        <span>{row.volume_ratio.toFixed(2)}x</span>
                        <span className="text-success">{formatPercent(row.price_breakout_pct)}</span>
                        <span>{row.baseline_days}</span>
                        <span>{row.candle_time_ist}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </article>

            <article className="dashboard-module-card volume-panel">
              <div className="panel-heading">
                <div>
                  <h2>Sector Heatmap</h2>
                  <p>Where participation is clustering right now.</p>
                </div>
              </div>
              {showVolumeSkeleton ? (
                <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Sector', 'Bias', 'RVOL', 'Leader', 'Setup']} rows={4} />
              ) : (
                <SectorHeatmap
                  rows={volumeSectorRows}
                  freshSymbols={volumeFreshSymbols}
                  onSelectSectorSymbol={selectVolumeSymbolForTicket}
                />
              )}
            </article>
          </section>

          <details id="volume-diagnostics" className={`dashboard-info-card volume-meta-card volume-diagnostics${showVolumeSoftRefresh ? ' volume-refreshing' : ''}`}>
            <summary>Diagnostics, cache coverage, and scanner timing</summary>
            <div>
              <strong>Scanner State</strong>
              <p>{volumeBreakoutMessage}</p>
            </div>
            <div className="volume-meta-stack">
              <span className="pill">Cached: {volumeBreakoutStatus?.sync.symbols_synced ?? 0} / {volumeBreakoutStatus?.universe_size ?? 0}</span>
              <span className={volumeCoverageHealthy ? 'pill pill-success' : 'pill pill-warning'}>Missing cache: {volumeMissingCache}</span>
              <span className="pill">Last run: {volumeBreakoutStatus?.last_run_ist ?? 'Waiting...'}</span>
              <span className="pill">Latest candle: {volumeBreakoutStatus?.summary.latest_candle_ist ?? 'Waiting...'}</span>
            </div>
            {showVolumeSkeleton ? (
              <VolumeTableSkeleton gridClassName="volume-recent-grid" columns={['Area', 'Status', 'Detail', 'Range', 'Next']} rows={3} />
            ) : (
              <div className="table-shell">
                <div className="table-row table-head volume-recent-grid">
                  <span>Area</span>
                  <span>Status</span>
                  <span>Detail</span>
                  <span>Range</span>
                  <span>Next</span>
                </div>
                <div className="table-row volume-recent-grid">
                  <span>Storage</span>
                  <span>{volumeBreakoutStatus?.sync.cache_mode ?? 'memory'}</span>
                  <span>{volumeBreakoutStatus?.sync.db_enabled ? 'Persisting 1m bars in DB' : 'Using runtime memory cache'}</span>
                  <span>{volumeBreakoutStatus?.sync.history_range_ist ?? 'Waiting...'}</span>
                  <span>{volumeBreakoutStatus?.sync.next_refresh_ist ?? 'Waiting...'}</span>
                </div>
                <div className="table-row volume-recent-grid">
                  <span>Universe</span>
                  <span>{volumeBreakoutStatus?.sync.universe_ready ? 'Ready' : 'Pending'}</span>
                  <span>{volumeBreakoutStatus?.summary.tracked_stocks ?? 0} scanned / {volumeBreakoutStatus?.sync.symbols_synced ?? 0} cached</span>
                  <span>{volumeBreakoutStatus?.sync.last_history_sync_ist ?? 'Waiting...'}</span>
                  <span>{volumeBreakoutStatus?.last_run_ist ?? 'Waiting...'}</span>
                </div>
                <div className="table-row volume-recent-grid">
                  <span>Coverage</span>
                  <span>{volumeCoverageHealthy ? 'Healthy' : 'Partial'}</span>
                  <span>{volumeMissingCache} symbols still missing baseline history</span>
                  <span>Lookback {volumeBreakoutStatus?.lookback_days ?? 10} days</span>
                  <span>{volumeBreakoutStatus?.next_run_ist ?? 'Waiting...'}</span>
                </div>
              </div>
            )}
          </details>

          {volumeBreakoutError ? <section className="error-banner dashboard-error">{volumeBreakoutError}</section> : null}
        </main>
      </div>
  )
}
