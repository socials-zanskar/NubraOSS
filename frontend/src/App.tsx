import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import nubraLogo from './assets/nubra-logo.png'
import ScalperLiveChart from './components/ScalperLiveChart'
import IndicatorBuilder from './components/IndicatorBuilder'
import AutomatePanel from './components/AutomatePanel'
import { useScalperLive } from './hooks/useScalperLive'
import { useIndicators } from './hooks/useIndicators'
import { useAutomation } from './hooks/useAutomation'
import type { AutomateConfig } from './hooks/useAutomation'
import type { OhlcvCandle } from './types/indicators'

type Environment = 'PROD' | 'UAT'
type Step = 'start' | 'otp' | 'mpin' | 'success'
type View = 'login' | 'dashboard' | 'no-code' | 'volume-breakout' | 'tradingview-webhook' | 'scalper'
type TradingViewMode = 'strategy' | 'line'
type TradingViewAction = 'BUY' | 'SELL'
type Interval = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1h'
type Indicator = 'EMA' | 'MA' | 'RSI'
type OrderDeliveryType = 'ORDER_DELIVERY_TYPE_CNC' | 'ORDER_DELIVERY_TYPE_IDAY'
type StrategySideMode = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY'
type ScalperTool = 'delta-neutral' | 'expiry-heatmap' | 'volume-breakout' | 'indicator-builder' | 'automate'

interface StartResponse {
  flow_id: string
  next_step: 'otp'
  masked_phone: string
  environment: Environment
  device_id: string
  message: string
}

interface OtpResponse {
  flow_id: string
  next_step: 'mpin'
  message: string
}

interface SuccessResponse {
  access_token: string
  refresh_token: string
  user_name: string
  account_id: string
  device_id: string
  environment: Environment
  broker: 'Nubra'
  expires_in: number
  message: string
  is_demo?: boolean
}

interface SessionStatusResponse {
  active: boolean
  environment: Environment
  expires_at_utc: string | null
  message: string
}

interface ApiErrorPayload {
  detail?: unknown
  message?: unknown
  error?: unknown
}

interface NoCodeAlert {
  id: string
  signal: string
  instrument: string
  interval: Interval
  indicator: Indicator
  candle_time_ist: string
  triggered_at_ist: string
  price: number
  detail: string
}

interface NoCodeDebugSnapshot {
  last_completed_candle_ist: string | null
  last_close: number | null
  indicator_values: Record<string, string | number | null>
  dataframe_rows: Array<Record<string, string | number | null>>
}

interface NoCodeStatus {
  running: boolean
  instrument: string | null
  interval: Interval | null
  indicator: Indicator | null
  strategy_side_mode: StrategySideMode | null
  last_run_ist: string | null
  next_run_ist: string | null
  market_status: string
  last_signal: string | null
  last_error: string | null
  alerts: NoCodeAlert[]
  tracker_rows: Array<{
    alert: string
    side: string
    position_state: string
    time_ist: string
  }>
  debug: NoCodeDebugSnapshot | null
  execution: {
    enabled: boolean
    instrument_ref_id: number | null
    instrument_tick_size: number | null
    instrument_lot_size: number | null
    desired_side: string | null
    position_side: string | null
    position_qty: number
    pending_order_id: number | null
    pending_order_side: string | null
    pending_order_action: string | null
    pending_followup_signal: string | null
    last_order_status: string | null
    last_execution_status: string | null
    last_order_update: Record<string, unknown> | null
    last_positions_sync_ist: string | null
  } | null
}

interface NoCodeInstrumentMeta {
  instrument: string
  ref_id: number
  tick_size: number
  lot_size: number
}

interface StockSearchItem {
  instrument: string
  display_name: string
  exchange: string
  ref_id: number
  tick_size: number
  lot_size: number
}

interface NoCodeStartResponse {
  status: string
  message: string
  job: NoCodeStatus
}

interface NoCodeStopResponse {
  status: string
  message: string
}

interface PublicIpResponse {
  ip: string | null
}

interface TunnelStatusResponse {
  running: boolean
  public_url: string | null
  target_url: string
  last_error: string | null
  logs: string[]
}

interface TradingViewWebhookLogEntry {
  time_ist: string
  level: 'info' | 'success' | 'error'
  message: string
  payload: Record<string, unknown> | null
}

interface TradingViewWebhookHistoryEntry {
  id: string
  time_ist: string
  day_ist: string
  source: 'test' | 'live'
  status: 'received' | 'accepted' | 'blocked' | 'error'
  strategy: string | null
  tag: string | null
  instrument: string | null
  exchange: string | null
  action: string | null
  quantity: number | null
  order_id: number | null
  order_status: string | null
  pnl: number | null
  requested_qty: number | null
  placed_qty: number | null
  filled_qty: number | null
  avg_filled_price: number | null
  order_price: number | null
  ltp_price: number | null
  ref_id: number | null
  lot_size: number | null
  tick_size: number | null
  message: string
  payload: Record<string, unknown> | null
}

interface TradingViewWebhookSummary {
  total_events: number
  live_events: number
  test_events: number
  blocked_events: number
  error_events: number
  accepted_events: number
  today_pnl: number
  today_orders: number
}

interface TradingViewWebhookOrderRow {
  time_ist: string
  source: 'test' | 'live'
  strategy: string | null
  tag: string | null
  instrument: string | null
  exchange: string | null
  action: string | null
  requested_qty: number | null
  placed_qty: number | null
  filled_qty: number | null
  order_price: number | null
  avg_filled_price: number | null
  current_price: number | null
  order_id: number | null
  order_status: string | null
  pnl: number | null
}

interface TradingViewWebhookPositionRow {
  strategy: string | null
  tag: string | null
  instrument: string
  exchange: string
  net_qty: number
  avg_entry_price: number | null
  current_price: number | null
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  direction: 'LONG' | 'SHORT' | 'FLAT'
}

interface TradingViewWebhookPnlSummary {
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  open_positions: number
  closed_groups: number
}

interface ScalperCandle {
  time_ist: string
  epoch_ms: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface ScalperChartPanel {
  instrument: string
  display_name: string
  exchange: string
  instrument_type: string
  interval: string
  last_price: number | null
  candles: ScalperCandle[]
}

interface ScalperResolvedOptionPair {
  underlying: string
  exchange: string
  expiry: string | null
  ce_strike_price: number
  pe_strike_price: number
  call_ref_id: number | null
  put_ref_id: number | null
  call_display_name: string
  put_display_name: string
  lot_size: number | null
  tick_size: number | null
}

interface ScalperSnapshotResponse {
  status: 'success'
  message: string
  underlying: ScalperChartPanel
  call_option: ScalperChartPanel
  put_option: ScalperChartPanel
  option_pair: ScalperResolvedOptionPair
}

interface ScalperOrderResponse {
  status: 'success'
  message: string
  order_id: number | null
  order_status: string | null
  order_side: 'ORDER_SIDE_BUY' | 'ORDER_SIDE_SELL'
  order_qty: number
  order_price: number | null
  lots: number
  instrument_display_name: string
}

interface DeltaNeutralPairRow {
  rank: number
  underlying: string
  exchange: string
  expiry: string | null
  ce_strike_price: number
  pe_strike_price: number
  call_display_name: string
  put_display_name: string
  spot_price: number | null
  center_strike: number | null
  width_points: number
  call_delta: number | null
  put_delta: number | null
  net_delta: number | null
  neutrality_score: number
  lot_size: number | null
  tick_size: number | null
}

interface DeltaNeutralPairsResponse {
  status: 'success'
  message: string
  pairs: DeltaNeutralPairRow[]
}

interface ExpiryHeatmapRow {
  strike_price: number
  expiry: string | null
  distance_from_spot: number
  call_display_name: string | null
  put_display_name: string | null
  call_last_price: number | null
  put_last_price: number | null
  call_volume: number | null
  put_volume: number | null
  call_change_pct: number | null
  put_change_pct: number | null
  call_heat: number
  put_heat: number
}

interface ExpiryHeatmapResponse {
  status: 'success'
  message: string
  underlying: string
  exchange: string
  expiry: string | null
  interval: Interval
  spot_price: number | null
  center_strike: number | null
  rows: ExpiryHeatmapRow[]
}

interface ScalperVolumeBreakoutRow {
  rank: number
  underlying: string
  display_name: string
  exchange: string
  last_price: number | null
  current_volume: number | null
  average_volume: number | null
  volume_ratio: number
  price_change_pct: number | null
  breakout_strength: number
  status_label: string
  nearest_expiry: string | null
  atm_strike: number | null
}

interface ScalperVolumeBreakoutResponse {
  status: 'success'
  message: string
  lookback_days: number
  rows: ScalperVolumeBreakoutRow[]
}

interface TradingViewWebhookStatusResponse {
  configured: boolean
  environment: Environment | null
  broker: 'Nubra' | null
  user_name: string | null
  account_id: string | null
  configured_at_utc: string | null
  order_delivery_type: OrderDeliveryType | null
  secret: string | null
  has_secret: boolean
  webhook_path: string
  webhook_url: string | null
  strategy_template: Record<string, unknown>
  line_alert_template: Record<string, unknown>
  execution_enabled: boolean
  last_error: string | null
  logs: TradingViewWebhookLogEntry[]
  history: TradingViewWebhookHistoryEntry[]
  summary: TradingViewWebhookSummary
  order_history: TradingViewWebhookOrderRow[]
  positions: TradingViewWebhookPositionRow[]
  pnl_summary: TradingViewWebhookPnlSummary
}

interface TradingViewWebhookConfigureResponse {
  status: 'success'
  message: string
  config: TradingViewWebhookStatusResponse
}

interface TradingViewWebhookResetResponse {
  status: 'success'
  message: string
}

interface TradingViewWebhookExecutionModeResponse {
  status: 'success'
  message: string
  execution_enabled: boolean
}

interface VolumeBreakoutStockRow {
  symbol: string
  display_name: string
  exchange: string
  candle_time_ist: string
  last_price: number
  current_volume: number
  average_volume: number
  volume_ratio: number
  price_change_pct: number | null
  price_breakout_pct: number | null
  is_green: boolean
  is_price_breakout: boolean
  meets_breakout: boolean
}

interface VolumeBreakoutStatus {
  running: boolean
  universe_slug: string
  interval: Interval
  lookback_days: number
  refresh_seconds: number
  min_volume_ratio: number
  universe_size: number
  live_mode: boolean
  live_status: string
  live_last_event_ist: string | null
  live_subscribed_symbols: number
  last_run_ist: string | null
  next_run_ist: string | null
  last_error: string | null
  summary: {
    tracked_stocks: number
    active_breakouts: number
    leaders_with_price_breakout: number
    latest_candle_ist: string | null
    market_status: string
  }
  market_breakouts: VolumeBreakoutStockRow[]
  recent_breakouts: VolumeBreakoutStockRow[]
}

interface VolumeBreakoutStartResponse {
  status: string
  message: string
  job: VolumeBreakoutStatus
}

const API_BASE_URL = ''
const SESSION_STORAGE_KEY = 'nubraoss.session'
const SCALPER_SNAPSHOT_CACHE_PREFIX = 'nubraoss.scalperSnapshot'
const dashboardTabs = ['Dashboard']

const dashboardCards = [
  {
    badgeClass: 'badge-indigo',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>
        <line x1="7" y1="6" x2="17" y2="6"/><line x1="5" y1="8" x2="12" y2="16"/><line x1="19" y1="8" x2="12" y2="16"/>
      </svg>
    ),
    title: 'No Code Algo',
    description: 'Visual strategy builder for creating and launching rule-based trading flows.',
    footer: 'Open No Code Algo',
    key: 'no-code' as const,
  },
  {
    badgeClass: 'badge-blue',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="14" width="4" height="7" rx="1"/><rect x="9" y="9" width="4" height="12" rx="1"/><rect x="16" y="4" width="4" height="17" rx="1"/>
        <polyline points="3,7 8,4 13,8 20,2" strokeWidth="2"/><polyline points="17,2 20,2 20,5" strokeWidth="2"/>
      </svg>
    ),
    title: 'Volume Breakout',
    description: 'Scan sector leaders and market-wide volume breakouts across major Indian stocks.',
    footer: 'Open Scanner',
    key: 'volume-breakout' as const,
  },
  {
    badgeClass: 'badge-emerald',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    ),
    title: 'Webhook Strategies',
    description: 'Manage alert-driven trading strategies and view active automation status.',
    footer: 'Open Strategies',
    key: 'tradingview-webhook' as const,
  },
  {
    badgeClass: 'badge-orange',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>
        <line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/>
        <line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/>
      </svg>
    ),
    title: 'Scalper',
    description: 'Dedicated intraday workspace for fast entries, quick decisions, and short-horizon execution flows.',
    footer: 'Open Scalper',
    key: 'scalper' as const,
  },
  {
    badgeClass: 'badge-slate',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>
        <polyline points="10,9 9,9 8,9"/>
      </svg>
    ),
    title: 'Trade Book',
    description: 'Review executed trades, fills, and trade-side summaries across the session.',
    footer: 'Open Trade Book',
  },
  {
    badgeClass: 'badge-cyan',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    ),
    title: 'Option Chain',
    description: 'Monitor live option chain data, strike context, and quick action flows.',
    footer: 'Open Option Chain',
  },
]

const demoSession: SuccessResponse = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  user_name: 'Demo User',
  account_id: 'NUBRA-DEMO',
  device_id: 'Nubra-OSS-DEMO',
  environment: 'UAT',
  broker: 'Nubra',
  expires_in: 3600,
  message: 'Demo mode enabled. Explore the current UI without using a real Nubra login.',
  is_demo: true,
}

const intervals: Interval[] = ['1m', '2m', '3m', '5m', '15m', '30m', '1h']
const scalperUnderlyings = ['NIFTY', 'BANKNIFTY'] as const

function scalperStrikeStep(underlying: string): number {
  const normalized = underlying.trim().toUpperCase()
  if (normalized === 'BANKNIFTY') return 100
  if (normalized === 'NIFTY') return 50
  return 10
}

function snapScalperStrike(price: number, underlying: string): string {
  const step = scalperStrikeStep(underlying)
  return String(Math.round(price / step) * step)
}

function defaultScalperStrike(underlying: string): string {
  const u = underlying.trim().toUpperCase()
  if (u === 'BANKNIFTY') return snapScalperStrike(56500, u)
  if (u === 'NIFTY') return snapScalperStrike(24300, u)
  // For stocks — use a sensible mid-range default; ATM sync will correct it on first snapshot
  return snapScalperStrike(1000, u)
}

function adjustScalperStrike(value: string, underlying: string, direction: -1 | 1): string {
  const step = scalperStrikeStep(underlying)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultScalperStrike((underlying.toUpperCase() === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY'))
  }
  return String(Math.max(step, parsed + step * direction))
}

function scalperSnapshotCacheKeys(input: {
  underlying: string
  interval: string
  ceStrike: string
  peStrike: string
  expiry: string
}): { exact: string; generic: string } {
  const exact = `${SCALPER_SNAPSHOT_CACHE_PREFIX}:${input.underlying}:${input.interval}:${input.ceStrike}:${input.peStrike}:${input.expiry || 'nearest'}`
  const generic = `${SCALPER_SNAPSHOT_CACHE_PREFIX}:${input.underlying}:${input.interval}:latest`
  return { exact, generic }
}

function loadCachedScalperSnapshot(keys: { exact: string; generic: string }): ScalperSnapshotResponse | null {
  if (typeof window === 'undefined') return null
  for (const key of [keys.exact, keys.generic]) {
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      return JSON.parse(raw) as ScalperSnapshotResponse
    } catch {
      window.localStorage.removeItem(key)
    }
  }
  return null
}

function saveCachedScalperSnapshot(keys: { exact: string; generic: string }, snapshot: ScalperSnapshotResponse): void {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify(snapshot)
  window.localStorage.setItem(keys.exact, payload)
  window.localStorage.setItem(keys.generic, payload)
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

function normalizeExpiryValue(value: string | null | undefined): string | null {
  const cleaned = value?.trim().toUpperCase() ?? ''
  if (!cleaned) return null

  const directFormats = ['%d %b %y', '%d %B %y', '%Y%m%d', '%d-%m-%Y', '%d-%b-%Y', '%d%b%y', '%d%b%Y', '%d%B%y', '%d%B%Y']
  for (const format of directFormats) {
    const parsed = tryParseExpiry(cleaned, format)
    if (parsed) return parsed
  }

  const digits = cleaned.replace(/\D/g, '')
  if (digits.length === 8) return digits
  return cleaned
}

function tryParseExpiry(value: string, format: string): string | null {
  const monthMap: Record<string, string> = {
    JAN: '01',
    FEB: '02',
    MAR: '03',
    APR: '04',
    MAY: '05',
    JUN: '06',
    JUL: '07',
    AUG: '08',
    SEP: '09',
    OCT: '10',
    NOV: '11',
    DEC: '12',
  }

  const normalized = value.toUpperCase()
  const compact = normalized.replace(/[\s-]/g, '')

  if (format === '%Y%m%d' && /^\d{8}$/.test(compact)) return compact

  const alphaMatch = compact.match(/^(\d{2})([A-Z]{3,})(\d{2,4})$/)
  if (alphaMatch && ['%d%b%y', '%d%b%Y', '%d%B%y', '%d%B%Y'].includes(format)) {
    const [, day, rawMonth, rawYear] = alphaMatch
    const month = monthMap[rawMonth.slice(0, 3)]
    if (!month) return null
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    return `${year}${month}${day}`
  }

  const spacedMatch = normalized.match(/^(\d{2})\s+([A-Z]{3,})\s+(\d{2,4})$/)
  if (spacedMatch && ['%d %b %y', '%d %B %y'].includes(format)) {
    const [, day, rawMonth, rawYear] = spacedMatch
    const month = monthMap[rawMonth.slice(0, 3)]
    if (!month) return null
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    return `${year}${month}${day}`
  }

  const dashMatch = normalized.match(/^(\d{2})-([A-Z]{3,}|\d{2})-(\d{2,4})$/)
  if (dashMatch && ['%d-%m-%Y', '%d-%b-%Y'].includes(format)) {
    const [, day, rawMonth, rawYear] = dashMatch
    const month = /^\d{2}$/.test(rawMonth) ? rawMonth : monthMap[rawMonth.slice(0, 3)]
    if (!month) return null
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    return `${year}${month}${day}`
  }

  return null
}

function formatExpiryInputValue(value: string | null | undefined): string {
  const normalized = normalizeExpiryValue(value)
  if (!normalized) return ''
  if (/^\d{8}$/.test(normalized)) {
    const year = normalized.slice(2, 4)
    const monthIndex = Number(normalized.slice(4, 6)) - 1
    const day = normalized.slice(6, 8)
    const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][monthIndex]
    return `${day} ${month} ${year}`
  }
  return normalized
}

function formatExpiryBadge(value: string | null | undefined): string {
  return formatExpiryInputValue(value) || 'Nearest expiry'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function ScalperChart({ title, panel, accent }: { title: string; panel: ScalperChartPanel | null; accent: 'blue' | 'green' | 'red' }) {
  const candles = panel?.candles ?? []
  const latest = candles[candles.length - 1] ?? null
  const previous = candles[candles.length - 2] ?? null
  const allPrices = candles.flatMap((candle) => [candle.high, candle.low])
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 1
  const priceRange = Math.max(maxPrice - minPrice, 1)
  const visibleCandles = candles.slice(-72)
  const chartHeight = 248
  const volumeHeight = 48
  const width = 100
  const accentClass =
    accent === 'green' ? 'scalper-chart-card accent-green' : accent === 'red' ? 'scalper-chart-card accent-red' : 'scalper-chart-card accent-blue'

  return (
    <article className={accentClass}>
      <div className="scalper-chart-head">
        <div>
          <span className="summary-label">{title}</span>
          <h3>{panel?.display_name ?? 'Waiting for data'}</h3>
        </div>
        <div className="scalper-chart-price">
          <strong>{formatPrice(panel?.last_price)}</strong>
          <small>{panel ? `${panel.exchange} - ${panel.interval}` : 'Historical snapshot'}</small>
        </div>
      </div>

      {latest ? (
        <div className="scalper-ohlc-row">
          <span>O {formatPrice(latest.open)}</span>
          <span>H {formatPrice(latest.high)}</span>
          <span>L {formatPrice(latest.low)}</span>
          <span>C {formatPrice(latest.close)}</span>
          <span className={latest.close >= latest.open ? 'tone-positive' : 'tone-negative'}>
            {previous ? `${latest.close >= previous.close ? '+' : ''}${(latest.close - previous.close).toFixed(2)}` : '--'}
          </span>
          <span>Vol {formatCompactVolume(latest.volume)}</span>
        </div>
      ) : null}

      <div className="scalper-chart-canvas">
        {visibleCandles.length === 0 ? (
          <div className="table-empty">No candles returned yet.</div>
        ) : (
          <svg viewBox={`0 0 ${width} ${chartHeight + volumeHeight}`} className="scalper-svg" preserveAspectRatio="none" aria-label={`${title} candle chart`}>
            {Array.from({ length: 5 }).map((_, index) => {
              const y = (chartHeight / 4) * index
              return <line key={`grid-${index}`} x1="0" y1={y} x2={width} y2={y} className="scalper-grid-line" />
            })}
            {visibleCandles.map((candle, index) => {
              const step = width / Math.max(visibleCandles.length, 1)
              const x = step * index + step / 2
              const openY = clamp(((maxPrice - candle.open) / priceRange) * (chartHeight - 12) + 6, 0, chartHeight)
              const closeY = clamp(((maxPrice - candle.close) / priceRange) * (chartHeight - 12) + 6, 0, chartHeight)
              const highY = clamp(((maxPrice - candle.high) / priceRange) * (chartHeight - 12) + 6, 0, chartHeight)
              const lowY = clamp(((maxPrice - candle.low) / priceRange) * (chartHeight - 12) + 6, 0, chartHeight)
              const bodyY = Math.min(openY, closeY)
              const bodyHeight = Math.max(Math.abs(closeY - openY), 1.2)
              const isUp = candle.close >= candle.open
              const fill = isUp ? '#14b8a6' : '#f43f5e'
              const volumeBase = chartHeight + volumeHeight
              const maxVolume = Math.max(...visibleCandles.map((item) => item.volume ?? 0), 1)
              const volumeHeightValue = ((candle.volume ?? 0) / maxVolume) * (volumeHeight - 6)
              return (
                <g key={candle.epoch_ms}>
                  <line x1={x} y1={highY} x2={x} y2={lowY} className="scalper-wick" stroke={fill} />
                  <rect x={x - step * 0.28} y={bodyY} width={Math.max(step * 0.56, 0.8)} height={bodyHeight} rx="0.8" fill={fill} />
                  <rect x={x - step * 0.28} y={volumeBase - volumeHeightValue} width={Math.max(step * 0.56, 0.8)} height={Math.max(volumeHeightValue, 1)} rx="0.8" fill={fill} opacity="0.35" />
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <div className="scalper-chart-foot">
        <span>Bars: {visibleCandles.length}</span>
        <span>Last update: {latest?.time_ist ?? '--'}</span>
      </div>
    </article>
  )
}

function loadStoredSession(): SuccessResponse | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SuccessResponse
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    return null
  }
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const decoded = JSON.parse(window.atob(padded)) as { exp?: unknown }
    return typeof decoded.exp === 'number' ? decoded.exp : null
  } catch {
    return null
  }
}

function hasSessionExpired(session: SuccessResponse | null): boolean {
  if (!session) return true
  const exp = decodeJwtExpiry(session.access_token)
  if (!exp) return false
  return Date.now() >= exp * 1000
}

function extractErrorMessage(payload: ApiErrorPayload | null | undefined, fallback: string): string {
  const candidate = payload?.detail ?? payload?.message ?? payload?.error

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate
  }

  if (Array.isArray(candidate)) {
    const messages = candidate
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') {
          const maybeMessage = (item as Record<string, unknown>).msg
          if (typeof maybeMessage === 'string') return maybeMessage
        }
        return ''
      })
      .filter(Boolean)

    if (messages.length > 0) {
      return messages.join(', ')
    }
  }

  if (candidate && typeof candidate === 'object') {
    const maybeMessage =
      (candidate as Record<string, unknown>).message ??
      (candidate as Record<string, unknown>).msg ??
      (candidate as Record<string, unknown>).detail

    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }
  }

  return fallback
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  const raw = await response.text()
  if (!raw.trim()) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function getSignalTone(signal: string | null): string {
  if (!signal) return 'neutral'
  if (signal.includes('BULLISH') || signal.includes('OVERSOLD')) return 'success'
  if (signal.includes('BEARISH') || signal.includes('OVERBOUGHT')) return 'danger'
  return 'neutral'
}

function formatStrategySideMode(mode: StrategySideMode | null | undefined): string {
  if (mode === 'LONG_ONLY') return 'Long Only'
  if (mode === 'SHORT_ONLY') return 'Short Only'
  if (mode === 'BOTH') return 'Both'
  return '--'
}

export default function App() {
  const [view, setView] = useState<View>(() => (loadStoredSession() ? 'dashboard' : 'login'))
  const [step, setStep] = useState<Step>(() => (loadStoredSession() ? 'success' : 'start'))
  const [environment, setEnvironment] = useState<Environment>(() => loadStoredSession()?.environment ?? 'PROD')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [mpin, setMpin] = useState('')
  const [flowId, setFlowId] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [message, setMessage] = useState('Enter your phone number, verify the OTP, then confirm MPIN.')
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<'phone' | 'otp' | 'mpin' | 'no-code' | 'stop' | null>(null)
  const [session, setSession] = useState<SuccessResponse | null>(() => loadStoredSession())
  const [isSessionChecking, setIsSessionChecking] = useState<boolean>(() => Boolean(loadStoredSession()))
  const [publicIp, setPublicIp] = useState<string>('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (window.localStorage.getItem('nubraoss.theme') as 'light' | 'dark') ?? 'light',
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('nubraoss.theme', theme)
  }, [theme])

  function renderThemeToggle(extraClassName = '') {
    return (
      <div className={`theme-segmented-toggle${extraClassName ? ` ${extraClassName}` : ''}`} role="group" aria-label="Theme switcher">
        <button
          type="button"
          className={theme === 'light' ? 'theme-segment active' : 'theme-segment'}
          onClick={() => setTheme('light')}
          aria-label="Switch to light mode"
          title="Switch to light mode"
        >
          <span className="theme-icon theme-icon-sun" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={theme === 'dark' ? 'theme-segment active' : 'theme-segment'}
          onClick={() => setTheme('dark')}
          aria-label="Switch to dark mode"
          title="Switch to dark mode"
        >
          <span className="theme-icon theme-icon-moon" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const [instrument, setInstrument] = useState('')
  const [interval, setIntervalValue] = useState<Interval>('3m')
  const [indicator, setIndicator] = useState<Indicator>('EMA')
  const [emaFast, setEmaFast] = useState('9')
  const [emaSlow, setEmaSlow] = useState('21')
  const [maFast, setMaFast] = useState('10')
  const [maSlow, setMaSlow] = useState('20')
  const [rsiLength, setRsiLength] = useState('14')
  const [rsiUpper, setRsiUpper] = useState('70')
  const [rsiLower, setRsiLower] = useState('30')
  const [orderQty, setOrderQty] = useState('1')
  const [orderDeliveryType, setOrderDeliveryType] = useState<OrderDeliveryType>('ORDER_DELIVERY_TYPE_IDAY')
  const [strategySideMode, setStrategySideMode] = useState<StrategySideMode>('BOTH')
  const [noCodeStatus, setNoCodeStatus] = useState<NoCodeStatus | null>(null)
  const [instrumentMeta, setInstrumentMeta] = useState<NoCodeInstrumentMeta | null>(null)
  const [stockSuggestions, setStockSuggestions] = useState<StockSearchItem[]>([])
  const [noCodeMessage, setNoCodeMessage] = useState('Configure one instrument and start the IST scheduler.')
  const [noCodeError, setNoCodeError] = useState('')
  const [volumeBreakoutStatus, setVolumeBreakoutStatus] = useState<VolumeBreakoutStatus | null>(null)
  const [volumeBreakoutMessage, setVolumeBreakoutMessage] = useState(
    'DB bootstrap loads first, then the backend websocket overlays live bucket updates while this page stays open.',
  )
  const [volumeBreakoutError, setVolumeBreakoutError] = useState('')
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatusResponse | null>(null)
  const [tunnelAction, setTunnelAction] = useState<'start' | 'stop' | 'refresh' | null>(null)
  const [tradingViewStatus, setTradingViewStatus] = useState<TradingViewWebhookStatusResponse | null>(null)
  const [tradingViewActionState, setTradingViewActionState] = useState<
    'configure' | 'reset' | 'copy-url' | 'copy-strategy' | 'copy-line' | 'test'
  | null>(null)
  const [tradingViewMessage, setTradingViewMessage] = useState('Configure the webhook once, then paste the generated JSON into TradingView alerts.')
  const [tradingViewError, setTradingViewError] = useState('')
  const [tradingViewSecret, setTradingViewSecret] = useState('')
  const [tradingViewProduct, setTradingViewProduct] = useState<OrderDeliveryType>('ORDER_DELIVERY_TYPE_IDAY')
  const [tradingViewMode, setTradingViewMode] = useState<TradingViewMode>('line')
  const [tradingViewStrategyName, setTradingViewStrategyName] = useState('TradingView Strategy')
  const [tradingViewTag, setTradingViewTag] = useState('')
  const [tradingViewSymbol, setTradingViewSymbol] = useState('RELIANCE')
  const [tradingViewExchange, setTradingViewExchange] = useState('NSE')
  const [tradingViewOrderAction, setTradingViewOrderAction] = useState<TradingViewAction>('BUY')
  const [tradingViewQuantity, setTradingViewQuantity] = useState('1')
  const [historySourceFilter, setHistorySourceFilter] = useState<'all' | 'test' | 'live'>('all')
  const [scalperUnderlying, setScalperUnderlying] = useState<string>('NIFTY')
  const [scalperInterval, setScalperInterval] = useState<Interval>('1m')
  const [scalperCeStrikePrice, setScalperCeStrikePrice] = useState('24300')
  const [scalperPeStrikePrice, setScalperPeStrikePrice] = useState('24300')
  const [scalperExpiry, setScalperExpiry] = useState('')
  const pendingScalperAtmSync = useRef<string | null>('NIFTY')
  const pendingScalperExpiry = useRef<string | null>(null)
  const [scalperReconnectNonce, setScalperReconnectNonce] = useState(0)
  const [scalperValidating, setScalperValidating] = useState(false)
  const [scalperSnapshot, setScalperSnapshot] = useState<ScalperSnapshotResponse | null>(null)
  const [scalperSnapshotError, setScalperSnapshotError] = useState('')
  const [scalperSnapshotNotice, setScalperSnapshotNotice] = useState('')
  const [activeScalperTool, setActiveScalperTool] = useState<ScalperTool>('delta-neutral')
  const [deltaNeutralPairs, setDeltaNeutralPairs] = useState<DeltaNeutralPairRow[]>([])
  const [deltaNeutralMessage, setDeltaNeutralMessage] = useState('')
  const [deltaNeutralLoading, setDeltaNeutralLoading] = useState(false)
  const [expiryHeatmapRows, setExpiryHeatmapRows] = useState<ExpiryHeatmapRow[]>([])
  const [expiryHeatmapMessage, setExpiryHeatmapMessage] = useState('')
  const [expiryHeatmapLoading, setExpiryHeatmapLoading] = useState(false)
  const [scalperVolumeBreakoutRows, setScalperVolumeBreakoutRows] = useState<ScalperVolumeBreakoutRow[]>([])
  const [scalperVolumeBreakoutMessage, setScalperVolumeBreakoutMessage] = useState('')
  const [scalperVolumeBreakoutLoading, setScalperVolumeBreakoutLoading] = useState(false)
  const [scalperVolumeBreakoutLookbackDays, setScalperVolumeBreakoutLookbackDays] = useState<3 | 5 | 10 | 20>(5)
  const [scalperCallLots, setScalperCallLots] = useState('1')
  const [scalperPutLots, setScalperPutLots] = useState('1')
  const [scalperTradeError, setScalperTradeError] = useState('')
  const [scalperTradeMessage, setScalperTradeMessage] = useState('')
  const [scalperTradeAction, setScalperTradeAction] = useState<'buy-ce' | 'sell-ce' | 'buy-pe' | 'sell-pe' | null>(null)
  const [automateEnabled, setAutomateEnabled] = useState(false)
  const [automateConfig, setAutomateConfig] = useState<AutomateConfig>({
    panel: 'call_option',
    direction: 'both',
    lots: '1',
    maxTrades: '10',
  })
  const [loginInitialized, setLoginInitialized] = useState(false)
  const previousAlertCount = useRef(0)

  const phoneComplete = flowId.length > 0
  const otpComplete = step === 'mpin' || step === 'success'
  const mpinComplete = step === 'success'
  const derivedDeviceId = session?.device_id ?? (phone ? `Nubra-OSS-${phone}` : 'Nubra-OSS-<phone>')

  // â”€â”€ Live scalper hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const parsedScalperCeStrike = Number(scalperCeStrikePrice)
  const parsedScalperPeStrike = Number(scalperPeStrikePrice)
  const normalizedScalperExpiry = normalizeExpiryValue(scalperExpiry)
  const scalperLive = useScalperLive({
    enabled:
      view === 'scalper' &&
      !!session &&
      !session.is_demo &&
      !scalperValidating &&
      Number.isFinite(parsedScalperCeStrike) &&
      parsedScalperCeStrike > 0 &&
      Number.isFinite(parsedScalperPeStrike) &&
      parsedScalperPeStrike > 0,
    session_token: session?.access_token ?? '',
    device_id: derivedDeviceId,
    environment: session?.environment ?? 'PROD',
    underlying: scalperUnderlying,
    exchange: 'NSE',
    interval: scalperInterval,
    ce_strike_price: parsedScalperCeStrike || 1,
    pe_strike_price: parsedScalperPeStrike || 1,
    expiry: normalizedScalperExpiry,
    lookback_days: 5,
    reconnect_nonce: scalperReconnectNonce,
  })
  const scalperPanelMeta = scalperLive.panelMeta
  const scalperOptionPair = scalperLive.optionPair ?? scalperSnapshot?.option_pair ?? null

  // ── Indicator builder ────────────────────────────────────────────────────────
  const indicatorHook = useIndicators()
  const { liveVersion, liveCandlesRef } = scalperLive

  // Convert live WebSocket candles (LiveCandle[]) to OhlcvCandle[] for indicator compute engine.
  // The chart renders all candle times as (epochSeconds + IST_OFFSET_S) via toChartTime in
  // useScalperLive / ScalperLiveChart. Indicator overlay points must use the same offset so
  // they align with the correct bars. IST_OFFSET_S = 5.5 * 3600 = 19800 seconds.
  const IST_OFFSET_S = 19800
  function liveToOhlcv(panel: 'underlying' | 'call_option' | 'put_option'): OhlcvCandle[] {
    const candles = liveCandlesRef.current[panel]
    if (!candles.length) {
      // Fallback to snapshot candles when live feed hasn't initialised yet
      const snap =
        panel === 'call_option'
          ? scalperSnapshot?.call_option.candles
          : panel === 'put_option'
            ? scalperSnapshot?.put_option.candles
            : scalperSnapshot?.underlying.candles
      if (!snap) return []
      return snap.map((c) => ({
        time: Math.floor(c.epoch_ms / 1000) + IST_OFFSET_S,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }))
    }
    return candles.map((c) => ({
      time: c.time + IST_OFFSET_S,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
  }

  const indicatorOverlaysCall = useMemo(
    () => indicatorHook.computeAll(liveToOhlcv('call_option')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicatorHook.indicators, liveVersion, scalperSnapshot?.call_option.candles],
  )
  const indicatorOverlaysUnderlying = useMemo(
    () => indicatorHook.computeAll(liveToOhlcv('underlying')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicatorHook.indicators, liveVersion, scalperSnapshot?.underlying.candles],
  )
  const indicatorOverlaysPut = useMemo(
    () => indicatorHook.computeAll(liveToOhlcv('put_option')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicatorHook.indicators, liveVersion, scalperSnapshot?.put_option.candles],
  )

  // Compute signals exclusively on *closed* candles for automation.
  // The last entry in liveCandlesRef is always the currently forming candle — we slice it off
  // so automation only reacts to a candle after it has fully closed.
  const automationSignals = useMemo(() => {
    const panel = automateConfig.panel
    const raw = liveCandlesRef.current[panel]
    const IST_OFFSET_S = 19800
    let ohlcv: { time: number; open: number; high: number; low: number; close: number; volume: number }[]
    if (raw.length > 0) {
      // Drop the last (forming) candle — only closed candles
      const closed = raw.length > 1 ? raw.slice(0, -1) : raw
      ohlcv = closed.map((c) => ({
        time: c.time + IST_OFFSET_S,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
    } else {
      // Fallback to snapshot candles (these are already all closed)
      const snap =
        panel === 'call_option'
          ? scalperSnapshot?.call_option.candles
          : panel === 'put_option'
            ? scalperSnapshot?.put_option.candles
            : scalperSnapshot?.underlying.candles
      ohlcv = (snap ?? []).map((c) => ({
        time: Math.floor(c.epoch_ms / 1000) + IST_OFFSET_S,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }))
    }
    return indicatorHook.computeAll(ohlcv).signals
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automateConfig.panel, liveVersion, indicatorHook.indicators, scalperSnapshot])

  const automationHasSignals = useMemo(
    () =>
      indicatorHook.indicators.some(
        (ind) =>
          ind.enabled &&
          (ind.signal.buyCondition !== null || ind.signal.sellCondition !== null),
      ),
    [indicatorHook.indicators],
  )

  const automation = useAutomation({
    enabled: automateEnabled,
    config: automateConfig,
    session: session
      ? { session_token: session.access_token, device_id: session.device_id, environment: session.environment }
      : null,
    optionPair: scalperOptionPair
      ? {
          call_ref_id: scalperOptionPair.call_ref_id,
          put_ref_id: scalperOptionPair.put_ref_id,
          call_display_name: scalperOptionPair.call_display_name,
          put_display_name: scalperOptionPair.put_display_name,
          lot_size: scalperOptionPair.lot_size,
          tick_size: scalperOptionPair.tick_size,
          exchange: scalperOptionPair.exchange,
        }
      : null,
    panelSignals: automationSignals,
    callLtp: scalperPanelMeta?.call_option?.last_price ?? scalperSnapshot?.call_option.last_price ?? null,
    putLtp: scalperPanelMeta?.put_option?.last_price ?? scalperSnapshot?.put_option.last_price ?? null,
    underlyingLtp: scalperPanelMeta?.underlying?.last_price ?? scalperSnapshot?.underlying.last_price ?? null,
    liveVersion,
    apiBase: API_BASE_URL,
  })

  function sanitizePositiveInteger(value: string, fallback = 1): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.max(1, Math.floor(parsed))
  }

  const helperText = useMemo(() => {
    if (step === 'otp') return `OTP sent to ${maskedPhone || 'your number'}.`
    if (step === 'mpin') return 'OTP verified. Confirm MPIN to enter the product.'
    if (step === 'success') return 'Authentication complete.'
    return 'Enter your phone number, verify the OTP, then confirm MPIN.'
  }, [maskedPhone, step])

  function resetSession(reason?: string) {
    setSession(null)
    setView('login')
    setStep('start')
    setLoginInitialized(false)
    setFlowId('')
    setOtp('')
    setMpin('')
    setMaskedPhone('')
    setInstrument('')
    setNoCodeStatus(null)
    setInstrumentMeta(null)
    setStockSuggestions([])
    setVolumeBreakoutStatus(null)
    setPublicIp('')
    setProfileMenuOpen(false)
    setIsSessionChecking(false)
    setNoCodeError('')
    setVolumeBreakoutError('')
    setTradingViewStatus(null)
    setTradingViewError('')
    setTradingViewSecret('')
    setTradingViewMessage('Configure the webhook once, then paste the generated JSON into TradingView alerts.')
    setError(reason ?? '')
    setMessage(reason ?? 'Enter your phone number, verify the OTP, then confirm MPIN.')
    fetch(`${API_BASE_URL}/api/no-code/stop`, { method: 'POST' }).catch(() => undefined)
    fetch(`${API_BASE_URL}/api/volume-breakout/stop`, { method: 'POST' }).catch(() => undefined)
  }

  async function validateScalperSessionAndReconnect() {
    if (!session || session.is_demo) return

    setScalperValidating(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/session-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: session.access_token,
          device_id: session.device_id,
          environment: session.environment,
        }),
      })
      const data = (await response.json()) as SessionStatusResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to validate your session.'))
      }

      const result = data as SessionStatusResponse
      if (!result.active) {
        resetSession('Your Nubra session expired. Please log in again to restore the live scalper feed.')
        return
      }

      setScalperReconnectNonce((value) => value + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to validate your session.')
    } finally {
      setScalperValidating(false)
    }
  }

  async function submitScalperOrder(optionLeg: 'CE' | 'PE', orderSide: 'ORDER_SIDE_BUY' | 'ORDER_SIDE_SELL') {
    if (!session || session.is_demo || !scalperOptionPair) return

    const isCall = optionLeg === 'CE'
    const lots = sanitizePositiveInteger(isCall ? scalperCallLots : scalperPutLots)
    const instrumentRefId = isCall ? scalperOptionPair.call_ref_id : scalperOptionPair.put_ref_id
    const instrumentDisplayName = isCall ? scalperOptionPair.call_display_name : scalperOptionPair.put_display_name
    const ltpPrice = isCall
      ? (scalperPanelMeta?.call_option?.last_price ?? scalperSnapshot?.call_option.last_price ?? null)
      : (scalperPanelMeta?.put_option?.last_price ?? scalperSnapshot?.put_option.last_price ?? null)

    if (!instrumentRefId) {
      setScalperTradeError(`Unable to resolve ${optionLeg} contract metadata for order placement.`)
      return
    }

    const actionKey =
      orderSide === 'ORDER_SIDE_BUY'
        ? (isCall ? 'buy-ce' : 'buy-pe')
        : (isCall ? 'sell-ce' : 'sell-pe')
    setScalperTradeAction(actionKey)
    setScalperTradeError('')
    setScalperTradeMessage('')

    try {
      const response = await fetch(`${API_BASE_URL}/api/scalper/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: session.access_token,
          device_id: session.device_id,
          environment: session.environment,
          instrument_ref_id: instrumentRefId,
          instrument_display_name: instrumentDisplayName,
          option_leg: optionLeg,
          order_side: orderSide,
          lots,
          lot_size: scalperOptionPair.lot_size ?? 1,
          tick_size: scalperOptionPair.tick_size ?? 1,
          ltp_price: ltpPrice,
          order_delivery_type: 'ORDER_DELIVERY_TYPE_IDAY',
          exchange: scalperOptionPair.exchange,
          tag: `nubraoss_scalper_${optionLeg.toLowerCase()}`,
        }),
      })
      const data = (await response.json()) as ScalperOrderResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to place the scalper order.'))
      }
      const result = data as ScalperOrderResponse
      setScalperTradeMessage(`${result.message} Order ${result.order_id ?? ''} ${result.order_status ?? ''}`.trim())
    } catch (err) {
      setScalperTradeError(err instanceof Error ? err.message : 'Unable to place the scalper order.')
    } finally {
      setScalperTradeAction(null)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (session && !hasSessionExpired(session)) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
      return
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  }, [session])

  useEffect(() => {
    if (!session) return
    if (session.is_demo) {
      setIsSessionChecking(false)
      return
    }
    if (hasSessionExpired(session)) {
      resetSession('Your saved session has expired. Please log in again.')
      return
    }

    let cancelled = false
    const verifySession = async () => {
      setIsSessionChecking(true)
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/session-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: session.access_token,
            device_id: session.device_id,
            environment: session.environment,
          }),
        })
        const data = (await response.json()) as SessionStatusResponse | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to validate your session.'))
        }
        if (cancelled) return
        const result = data as SessionStatusResponse
        if (!result.active) {
          resetSession('Your Nubra session is no longer active. Please log in again.')
          return
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Unable to validate your session.')
        setIsSessionChecking(false)
        return
      }
      if (!cancelled) {
        setIsSessionChecking(false)
      }
    }

    verifySession()
    const intervalId = window.setInterval(verifySession, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      setPublicIp('')
      setTunnelStatus(null)
      return
    }
    if (session.is_demo) {
      setPublicIp('Demo mode')
      setTunnelStatus({
        running: false,
        public_url: null,
        target_url: 'http://127.0.0.1:8000',
        last_error: null,
        logs: ['Demo mode active. Start a real session to generate a public webhook URL.'],
      })
      return
    }

    const fetchPublicIp = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/system/public-ip`)
        const data = (await response.json()) as PublicIpResponse | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to fetch public IP.'))
        }
        setPublicIp((data as PublicIpResponse).ip ?? 'Unavailable')
      } catch {
        setPublicIp('Unavailable')
      }
    }

    fetchPublicIp()
  }, [session])

  useEffect(() => {
    if (!session || session.is_demo) return

    let cancelled = false

    const fetchTunnelStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/system/tunnel/status`)
        const data = (await response.json()) as TunnelStatusResponse | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to fetch tunnel status.'))
        }
        if (!cancelled) {
          setTunnelStatus(data as TunnelStatusResponse)
        }
      } catch (err) {
        if (!cancelled) {
          setTunnelStatus({
            running: false,
            public_url: null,
            target_url: 'http://127.0.0.1:8000',
            last_error: err instanceof Error ? err.message : 'Unable to fetch tunnel status.',
            logs: [],
          })
        }
      }
    }

    fetchTunnelStatus()
    const intervalId = window.setInterval(fetchTunnelStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [session])

  useEffect(() => {
    if (!session) {
      setTradingViewStatus(null)
      return
    }
    if (session.is_demo) {
      setTradingViewStatus({
        configured: false,
        environment: session.environment,
        broker: session.broker,
        user_name: session.user_name,
        account_id: session.account_id,
        configured_at_utc: null,
        order_delivery_type: tradingViewProduct,
        secret: null,
        has_secret: false,
        webhook_path: '/api/webhooks/tradingview',
        webhook_url: null,
        strategy_template: {},
        line_alert_template: {},
        execution_enabled: false,
        last_error: null,
        logs: [
          {
            time_ist: new Date().toLocaleString(),
            level: 'info',
            message: 'Demo mode active. Use a real session to configure TradingView webhooks.',
            payload: null,
          },
        ],
        history: [],
        summary: {
          total_events: 0,
          live_events: 0,
          test_events: 0,
          blocked_events: 0,
          error_events: 0,
          accepted_events: 0,
          today_pnl: 0,
          today_orders: 0,
        },
        order_history: [],
        positions: [],
        pnl_summary: {
          realized_pnl: 0,
          unrealized_pnl: 0,
          total_pnl: 0,
          open_positions: 0,
          closed_groups: 0,
        },
      })
      return
    }

    let cancelled = false

    const fetchTradingViewStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/status`)
        const data = (await response.json()) as TradingViewWebhookStatusResponse | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to fetch TradingView webhook status.'))
        }
        if (!cancelled) {
          const status = data as TradingViewWebhookStatusResponse
          setTradingViewStatus(status)
          if (status.secret) setTradingViewSecret(status.secret)
          if (status.order_delivery_type) setTradingViewProduct(status.order_delivery_type)
          setTradingViewError(status.last_error ?? '')
        }
      } catch (err) {
        if (!cancelled) {
          setTradingViewError(err instanceof Error ? err.message : 'Unable to fetch TradingView webhook status.')
        }
      }
    }

    fetchTradingViewStatus()
    const intervalId = window.setInterval(fetchTradingViewStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [session])

  useEffect(() => {
    if (view !== 'no-code') return

    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/no-code/status`)
        const data = (await response.json()) as NoCodeStatus | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to fetch No Code Algo status.'))
        }
        const status = data as NoCodeStatus
        setNoCodeStatus(status)
        if (status.last_error) {
          setNoCodeError(status.last_error)
        } else {
          setNoCodeError('')
        }
        if (status.alerts.length > previousAlertCount.current) {
          const latest = status.alerts[0]
          const alertMessage = `Signal: ${latest.signal} on ${latest.instrument} at ${latest.triggered_at_ist}`
          setNoCodeMessage(alertMessage)
          window.alert(alertMessage)
        }
        previousAlertCount.current = status.alerts.length
      } catch (err) {
        setNoCodeError(err instanceof Error ? err.message : 'Unable to fetch No Code Algo status.')
      }
    }

    fetchStatus()
    const intervalId = window.setInterval(fetchStatus, 5000)
    return () => window.clearInterval(intervalId)
  }, [view])

  useEffect(() => {
    if (view !== 'volume-breakout' || !session) return

    let cancelled = false
    let intervalId: number | null = null

    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/volume-breakout/status`)
        const data = (await response.json()) as VolumeBreakoutStatus | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to fetch Volume Breakout status.'))
        }
        if (cancelled) return
        const status = data as VolumeBreakoutStatus
        setVolumeBreakoutStatus(status)
        setVolumeBreakoutError(status.last_error ?? '')
      } catch (err) {
        if (cancelled) return
        setVolumeBreakoutError(err instanceof Error ? err.message : 'Unable to fetch Volume Breakout status.')
      }
    }

    const startScanner = async () => {
      setVolumeBreakoutError('')
      setVolumeBreakoutMessage('Loading stored history and opening the live websocket overlay...')
      try {
        const response = await fetch(`${API_BASE_URL}/api/volume-breakout/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: session.access_token,
            device_id: derivedDeviceId,
            environment: session.environment,
            universe_slug: 'volume-breakout-v1',
            interval: '5m',
            lookback_days: 10,
            refresh_seconds: 30,
            min_volume_ratio: 1.5,
            limit: 12,
          }),
        })
        const data = (await response.json()) as VolumeBreakoutStartResponse | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to start Volume Breakout scanner.'))
        }
        if (cancelled) return
        const result = data as VolumeBreakoutStartResponse
        setVolumeBreakoutStatus(result.job)
        setVolumeBreakoutMessage(result.message)
        setVolumeBreakoutError(result.job.last_error ?? '')
        intervalId = window.setInterval(fetchStatus, 5000)
      } catch (err) {
        if (cancelled) return
        setVolumeBreakoutError(err instanceof Error ? err.message : 'Unable to start Volume Breakout scanner.')
      }
    }

    startScanner()

    return () => {
      cancelled = true
      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
      setVolumeBreakoutStatus(null)
      fetch(`${API_BASE_URL}/api/volume-breakout/stop`, { method: 'POST' }).catch(() => undefined)
    }
  }, [view, session, derivedDeviceId])

  useEffect(() => {
    const lotSize = noCodeStatus?.execution?.instrument_lot_size
    if (!lotSize || lotSize <= 1) return
    if (!orderQty || orderQty === '1') {
      setOrderQty(String(lotSize))
    }
  }, [noCodeStatus?.execution?.instrument_lot_size, orderQty])

  useEffect(() => {
    if (view !== 'no-code' || !session || !instrument.trim()) {
      setInstrumentMeta(null)
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/no-code/instrument-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: session.access_token,
            device_id: derivedDeviceId,
            environment: session.environment,
            instrument,
          }),
          signal: controller.signal,
        })
        const data = (await response.json()) as NoCodeInstrumentMeta | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to resolve instrument metadata.'))
        }
        const meta = data as NoCodeInstrumentMeta
        setInstrumentMeta(meta)
        if (!orderQty || orderQty === '1') {
          setOrderQty(String(meta.lot_size))
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setInstrumentMeta(null)
      }
    }, 350)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [view, session, instrument, derivedDeviceId, orderQty])

  useEffect(() => {
    if (view !== 'no-code' || !session || instrument.trim().length < 1) {
      setStockSuggestions([])
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/instruments/stocks/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: session.access_token,
            device_id: derivedDeviceId,
            environment: session.environment,
            query: instrument,
            limit: 8,
          }),
          signal: controller.signal,
        })
        const data = (await response.json()) as { items: StockSearchItem[] } | ApiErrorPayload
        if (!response.ok) {
          throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to search stocks.'))
        }
        setStockSuggestions((data as { items: StockSearchItem[] }).items)
      } catch (err) {
        if (controller.signal.aborted) return
        setStockSuggestions([])
      }
    }, 200)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [view, session, instrument, derivedDeviceId])

  useEffect(() => {
    const nextStrike = defaultScalperStrike(scalperUnderlying)
    pendingScalperAtmSync.current = scalperUnderlying
    setScalperCeStrikePrice(nextStrike)
    setScalperPeStrikePrice(nextStrike)
    // If a breakout card navigation set a specific expiry, use it; otherwise reset.
    if (pendingScalperExpiry.current !== null) {
      setScalperExpiry(pendingScalperExpiry.current)
      pendingScalperExpiry.current = null
    } else {
      setScalperExpiry('')
    }
  }, [scalperUnderlying])

  useEffect(() => {
    if (view !== 'scalper' || pendingScalperAtmSync.current !== scalperUnderlying) return
    if (!scalperSnapshot || scalperSnapshot.underlying.last_price == null) return
    const instrumentName = `${scalperSnapshot.underlying.instrument} ${scalperSnapshot.underlying.display_name}`.toUpperCase()
    if (!instrumentName.includes(scalperUnderlying)) return
    const atmStrike = snapScalperStrike(scalperSnapshot.underlying.last_price, scalperUnderlying)
    setScalperCeStrikePrice(atmStrike)
    setScalperPeStrikePrice(atmStrike)
    pendingScalperAtmSync.current = null
  }, [view, scalperSnapshot, scalperUnderlying])

  useEffect(() => {
    if (view !== 'scalper') return
    const resolvedExpiry = formatExpiryInputValue(scalperOptionPair?.expiry)
    if (!resolvedExpiry) return
    if (resolvedExpiry !== formatExpiryInputValue(scalperExpiry)) {
      setScalperExpiry(resolvedExpiry)
    }
  }, [view, scalperOptionPair?.expiry, scalperExpiry])

  useEffect(() => {
    if (view !== 'scalper' || !session || session.is_demo) {
      setScalperSnapshot(null)
      setScalperSnapshotError('')
      setScalperSnapshotNotice('')
      return
    }

    const activeSession = session
    const controller = new AbortController()
    const cacheKeys = scalperSnapshotCacheKeys({
      underlying: scalperUnderlying,
      interval: scalperInterval,
      ceStrike: scalperCeStrikePrice,
      peStrike: scalperPeStrikePrice,
      expiry: normalizedScalperExpiry ?? '',
    })

    async function loadScalperSnapshot() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/scalper/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: activeSession.access_token,
            device_id: derivedDeviceId,
            environment: activeSession.environment,
            underlying: scalperUnderlying,
            exchange: 'NSE',
            interval: scalperInterval,
            ce_strike_price: parsedScalperCeStrike || 1,
            pe_strike_price: parsedScalperPeStrike || 1,
            expiry: normalizedScalperExpiry,
            lookback_days: 5,
          }),
          signal: controller.signal,
        })

        const payload = (await response.json().catch(() => null)) as ScalperSnapshotResponse | ApiErrorPayload | null
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload as ApiErrorPayload | null, 'Unable to load scalper snapshot.'))
        }
        if (controller.signal.aborted) return
        const snapshot = payload as ScalperSnapshotResponse
        setScalperSnapshot(snapshot)
        setScalperSnapshotError('')
        setScalperSnapshotNotice('')
        saveCachedScalperSnapshot(cacheKeys, snapshot)
      } catch (err) {
        if (controller.signal.aborted) return
        const cachedSnapshot = loadCachedScalperSnapshot(cacheKeys)
        if (cachedSnapshot) {
          setScalperSnapshot(cachedSnapshot)
          setScalperSnapshotError('')
          setScalperSnapshotNotice('Showing the last saved trading-day snapshot because live/weekend data is unavailable.')
          return
        }
        setScalperSnapshot(null)
        setScalperSnapshotNotice('')
        setScalperSnapshotError(err instanceof Error ? err.message : 'Unable to load scalper snapshot.')
      }
    }

    void loadScalperSnapshot()

    return () => controller.abort()
  }, [
    view,
    session,
    derivedDeviceId,
    scalperUnderlying,
    scalperInterval,
    parsedScalperCeStrike,
    parsedScalperPeStrike,
    normalizedScalperExpiry,
  ])

  useEffect(() => {
    if (view !== 'scalper' || !session || session.is_demo) {
      setDeltaNeutralPairs([])
      setDeltaNeutralMessage('')
      setDeltaNeutralLoading(false)
      return
    }

    const activeSession = session
    const controller = new AbortController()

    async function loadDeltaNeutralPairs() {
      setDeltaNeutralLoading(true)
      setDeltaNeutralMessage('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/scalper/delta-neutral`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: activeSession.access_token,
            device_id: derivedDeviceId,
            environment: activeSession.environment,
            underlying: scalperUnderlying,
            exchange: 'NSE',
            expiry: normalizedScalperExpiry,
            limit: 5,
          }),
          signal: controller.signal,
        })

        const payload = (await response.json().catch(() => null)) as DeltaNeutralPairsResponse | ApiErrorPayload | null

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload as ApiErrorPayload | null, 'Failed to load delta neutral pairs.'))
        }

        const pairs = ((payload as DeltaNeutralPairsResponse | null)?.pairs ?? []).slice(0, 5)
        if (controller.signal.aborted) return

        setDeltaNeutralPairs(pairs)
        setDeltaNeutralMessage(
          pairs.length > 0
            ? 'Top CE / PE combinations ranked by real Nubra option delta balance for the selected underlying.'
            : 'No pairs available right now. Adjust expiry or reload the live session.',
        )
      } catch (err) {
        if (controller.signal.aborted) return
        const nextMessage = err instanceof Error ? err.message : 'Failed to load delta neutral pairs.'
        setDeltaNeutralPairs([])
        setDeltaNeutralMessage(nextMessage)
      } finally {
        if (!controller.signal.aborted) {
          setDeltaNeutralLoading(false)
        }
      }
    }

    void loadDeltaNeutralPairs()

    return () => controller.abort()
  }, [view, session, derivedDeviceId, scalperUnderlying, normalizedScalperExpiry])

  useEffect(() => {
    if (view !== 'scalper' || !session || session.is_demo) {
      setExpiryHeatmapRows([])
      setExpiryHeatmapMessage('')
      setExpiryHeatmapLoading(false)
      return
    }

    const activeSession = session
    const controller = new AbortController()

    async function loadExpiryHeatmap() {
      setExpiryHeatmapLoading(true)
      setExpiryHeatmapMessage('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/scalper/expiry-heatmap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: activeSession.access_token,
            device_id: derivedDeviceId,
            environment: activeSession.environment,
            underlying: scalperUnderlying,
            exchange: 'NSE',
            interval: scalperInterval,
            expiry: normalizedScalperExpiry,
            limit: 9,
          }),
          signal: controller.signal,
        })

        const payload = (await response.json().catch(() => null)) as ExpiryHeatmapResponse | ApiErrorPayload | null

        if (!response.ok) {
          throw new Error(extractErrorMessage(payload as ApiErrorPayload | null, 'Failed to load expiry heatmap.'))
        }

        const rows = (payload as ExpiryHeatmapResponse | null)?.rows ?? []
        if (controller.signal.aborted) return

        setExpiryHeatmapRows(rows)
        setExpiryHeatmapMessage(
          rows.length > 0
            ? 'Heatmap intensity is based on the latest available CE / PE snapshot around ATM.'
            : 'No expiry heatmap rows are available yet.',
        )
      } catch (err) {
        if (controller.signal.aborted) return
        const nextMessage = err instanceof Error ? err.message : 'Failed to load expiry heatmap.'
        setExpiryHeatmapRows([])
        setExpiryHeatmapMessage(nextMessage)
      } finally {
        if (!controller.signal.aborted) {
          setExpiryHeatmapLoading(false)
        }
      }
    }

    void loadExpiryHeatmap()
    const refreshId = window.setInterval(() => {
      void loadExpiryHeatmap()
    }, 20000)

    return () => {
      controller.abort()
      window.clearInterval(refreshId)
    }
  }, [view, session, derivedDeviceId, scalperUnderlying, normalizedScalperExpiry, scalperInterval])

  useEffect(() => {
    if (view !== 'scalper' || !session || session.is_demo) {
      setScalperVolumeBreakoutRows([])
      setScalperVolumeBreakoutMessage('')
      setScalperVolumeBreakoutLoading(false)
      return
    }

    const activeSession = session
    const controller = new AbortController()

    async function loadScalperVolumeBreakout() {
      setScalperVolumeBreakoutLoading(true)
      setScalperVolumeBreakoutMessage('')

      try {
        const response = await fetch(`${API_BASE_URL}/api/scalper/volume-breakout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: activeSession.access_token,
            device_id: derivedDeviceId,
            environment: activeSession.environment,
            exchange: 'NSE',
            interval: scalperInterval,
            lookback_days: scalperVolumeBreakoutLookbackDays,
            limit: 30,
          }),
          signal: controller.signal,
        })

        const payload = (await response.json().catch(() => null)) as ScalperVolumeBreakoutResponse | ApiErrorPayload | null
        if (!response.ok) {
          throw new Error(extractErrorMessage(payload as ApiErrorPayload | null, 'Failed to load volume breakout finder.'))
        }

        const rows = (payload as ScalperVolumeBreakoutResponse | null)?.rows ?? []
        if (controller.signal.aborted) return

        setScalperVolumeBreakoutRows(rows)
          setScalperVolumeBreakoutMessage(
            rows.length > 0
              ? `Current ${scalperInterval} candle volume is compared against the average of all ${scalperInterval} candles from the previous ${scalperVolumeBreakoutLookbackDays} trading days, with historical fallback after market hours.`
              : 'No breakout candidates are available for this trading-day baseline yet.',
          )
      } catch (err) {
        if (controller.signal.aborted) return
        const nextMessage = err instanceof Error ? err.message : 'Failed to load volume breakout finder.'
        setScalperVolumeBreakoutRows([])
        setScalperVolumeBreakoutMessage(nextMessage)
      } finally {
        if (!controller.signal.aborted) {
          setScalperVolumeBreakoutLoading(false)
        }
      }
    }

    void loadScalperVolumeBreakout()
    const refreshId = window.setInterval(() => {
      void loadScalperVolumeBreakout()
    }, 30000)

    return () => {
      controller.abort()
      window.clearInterval(refreshId)
    }
  }, [view, session, derivedDeviceId, scalperInterval, scalperVolumeBreakoutLookbackDays])

  async function handleStart(event: FormEvent) {
    event.preventDefault()
    setError('')
    setActiveAction('phone')

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, environment }),
      })

      const data = (await parseJsonResponse<StartResponse | ApiErrorPayload>(response)) as StartResponse | ApiErrorPayload | null
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to start login flow.'))
      }
      if (!data) {
        throw new Error('Login service returned an empty response. Please try again.')
      }

      const result = data as StartResponse
      setFlowId(result.flow_id)
      setMaskedPhone(result.masked_phone)
      setMessage(result.message)
      setStep(result.next_step)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start login flow.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleOtp(event: FormEvent) {
    event.preventDefault()
    setError('')
    setActiveAction('otp')

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_id: flowId, otp }),
      })

      const data = (await parseJsonResponse<OtpResponse | ApiErrorPayload>(response)) as OtpResponse | ApiErrorPayload | null
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to verify OTP.'))
      }
      if (!data) {
        throw new Error('OTP verification returned an empty response. Please try again.')
      }

      setMessage((data as OtpResponse).message)
      setStep('mpin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify OTP.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleMpin(event: FormEvent) {
    event.preventDefault()
    setError('')
    setActiveAction('mpin')

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify-mpin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow_id: flowId, mpin }),
      })

      const data = (await parseJsonResponse<SuccessResponse | ApiErrorPayload>(response)) as SuccessResponse | ApiErrorPayload | null
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to verify MPIN.'))
      }
      if (!data) {
        throw new Error('MPIN verification returned an empty response. Please try again.')
      }

      const result = data as SuccessResponse
      setSession(result)
      setIsSessionChecking(false)
      setMessage(result.message)
      setStep('success')
      setView('dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify MPIN.')
    } finally {
      setActiveAction(null)
    }
  }

  function handleDemoLogin() {
    setLoginInitialized(true)
    setSession(demoSession)
    setEnvironment(demoSession.environment)
    setView('dashboard')
    setStep('success')
    setFlowId('')
    setMaskedPhone('')
    setPhone('')
    setOtp('')
    setMpin('')
    setError('')
    setProfileMenuOpen(false)
    setMessage(demoSession.message)
    setNoCodeMessage('Configure one instrument and start the IST scheduler.')
    setVolumeBreakoutMessage(
      'DB bootstrap loads first, then the backend websocket overlays live bucket updates while this page stays open.',
    )
  }

  function handleDashboardCardOpen(nextView: Extract<View, 'no-code' | 'volume-breakout' | 'tradingview-webhook' | 'scalper'>) {
    if (session?.is_demo && nextView !== 'tradingview-webhook' && nextView !== 'scalper') {
      setMessage('Demo mode is only for reviewing the UI shell. Use a real login to run tools.')
      return
    }
    setView(nextView)
  }

  async function handleNoCodeStart(event: FormEvent) {
    event.preventDefault()
    if (!session) return

    setNoCodeError('')
    setNoCodeMessage('Arming the scheduler...')
    setActiveAction('no-code')

    try {
      const payload: Record<string, unknown> = {
        session_token: session.access_token,
        device_id: derivedDeviceId,
        environment: session.environment,
        instrument,
        interval,
        indicator,
        order_qty: Number(orderQty),
        order_delivery_type: orderDeliveryType,
        strategy_side_mode: strategySideMode,
      }

      if (indicator === 'EMA') {
        payload.ema = { fast: Number(emaFast), slow: Number(emaSlow) }
      } else if (indicator === 'MA') {
        payload.ma = { fast: Number(maFast), slow: Number(maSlow) }
      } else {
        payload.rsi = {
          length: Number(rsiLength),
          upper: Number(rsiUpper),
          lower: Number(rsiLower),
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/no-code/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as NoCodeStartResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to start No Code Algo.'))
      }

      const result = data as NoCodeStartResponse
      setNoCodeStatus(result.job)
      setNoCodeMessage(result.message)
      previousAlertCount.current = result.job.alerts.length
    } catch (err) {
      setNoCodeError(err instanceof Error ? err.message : 'Unable to start No Code Algo.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleNoCodeStop() {
    setNoCodeError('')
    setActiveAction('stop')
    try {
      const response = await fetch(`${API_BASE_URL}/api/no-code/stop`, {
        method: 'POST',
      })
      const data = (await response.json()) as NoCodeStopResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to stop No Code Algo.'))
      }
      const result = data as NoCodeStopResponse
      setNoCodeMessage(result.message ?? 'No Code Algo stopped.')
      setNoCodeStatus({
        running: false,
        instrument: null,
        interval: null,
        indicator: null,
        strategy_side_mode: null,
        last_run_ist: null,
        next_run_ist: null,
        market_status: 'stopped',
        last_signal: null,
        last_error: null,
        alerts: [],
        tracker_rows: [],
        debug: null,
        execution: null,
      })
      previousAlertCount.current = 0
    } catch (err) {
      setNoCodeError(err instanceof Error ? err.message : 'Unable to stop No Code Algo.')
    } finally {
      setActiveAction(null)
    }
  }

  async function handleTunnelAction(action: 'start' | 'stop' | 'refresh') {
    if (!session || session.is_demo) return
    setTunnelAction(action)
    try {
      const endpoint =
        action === 'start'
          ? '/api/system/tunnel/start'
          : action === 'stop'
            ? '/api/system/tunnel/stop'
            : '/api/system/tunnel/status'
      const method = action === 'refresh' ? 'GET' : 'POST'
      const response = await fetch(`${API_BASE_URL}${endpoint}`, { method })
      const data = (await response.json()) as TunnelStatusResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to manage Cloudflare tunnel.'))
      }
      setTunnelStatus(data as TunnelStatusResponse)
    } catch (err) {
      setTunnelStatus((current) => ({
        running: current?.running ?? false,
        public_url: current?.public_url ?? null,
        target_url: current?.target_url ?? 'http://127.0.0.1:8000',
        last_error: err instanceof Error ? err.message : 'Unable to manage Cloudflare tunnel.',
        logs: current?.logs ?? [],
      }))
    } finally {
      setTunnelAction(null)
    }
  }

  async function handleTradingViewConfigure() {
    if (!session || session.is_demo) return
    setTradingViewError('')
    setTradingViewActionState('configure')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: session.access_token,
          device_id: derivedDeviceId,
          environment: session.environment,
          user_name: session.user_name,
          account_id: session.account_id,
          secret: tradingViewSecret.trim() || undefined,
          order_delivery_type: tradingViewProduct,
        }),
      })
      const data = (await response.json()) as TradingViewWebhookConfigureResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to configure TradingView webhook.'))
      }
      const result = data as TradingViewWebhookConfigureResponse
      setTradingViewStatus(result.config)
      setTradingViewSecret(result.config.secret ?? '')
      setTradingViewProduct(result.config.order_delivery_type ?? tradingViewProduct)
      setTradingViewMessage(result.message)
    } catch (err) {
      setTradingViewError(err instanceof Error ? err.message : 'Unable to configure TradingView webhook.')
    } finally {
      setTradingViewActionState(null)
    }
  }

  async function handleTradingViewReset() {
    setTradingViewError('')
    setTradingViewActionState('reset')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/reset`, {
        method: 'POST',
      })
      const data = (await response.json()) as TradingViewWebhookResetResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to reset TradingView webhook.'))
      }
      const result = data as TradingViewWebhookResetResponse
      setTradingViewStatus({
        configured: false,
        environment: session?.environment ?? null,
        broker: session?.broker ?? null,
        user_name: session?.user_name ?? null,
        account_id: session?.account_id ?? null,
        configured_at_utc: null,
        order_delivery_type: tradingViewProduct,
        secret: null,
        has_secret: false,
        webhook_path: '/api/webhooks/tradingview',
        webhook_url: tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : null,
        strategy_template: {},
        line_alert_template: {},
        execution_enabled: true,
        last_error: null,
        logs: [],
        history: [],
        summary: {
          total_events: 0,
          live_events: 0,
          test_events: 0,
          blocked_events: 0,
          error_events: 0,
          accepted_events: 0,
          today_pnl: 0,
          today_orders: 0,
        },
        order_history: [],
        positions: [],
        pnl_summary: {
          realized_pnl: 0,
          unrealized_pnl: 0,
          total_pnl: 0,
          open_positions: 0,
          closed_groups: 0,
        },
      })
      setTradingViewSecret('')
      setTradingViewMessage(result.message)
    } catch (err) {
      setTradingViewError(err instanceof Error ? err.message : 'Unable to reset TradingView webhook.')
    } finally {
      setTradingViewActionState(null)
    }
  }

  async function handleTradingViewKillSwitch(enabled: boolean) {
    setTradingViewError('')
    setTradingViewActionState(enabled ? 'configure' : 'reset')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/execution-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_enabled: enabled }),
      })
      const data = (await response.json()) as TradingViewWebhookExecutionModeResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to update webhook execution mode.'))
      }
      setTradingViewStatus((current) => (current ? { ...current, execution_enabled: enabled } : current))
      setTradingViewMessage(enabled ? 'Webhook execution enabled.' : 'Kill switch enabled. Incoming webhook orders will be blocked.')
    } catch (err) {
      setTradingViewError(err instanceof Error ? err.message : 'Unable to update webhook execution mode.')
    } finally {
      setTradingViewActionState(null)
    }
  }

  async function copyToClipboard(value: string, kind: 'copy-url' | 'copy-strategy' | 'copy-line') {
    setTradingViewActionState(kind)
    try {
      await navigator.clipboard.writeText(value)
      setTradingViewMessage(
        kind === 'copy-url'
          ? 'Webhook URL copied.'
          : kind === 'copy-strategy'
            ? 'Strategy JSON copied.'
            : 'Line alert JSON copied.',
      )
    } catch {
      setTradingViewError('Unable to copy to clipboard.')
    } finally {
      setTradingViewActionState(null)
    }
  }

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

  const webhookUrl = tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : ''
  const resolvedTradingViewSecret = tradingViewStatus?.secret ?? tradingViewSecret
  const resolvedTradingViewProduct = tradingViewProduct
  const tradingViewStrategyPayload = {
    secret: resolvedTradingViewSecret || '<your-webhook-secret>',
    strategy: tradingViewStrategyName || 'Nubra Strategy Alert',
    instrument: tradingViewSymbol || 'RELIANCE',
    exchange: tradingViewExchange || 'NSE',
    order_side: '{{strategy.order.action}}',
    order_delivery_type: resolvedTradingViewProduct,
    price_type: 'MARKET',
    order_qty: '{{strategy.order.contracts}}',
    position_size: '{{strategy.position_size}}',
    tag: tradingViewTag || undefined,
  }
  const tradingViewLinePayload = {
    secret: resolvedTradingViewSecret || '<your-webhook-secret>',
    strategy: tradingViewStrategyName || 'Nubra Line Alert',
    instrument: tradingViewSymbol || 'RELIANCE',
    exchange: tradingViewExchange || 'NSE',
    order_side: tradingViewOrderAction,
    order_delivery_type: resolvedTradingViewProduct,
    price_type: 'MARKET',
    order_qty: Number(tradingViewQuantity || '1'),
    tag: tradingViewTag || undefined,
  }
  const tradingViewStrategyJson = JSON.stringify(tradingViewStrategyPayload, null, 2)
  const tradingViewLineJson = JSON.stringify(tradingViewLinePayload, null, 2)
  const filteredHistory = (tradingViewStatus?.history ?? []).filter((entry) =>
    historySourceFilter === 'all' ? true : entry.source === historySourceFilter,
  )
  const filteredOrderHistory = (tradingViewStatus?.order_history ?? []).filter((entry) =>
    historySourceFilter === 'all' ? true : entry.source === historySourceFilter,
  )
  const filteredPositions = (tradingViewStatus?.positions ?? []).filter((position) => {
    if (historySourceFilter === 'all') return true
    const matchingTrade = filteredOrderHistory.find(
      (entry) =>
        (entry.strategy ?? null) === (position.strategy ?? null) &&
        (entry.tag ?? null) === (position.tag ?? null) &&
        entry.instrument === position.instrument &&
        entry.exchange === position.exchange,
    )
    return Boolean(matchingTrade)
  })
  const webhookConfigured = Boolean(tradingViewStatus?.configured)
  const tunnelReady = Boolean(tunnelStatus?.public_url)
  const hasTestHistory = (tradingViewStatus?.history ?? []).some((entry) => entry.source === 'test')
  const executionEnabled = tradingViewStatus?.execution_enabled !== false
  const nextWebhookAction = !webhookConfigured
    ? 'Step 1: save your webhook secret and default product.'
    : !tunnelReady
      ? 'Step 2: generate the public webhook URL.'
      : !hasTestHistory
        ? 'Step 4: send a test payload before going live.'
        : !executionEnabled
          ? 'Kill switch is on. Re-enable execution before using live TradingView alerts.'
          : 'Setup complete. Copy the live URL and payload into TradingView.'

  async function handleTradingViewTest() {
    if (!session || session.is_demo) return
    setTradingViewError('')
    setTradingViewActionState('test')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-source': 'test' },
        body: JSON.stringify(tradingViewLinePayload),
      })
      const data = (await response.json()) as Record<string, unknown> | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to send test webhook payload.'))
      }
      setTradingViewMessage('Test payload sent. Check webhook activity below for capture and order result.')
      const statusResponse = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/status`)
      const statusData = (await statusResponse.json()) as TradingViewWebhookStatusResponse | ApiErrorPayload
      if (statusResponse.ok) {
        setTradingViewStatus(statusData as TradingViewWebhookStatusResponse)
      }
    } catch (err) {
      setTradingViewError(err instanceof Error ? err.message : 'Unable to send test webhook payload.')
    } finally {
      setTradingViewActionState(null)
    }
  }

  function renderDashboardNav(activeTab: string) {
    return (
      <section className="dashboard-topbar">
        <header className="dashboard-nav">
          <div className="dashboard-brand">
            <img src={nubraLogo} alt="Nubra" className="brand-logo dashboard-brand-logo" />
            <div className="dashboard-brand-copy">
              <span>NubraOSS</span>
              <small>Trading workspace</small>
            </div>
          </div>

          <nav className="dashboard-tabs" aria-label="Primary">
            {dashboardTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === activeTab ? 'dashboard-tab active' : 'dashboard-tab'}
              >
                {tab}
              </button>
            ))}
          </nav>

          <div className="dashboard-actions">
            {renderThemeToggle('dashboard-theme-toggle')}
            <div className="profile-menu">
              <button
                type="button"
                className="avatar-pill profile-trigger"
                onClick={() => setProfileMenuOpen((open) => !open)}
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
              >
                {session?.user_name?.[0] ?? 'N'}
              </button>
              {profileMenuOpen ? (
                <div className="profile-popover" role="menu" aria-label="Profile menu">
                  <div className="profile-popover-header">
                    <strong>{session?.user_name ?? 'Nubra User'}</strong>
                    <span>{session?.account_id ?? 'NUBRA'}</span>
                  </div>
                  <div className="profile-meta">
                    <span className="pill">{session?.broker.toLowerCase() ?? 'nubra'}</span>
                    <span className="pill pill-dark">
                      {session?.environment === 'UAT' ? 'UAT Mode' : 'Live Mode'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button profile-logout"
                    onClick={() => resetSession()}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="dashboard-meta-row">
          <div className="dashboard-meta-spacer" />
          <div className="public-ip-card">
            <span className="public-ip-label">Public IP</span>
              <strong>{publicIp || 'Loading...'}</strong>
            </div>
          </div>
      </section>
    )
  }

  if (view === 'no-code') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('Tools')}

          <section className="dashboard-header no-code-header">
            <div>
              <button type="button" className="back-link" onClick={() => setView('dashboard')}>
                {'< Back to Dashboard'}
              </button>
              <h1>No Code Algo</h1>
              <p>Run one intraday historical-data strategy on exact IST interval boundaries.</p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={handleNoCodeStop}
                disabled={activeAction !== null || !noCodeStatus?.running}
              >
                {activeAction === 'stop' ? 'Stopping...' : 'Stop'}
              </button>
            </div>
          </section>

          <section className="no-code-grid">
            <form className="dashboard-module-card no-code-config-card" onSubmit={handleNoCodeStart}>
              <h2>Strategy Setup</h2>
              <p className="module-subtitle">
                Uses today&apos;s intraday historical candles only and ignores the current incomplete candle.
              </p>

              <label className="field-group">
                <span>Instrument</span>
                <input
                  list="stock-suggestions"
                  value={instrument}
                  onChange={(event) => setInstrument(event.target.value.toUpperCase())}
                  placeholder="Type a stock, e.g. RELIANCE"
                  required
                />
                <datalist id="stock-suggestions">
                  {stockSuggestions.map((item) => (
                    <option key={`${item.exchange}-${item.ref_id}`} value={item.instrument}>
                      {item.display_name} ({item.exchange})
                    </option>
                  ))}
                </datalist>
              </label>

              <label className="field-group">
                <span>Interval</span>
                <select value={interval} onChange={(event) => setIntervalValue(event.target.value as Interval)}>
                  {intervals.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <div className="param-grid">
                <label className="field-group">
                  <span>Order Qty</span>
                  <input value={orderQty} onChange={(e) => setOrderQty(e.target.value.replace(/\D/g, ''))} />
                </label>
                <label className="field-group">
                  <span>Product</span>
                  <select
                    value={orderDeliveryType}
                    onChange={(event) => setOrderDeliveryType(event.target.value as OrderDeliveryType)}
                  >
                    <option value="ORDER_DELIVERY_TYPE_IDAY">Intraday</option>
                    <option value="ORDER_DELIVERY_TYPE_CNC">CNC</option>
                  </select>
                </label>
              </div>

              <div className="field-group">
                <span>Indicator</span>
                <div className="indicator-grid">
                  {(['EMA', 'MA', 'RSI'] as Indicator[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={indicator === item ? 'indicator-box active' : 'indicator-box'}
                      onClick={() => setIndicator(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <span>Strategy Side</span>
                <div className="indicator-grid strategy-mode-grid">
                  <button
                    type="button"
                    className={strategySideMode === 'LONG_ONLY' ? 'indicator-box active mode-long' : 'indicator-box mode-long'}
                    aria-pressed={strategySideMode === 'LONG_ONLY'}
                    onClick={() => setStrategySideMode('LONG_ONLY')}
                  >
                    Long Only
                  </button>
                  <button
                    type="button"
                    className={strategySideMode === 'SHORT_ONLY' ? 'indicator-box active mode-short' : 'indicator-box mode-short'}
                    aria-pressed={strategySideMode === 'SHORT_ONLY'}
                    onClick={() => setStrategySideMode('SHORT_ONLY')}
                  >
                    Short Only
                  </button>
                  <button
                    type="button"
                    className={strategySideMode === 'BOTH' ? 'indicator-box active mode-both' : 'indicator-box mode-both'}
                    aria-pressed={strategySideMode === 'BOTH'}
                    onClick={() => setStrategySideMode('BOTH')}
                  >
                    Both
                  </button>
                </div>
              </div>

              {indicator === 'EMA' && (
                <div className="param-grid">
                  <label className="field-group">
                    <span>Fast EMA</span>
                    <input value={emaFast} onChange={(e) => setEmaFast(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field-group">
                    <span>Slow EMA</span>
                    <input value={emaSlow} onChange={(e) => setEmaSlow(e.target.value.replace(/\D/g, ''))} />
                  </label>
                </div>
              )}

              {indicator === 'MA' && (
                <div className="param-grid">
                  <label className="field-group">
                    <span>Fast MA</span>
                    <input value={maFast} onChange={(e) => setMaFast(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field-group">
                    <span>Slow MA</span>
                    <input value={maSlow} onChange={(e) => setMaSlow(e.target.value.replace(/\D/g, ''))} />
                  </label>
                </div>
              )}

              {indicator === 'RSI' && (
                <div className="param-grid param-grid-three">
                  <label className="field-group">
                    <span>RSI Length</span>
                    <input value={rsiLength} onChange={(e) => setRsiLength(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field-group">
                    <span>Upper RSI</span>
                    <input value={rsiUpper} onChange={(e) => setRsiUpper(e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field-group">
                    <span>Lower RSI</span>
                    <input value={rsiLower} onChange={(e) => setRsiLower(e.target.value.replace(/\D/g, ''))} />
                  </label>
                </div>
              )}

              <button className="primary-button wide-button" type="submit" disabled={activeAction !== null || !session}>
                {activeAction === 'no-code' ? 'Starting...' : 'Start No Code Algo'}
              </button>
            </form>

            <section className="status-column">
              <article className="dashboard-module-card">
                <h2>Runner Status</h2>
                <div className="status-list">
                  <div><span>Status</span><strong>{noCodeStatus?.running ? 'Running' : 'Stopped'}</strong></div>
                  <div><span>Market</span><strong>{noCodeStatus?.market_status ?? 'idle'}</strong></div>
                  <div><span>Instrument</span><strong>{noCodeStatus?.instrument ?? '--'}</strong></div>
                  <div><span>Interval</span><strong>{noCodeStatus?.interval ?? '--'}</strong></div>
                  <div><span>Indicator</span><strong>{noCodeStatus?.indicator ?? '--'}</strong></div>
                  <div><span>Strategy Side</span><strong>{formatStrategySideMode(noCodeStatus?.strategy_side_mode)}</strong></div>
                  <div><span>Last Run</span><strong>{noCodeStatus?.last_run_ist ?? '--'}</strong></div>
                  <div><span>Next Run</span><strong>{noCodeStatus?.next_run_ist ?? '--'}</strong></div>
                </div>
              </article>

              <article className="dashboard-module-card tracker-card">
                <h2>Positions Tracker</h2>
                <div className="tracker-table">
                  <div className="tracker-row tracker-head">
                    <span>Alert</span>
                    <span>Side</span>
                    <span>Position</span>
                    <span>Time</span>
                  </div>
                  {(noCodeStatus?.tracker_rows ?? []).length === 0 ? (
                    <div className="tracker-empty">No position events yet.</div>
                  ) : (
                    (noCodeStatus?.tracker_rows ?? []).map((row, index) => (
                      <div key={`${row.time_ist}-${index}`} className="tracker-row">
                        <span>{row.alert}</span>
                        <span>{row.side}</span>
                        <span>{row.position_state}</span>
                        <span>{row.time_ist}</span>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </section>
          </section>

          {noCodeError ? <section className="error-banner dashboard-error">{noCodeError}</section> : null}

        </section>
      </main>
    )
  }

  if (view === 'volume-breakout') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('Scanner')}

          <section className="dashboard-header no-code-header">
            <div>
              <button type="button" className="back-link" onClick={() => setView('dashboard')}>
                {'< Back to Dashboard'}
              </button>
              <h1>Volume Breakout</h1>
              <p>DB-backed stock breakout board built from stored 1-minute history for the tracked universe.</p>
            </div>
            <div className="header-actions">
              <span className="pill">
                {volumeBreakoutStatus?.interval ?? '5m'} / {volumeBreakoutStatus?.refresh_seconds ?? 30}s
              </span>
              <span className="pill">
                Live: {volumeBreakoutStatus?.live_status ?? 'idle'}
              </span>
            </div>
          </section>

          <section className="volume-summary-grid">
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Universe</span>
              <strong>{volumeBreakoutStatus?.summary.tracked_stocks ?? 0}</strong>
              <small>Tracked stocks loaded from Supabase.</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Active Breakouts</span>
              <strong>{volumeBreakoutStatus?.summary.active_breakouts ?? 0}</strong>
              <small>Stocks above the current volume-ratio threshold.</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Latest Candle</span>
              <strong>{volumeBreakoutStatus?.summary.latest_candle_ist ? 'Ready' : 'Pending'}</strong>
              <small>{volumeBreakoutStatus?.summary.latest_candle_ist ?? 'Waiting for stored bars.'}</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Price Confirmation</span>
              <strong>{volumeBreakoutStatus?.summary.leaders_with_price_breakout ?? 0}</strong>
              <small>Breakouts also trading above prior lookback highs.</small>
            </article>
          </section>

          <section className="dashboard-info-card volume-meta-card">
            <div>
              <strong>Scanner Mode</strong>
              <p>{volumeBreakoutMessage}</p>
            </div>
            <div className="volume-meta-stack">
              <span className="pill">
                WS symbols: {volumeBreakoutStatus?.live_subscribed_symbols ?? 0}
              </span>
              <span className="pill">
                Last live event: {volumeBreakoutStatus?.live_last_event_ist ?? 'Waiting...'}
              </span>
              <span className="pill">Last run: {volumeBreakoutStatus?.last_run_ist ?? 'Waiting...'}</span>
              <span className="pill">Next run: {volumeBreakoutStatus?.next_run_ist ?? 'Waiting...'}</span>
            </div>
          </section>

          <section className="volume-breakout-grid">
            <article className="dashboard-module-card volume-panel">
              <div className="panel-heading">
                <div>
                  <h2>Market Rankers</h2>
                  <p>Highest volume-ratio names computed from stored 1-minute history.</p>
                </div>
              </div>
              <div className="table-shell">
                <div className="table-row table-head volume-stock-grid">
                  <span>Stock</span>
                  <span>Exchange</span>
                  <span>Ratio</span>
                  <span>Volume</span>
                  <span>Price</span>
                </div>
                {(volumeBreakoutStatus?.market_breakouts ?? []).length === 0 ? (
                  <div className="table-empty">No market-wide leaders available yet.</div>
                ) : (
                  (volumeBreakoutStatus?.market_breakouts ?? []).map((row) => (
                    <div key={`${row.symbol}-${row.candle_time_ist}`} className="table-row volume-stock-grid">
                      <span>
                        <strong>{row.symbol}</strong>
                        <small>{row.display_name}</small>
                      </span>
                      <span>{row.exchange}</span>
                      <span className={row.meets_breakout ? 'text-success' : 'text-muted'}>
                        {row.volume_ratio.toFixed(2)}x
                      </span>
                      <span>{formatCompactNumber(row.current_volume)}</span>
                      <span className={row.is_green ? 'text-success' : 'text-danger'}>
                        {row.last_price.toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </section>

          <article className="dashboard-module-card volume-panel">
            <div className="panel-heading">
              <div>
                <h2>Fresh Entrants</h2>
                <p>New names that entered the breakout list on the latest completed candle.</p>
              </div>
            </div>
            <div className="table-shell">
              <div className="table-row table-head volume-recent-grid">
                <span>Stock</span>
                <span>Exchange</span>
                <span>Time</span>
                <span>Ratio</span>
                <span>Price Breakout</span>
              </div>
              {(volumeBreakoutStatus?.recent_breakouts ?? []).length === 0 ? (
                <div className="table-empty">No fresh entrants yet. The next completed run will populate this feed.</div>
              ) : (
                (volumeBreakoutStatus?.recent_breakouts ?? []).map((row) => (
                  <div key={`recent-${row.symbol}-${row.candle_time_ist}`} className="table-row volume-recent-grid">
                    <span>{row.symbol}</span>
                    <span>{row.exchange}</span>
                    <span>{row.candle_time_ist}</span>
                    <span>{row.volume_ratio.toFixed(2)}x</span>
                    <span className={row.is_price_breakout ? 'text-success' : 'text-muted'}>
                      {row.is_price_breakout ? formatPercent(row.price_breakout_pct) : 'Not yet'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>

          {volumeBreakoutError ? <section className="error-banner dashboard-error">{volumeBreakoutError}</section> : null}
        </section>
      </main>
    )
  }

  if (view === 'tradingview-webhook') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('TradingView')}

          <section className="dashboard-header no-code-header">
            <div>
              <button type="button" className="back-link" onClick={() => setView('dashboard')}>
                {'< Back to Dashboard'}
              </button>
              <h1>TradingView Webhook</h1>
              <p>Configure the Nubra webhook, copy either the manual or strategy alert JSON, and monitor incoming TradingView executions.</p>
            </div>
            <div className="header-actions">
              <span className="pill">
                {tradingViewStatus?.configured ? 'Configured' : 'Not configured'}
              </span>
              <span className="pill">
                {tradingViewProduct === 'ORDER_DELIVERY_TYPE_IDAY' ? 'Intraday' : 'CNC'}
              </span>
              <span className={tradingViewStatus?.execution_enabled === false ? 'pill pill-danger' : 'pill pill-success'}>
                {tradingViewStatus?.execution_enabled === false ? 'Kill Switch On' : 'Execution On'}
              </span>
            </div>
          </section>

          <section className="dashboard-info-card webhook-guide-banner">
            <div>
              <strong>Next Step</strong>
              <p>{nextWebhookAction}</p>
            </div>
            <div className="history-meta-row">
              <span className={webhookConfigured ? 'pill pill-success' : 'pill'}>1. Config {webhookConfigured ? 'Done' : 'Pending'}</span>
              <span className={tunnelReady ? 'pill pill-success' : 'pill'}>2. URL {tunnelReady ? 'Done' : 'Pending'}</span>
              <span className={hasTestHistory ? 'pill pill-success' : 'pill'}>3. Test {hasTestHistory ? 'Done' : 'Pending'}</span>
              <span className={executionEnabled ? 'pill pill-success' : 'pill pill-danger'}>4. Live {executionEnabled ? 'Ready' : 'Blocked'}</span>
            </div>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className={webhookConfigured ? 'step-badge done' : 'step-badge'}>1</span>
              <div>
                <h2>Set Up Webhook Access</h2>
                <p>Create the private secret and execution defaults that every TradingView alert will use.</p>
              </div>
            </div>

          <section className="tradingview-grid">
            <article className="dashboard-module-card webhook-config-card">
              <h2>Access & Execution Settings</h2>
              <p className="module-subtitle">
                Define the shared webhook secret and choose the default order product type for incoming TradingView alerts.
              </p>

              <label className="field-group">
                <span>Webhook Secret</span>
                <input
                  value={tradingViewSecret}
                  onChange={(event) => setTradingViewSecret(event.target.value)}
                  placeholder="Auto-generated if left blank"
                />
              </label>

              <label className="field-group">
                <span>Default Product</span>
                <select
                  value={tradingViewProduct}
                  onChange={(event) => setTradingViewProduct(event.target.value as OrderDeliveryType)}
                >
                  <option value="ORDER_DELIVERY_TYPE_IDAY">Intraday (MIS)</option>
                  <option value="ORDER_DELIVERY_TYPE_CNC">Delivery (CNC)</option>
                </select>
              </label>

              <div className="kill-switch-card">
                <div>
                  <strong>Order Execution Control</strong>
                  <p className="module-subtitle">
                    Pause live order placement instantly while continuing to capture webhook requests in the activity log.
                  </p>
                </div>
                <div className="kill-switch-actions">
                  <button
                    type="button"
                    className={tradingViewStatus?.execution_enabled === false ? 'secondary-button' : 'primary-button'}
                    onClick={() => handleTradingViewKillSwitch(true)}
                    disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                  >
                    Allow Orders
                  </button>
                  <button
                    type="button"
                    className={tradingViewStatus?.execution_enabled === false ? 'primary-button' : 'secondary-button'}
                    onClick={() => handleTradingViewKillSwitch(false)}
                    disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                  >
                    Pause Orders
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="primary-button wide-button"
                onClick={handleTradingViewConfigure}
                disabled={!session || Boolean(session?.is_demo) || tradingViewActionState !== null}
              >
                {tradingViewActionState === 'configure' ? 'Saving...' : 'Save Webhook Settings'}
              </button>
              <button
                type="button"
                className="secondary-button wide-button"
                onClick={handleTradingViewReset}
                disabled={tradingViewActionState !== null || !tradingViewStatus?.configured}
              >
                {tradingViewActionState === 'reset' ? 'Resetting...' : 'Clear Webhook Settings'}
              </button>
            </article>
          </section>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className={tunnelReady ? 'step-badge done' : 'step-badge'}>2</span>
              <div>
                <h2>Generate Public URL</h2>
                <p>Create the public HTTPS endpoint that TradingView or Postman will send requests to.</p>
              </div>
            </div>

          <section className="tradingview-grid">
            <article className="dashboard-module-card">
              <h2>Public Endpoint</h2>
              <p className="module-subtitle">
                Use the built-in Cloudflare tunnel so TradingView can reach your local machine.
              </p>

              <div className="tunnel-grid">
                <div className="tunnel-panel">
                  <span className="summary-label">Webhook URL</span>
                  <strong className="tunnel-url">
                    {tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : 'Generate URL first'}
                  </strong>
                  <small>
                    TradingView requires a public HTTPS endpoint. Start the tunnel once and reuse this URL while it stays running.
                  </small>
                </div>
                <div className="tunnel-panel">
                  <span className="summary-label">Session</span>
                  <strong>{tradingViewStatus?.user_name ?? session?.user_name ?? 'Nubra User'}</strong>
                  <small>{session?.environment ?? 'UAT'} / {tradingViewProduct === 'ORDER_DELIVERY_TYPE_IDAY' ? 'MIS' : 'CNC'}</small>
                </div>
              </div>

              <div className="tunnel-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleTunnelAction('start')}
                  disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}
                >
                  {tunnelAction === 'start' ? 'Starting...' : 'Generate Public Webhook URL'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleTunnelAction('refresh')}
                  disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleTunnelAction('stop')}
                  disabled={!tunnelStatus?.running || tunnelAction !== null}
                >
                  Stop
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => copyToClipboard(webhookUrl, 'copy-url')}
                  disabled={!webhookUrl || tradingViewActionState !== null}
                >
                  {tradingViewActionState === 'copy-url' ? 'Copying...' : 'Copy Webhook URL'}
                </button>
              </div>
            </article>
          </section>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className="step-badge">3</span>
              <div>
                <h2>Build Payload</h2>
                <p>Choose manual or strategy mode, set your fields, and generate the Nubra JSON alert body.</p>
              </div>
            </div>
          <section className="dashboard-module-card tradingview-builder-card">
            <div className="code-card-header">
              <div>
                <h2>Payload Builder</h2>
                <p className="module-subtitle">Generate the exact JSON alert body your TradingView alert should send.</p>
              </div>
              <div className="mode-toggle">
                <button
                  type="button"
                  className={tradingViewMode === 'line' ? 'indicator-box active' : 'indicator-box'}
                  onClick={() => setTradingViewMode('line')}
                >
                  Line Alert
                </button>
                <button
                  type="button"
                  className={tradingViewMode === 'strategy' ? 'indicator-box active' : 'indicator-box'}
                  onClick={() => setTradingViewMode('strategy')}
                >
                  Strategy Alert
                </button>
              </div>
            </div>

            <div className="tradingview-form-grid">
              <label className="field-group">
                <span>Strategy Name</span>
                <input value={tradingViewStrategyName} onChange={(event) => setTradingViewStrategyName(event.target.value)} />
              </label>
              <label className="field-group">
                <span>Symbol</span>
                <input value={tradingViewSymbol} onChange={(event) => setTradingViewSymbol(event.target.value.toUpperCase())} />
              </label>
              <label className="field-group">
                <span>Exchange</span>
                <select value={tradingViewExchange} onChange={(event) => setTradingViewExchange(event.target.value)}>
                  <option value="NSE">NSE</option>
                  <option value="BSE">BSE</option>
                </select>
              </label>
              <label className="field-group">
                <span>Action</span>
                <select value={tradingViewOrderAction} onChange={(event) => setTradingViewOrderAction(event.target.value as TradingViewAction)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label className="field-group">
                <span>Quantity</span>
                <input value={tradingViewQuantity} onChange={(event) => setTradingViewQuantity(event.target.value.replace(/\D/g, '') || '1')} />
              </label>
              <label className="field-group">
                <span>Tag</span>
                <input value={tradingViewTag} onChange={(event) => setTradingViewTag(event.target.value)} placeholder="swing-1 or 2026-04-15" />
              </label>
              <label className="field-group">
                <span>Product</span>
                <input value={resolvedTradingViewProduct} disabled />
              </label>
            </div>

              <div className="dashboard-info-card compact-info-row">
                <div>
                  <strong>How to use</strong>
                  <p>
                    Configure the webhook first, copy the URL into TradingView, then paste the generated Nubra alert JSON below into the alert message box.
                  </p>
                </div>
                <button
                  type="button"
                className="primary-button"
                onClick={handleTradingViewTest}
                disabled={!tradingViewStatus?.configured || !session || Boolean(session.is_demo) || tradingViewActionState !== null}
              >
                {tradingViewActionState === 'test' ? 'Sending...' : 'Send Test Payload'}
              </button>
            </div>
          </section>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className={hasTestHistory ? 'step-badge done' : 'step-badge'}>4</span>
              <div>
                <h2>Copy and Test</h2>
                <p>Copy the payload you need, then send a test order before you switch to live TradingView alerts.</p>
              </div>
            </div>
          <section className="tradingview-grid">
            <article className="dashboard-module-card code-card">
              <div className="code-card-header">
                <div>
                  <h2>Nubra Strategy JSON</h2>
                  <p className="module-subtitle">Use this for TradingView strategy scripts where side and quantity come from TradingView placeholders.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => copyToClipboard(tradingViewStrategyJson, 'copy-strategy')}
                  disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                >
                  {tradingViewActionState === 'copy-strategy' ? 'Copying...' : 'Copy JSON'}
                </button>
              </div>
              <pre className="code-block">{tradingViewStrategyJson}</pre>
            </article>

            <article className="dashboard-module-card code-card">
              <div className="code-card-header">
                <div>
                  <h2>Nubra Manual Alert JSON</h2>
                  <p className="module-subtitle">Use this for normal alerts where you want to send a fixed side and quantity in the message.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => copyToClipboard(tradingViewLineJson, 'copy-line')}
                  disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                >
                  {tradingViewActionState === 'copy-line' ? 'Copying...' : 'Copy JSON'}
                </button>
              </div>
              <pre className="code-block">{tradingViewLineJson}</pre>
            </article>
          </section>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className={executionEnabled ? 'step-badge done' : 'step-badge blocked'}>5</span>
              <div>
                <h2>Go Live and Monitor</h2>
                <p>After a successful test, paste the URL and payload into TradingView and watch history below for live traffic.</p>
              </div>
            </div>

          <section className="tradingview-grid">
            <article className="dashboard-module-card">
              <div className="code-card-header">
                <div>
                  <h2>Webhook Order History</h2>
                  <p className="module-subtitle">Every accepted webhook order with time, quantity, sent price, fill price, and current mark-to-market.</p>
                </div>
                <div className="history-meta-row">
                  <span className="pill">{filteredOrderHistory.length} orders</span>
                </div>
              </div>
              {filteredOrderHistory.length === 0 ? (
                <div className="table-empty">No accepted webhook orders yet.</div>
              ) : (
                <div className="table-shell">
                  <div className="table-row table-head webhook-order-grid">
                    <span>Time</span>
                    <span>Trade</span>
                    <span>Qty / Status</span>
                    <span>Prices</span>
                    <span>P&amp;L</span>
                  </div>
                  {filteredOrderHistory.map((entry) => (
                    <div key={`${entry.time_ist}-${entry.order_id ?? entry.instrument ?? 'trade'}`} className="table-row webhook-order-grid">
                      <span>
                        <strong>{entry.time_ist}</strong>
                        <small>{entry.source === 'test' ? 'Test' : 'Live'}</small>
                      </span>
                      <span>
                        <strong>{entry.instrument ?? '-'}</strong>
                        <small>
                          {(entry.action ?? '-')} | {entry.strategy ?? 'No strategy'} | {entry.tag ?? 'No tag'}
                        </small>
                      </span>
                      <span>
                        <strong>{entry.filled_qty ?? entry.placed_qty ?? entry.requested_qty ?? '-'}</strong>
                        <small>{entry.order_status ?? 'Pending'}</small>
                      </span>
                      <span>
                        <strong>Fill {entry.avg_filled_price?.toFixed(2) ?? 'Pending'}</strong>
                        <small>
                          Sent {entry.order_price?.toFixed(2) ?? 'Pending'} | LTP {entry.current_price?.toFixed(2) ?? 'Pending'}
                        </small>
                      </span>
                      <span>
                        <strong>{entry.pnl === null ? 'Pending' : entry.pnl.toFixed(2)}</strong>
                        <small>Order #{entry.order_id ?? '-'} </small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="dashboard-module-card">
              <div className="code-card-header">
                <div>
                  <h2>Webhook Positions</h2>
                  <p className="module-subtitle">Matched positions and P&amp;L grouped by strategy, tag, and instrument.</p>
                </div>
                <div className="history-meta-row">
                  <span className="pill">{filteredPositions.length} groups</span>
                </div>
              </div>
              {filteredPositions.length === 0 ? (
                <div className="table-empty">No grouped webhook positions yet.</div>
              ) : (
                <div className="position-ledger-list">
                  {filteredPositions.map((position) => (
                    <div key={`${position.strategy ?? 'none'}-${position.tag ?? 'none'}-${position.instrument}-${position.exchange}`} className="position-ledger-card">
                      <div className="position-ledger-head">
                        <div>
                          <strong>{position.instrument}</strong>
                          <small>
                            {position.exchange} | {position.strategy ?? 'No strategy'} | {position.tag ?? 'No tag'}
                          </small>
                        </div>
                        <span className={position.direction === 'LONG' ? 'pill pill-success' : position.direction === 'SHORT' ? 'pill pill-danger' : 'pill'}>
                          {position.direction}
                        </span>
                      </div>
                      <div className="history-stats-grid position-ledger-grid">
                        <div><span>Net Qty</span><strong>{position.net_qty}</strong></div>
                        <div><span>Avg Entry</span><strong>{position.avg_entry_price?.toFixed(2) ?? 'Pending'}</strong></div>
                        <div><span>Current Price</span><strong>{position.current_price?.toFixed(2) ?? 'Pending'}</strong></div>
                        <div><span>Realized</span><strong>{position.realized_pnl.toFixed(2)}</strong></div>
                        <div><span>Unrealized</span><strong>{position.unrealized_pnl.toFixed(2)}</strong></div>
                        <div><span>Total P&amp;L</span><strong>{position.total_pnl.toFixed(2)}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <article className="dashboard-module-card">
            <div className="code-card-header">
              <div>
                <h2>Webhook Event Log</h2>
                <p className="module-subtitle">Raw request and execution logs for test sends and live TradingView webhook traffic.</p>
              </div>
              <div className="mode-toggle">
                <button type="button" className={historySourceFilter === 'all' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('all')}>
                  All
                </button>
                <button type="button" className={historySourceFilter === 'test' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('test')}>
                  Test
                </button>
                <button type="button" className={historySourceFilter === 'live' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('live')}>
                  Live
                </button>
              </div>
            </div>
            {(filteredHistory ?? []).length === 0 ? (
              <div className="table-empty">No webhook history yet.</div>
            ) : (
              <div className="webhook-log-list">
                {filteredHistory.map((entry) => (
                  <div key={entry.id} className={`webhook-log-item ${entry.status === 'accepted' ? 'success' : entry.status === 'error' || entry.status === 'blocked' ? 'error' : ''}`}>
                    <div className="webhook-log-head">
                      <strong>{entry.message}</strong>
                      <span>{entry.time_ist}</span>
                    </div>
                    <div className="history-meta-row">
                      <span className="pill">{entry.source === 'test' ? 'Test' : 'Live'}</span>
                      <span className="pill">{entry.status}</span>
                      <span className="pill">{entry.strategy ?? 'No strategy'}</span>
                      <span className="pill">{entry.tag ?? 'No tag'}</span>
                      <span className="pill">{entry.day_ist}</span>
                    </div>
                    <div className="history-stats-grid">
                      <div><span>Instrument</span><strong>{entry.instrument ?? '-'}</strong></div>
                      <div><span>Action</span><strong>{entry.action ?? '-'}</strong></div>
                      <div><span>Qty</span><strong>{entry.quantity ?? '-'}</strong></div>
                      <div><span>Order</span><strong>{entry.order_status ?? '-'}</strong></div>
                      <div><span>P&L</span><strong>{entry.pnl === null ? 'Pending' : entry.pnl.toFixed(2)}</strong></div>
                    </div>
                    <div className="history-stats-grid history-stats-grid-detail">
                      <div><span>Requested Qty</span><strong>{entry.requested_qty ?? '-'}</strong></div>
                      <div><span>Placed Qty</span><strong>{entry.placed_qty ?? '-'}</strong></div>
                      <div><span>Filled Qty</span><strong>{entry.filled_qty ?? '-'}</strong></div>
                      <div><span>Order Price</span><strong>{entry.order_price?.toFixed(2) ?? 'Pending'}</strong></div>
                      <div><span>Avg Fill Price</span><strong>{entry.avg_filled_price?.toFixed(2) ?? 'Pending'}</strong></div>
                      <div><span>LTP Used</span><strong>{entry.ltp_price?.toFixed(2) ?? 'Pending'}</strong></div>
                      <div><span>Order ID</span><strong>{entry.order_id ?? '-'}</strong></div>
                      <div><span>Ref ID</span><strong>{entry.ref_id ?? '-'}</strong></div>
                      <div><span>Lot Size</span><strong>{entry.lot_size ?? '-'}</strong></div>
                      <div><span>Tick Size</span><strong>{entry.tick_size ?? '-'}</strong></div>
                    </div>
                    {entry.payload ? <pre className="code-block compact">{JSON.stringify(entry.payload, null, 2)}</pre> : null}
                  </div>
                ))}
              </div>
            )}
          </article>
          </section>

          {tradingViewError ? <section className="error-banner dashboard-error">{tradingViewError}</section> : null}
          {tradingViewMessage ? <section className="message-banner dashboard-info-card">{tradingViewMessage}</section> : null}
        </section>
      </main>
    )
  }

  if (view === 'scalper') {
  const { status: liveStatus, error: liveError, connected: liveConnected, registerPanel } = scalperLive
  const scalperFeedLabel = scalperValidating
    ? 'Checking Session'
    : liveConnected
      ? 'Live Connected'
      : liveError
        ? 'Feed Error'
        : 'Connecting'
  const scalperFeedTone = scalperValidating
    ? '#f59e0b'
    : liveConnected
      ? '#22c55e'
      : liveError
        ? '#ef4444'
        : '#64748b'
    const underlyingMeta = scalperPanelMeta?.underlying ?? (scalperSnapshot
      ? {
          instrument: scalperSnapshot.underlying.instrument,
          display_name: scalperSnapshot.underlying.display_name,
          exchange: scalperSnapshot.underlying.exchange,
          instrument_type: scalperSnapshot.underlying.instrument_type,
          interval: scalperSnapshot.underlying.interval,
          last_price: scalperSnapshot.underlying.last_price,
        }
      : null)
    const callMeta = scalperPanelMeta?.call_option ?? (scalperSnapshot
      ? {
          instrument: scalperSnapshot.call_option.instrument,
          display_name: scalperSnapshot.call_option.display_name,
          exchange: scalperSnapshot.call_option.exchange,
          instrument_type: scalperSnapshot.call_option.instrument_type,
          interval: scalperSnapshot.call_option.interval,
          last_price: scalperSnapshot.call_option.last_price,
        }
      : null)
    const putMeta = scalperPanelMeta?.put_option ?? (scalperSnapshot
      ? {
          instrument: scalperSnapshot.put_option.instrument,
          display_name: scalperSnapshot.put_option.display_name,
          exchange: scalperSnapshot.put_option.exchange,
          instrument_type: scalperSnapshot.put_option.instrument_type,
          interval: scalperSnapshot.put_option.interval,
          last_price: scalperSnapshot.put_option.last_price,
        }
      : null)
    const activeOptionPair = scalperOptionPair
    const lotSize = activeOptionPair?.lot_size ?? 1
    const tickSize = activeOptionPair?.tick_size ?? 1
    const callLots = sanitizePositiveInteger(scalperCallLots)
    const putLots = sanitizePositiveInteger(scalperPutLots)
    const callEstimatedValue = (callMeta?.last_price ?? 0) * lotSize * callLots
    const putEstimatedValue = (putMeta?.last_price ?? 0) * lotSize * putLots
    const callTradingDisabled = !session || !!session.is_demo || !activeOptionPair?.call_ref_id || scalperValidating
    const putTradingDisabled = !session || !!session.is_demo || !activeOptionPair?.put_ref_id || scalperValidating

    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('Scalper')}

          <section className="dashboard-header no-code-header">
            <div>
              <button type="button" className="back-link" onClick={() => setView('dashboard')}>
                {'< Back to Dashboard'}
              </button>
              <h1>Scalper</h1>
              <p>
                Live three-panel workspace - underlying on the left, matched call / put charts on the right.
                Charts tick in real time via Nubra market data.
              </p>
            </div>
            <div className="dashboard-header-pills">
              <span className="pill">{session?.environment ?? 'UAT'}</span>
              <span className="pill">{scalperUnderlying}</span>
              <span className="pill pill-dark">{scalperInterval}</span>
              <span className="pill" style={{ color: scalperFeedTone }}>
                {scalperValidating ? 'Checking' : liveConnected ? 'Live' : liveError ? 'Feed Error' : 'Connecting'}
              </span>
            </div>
          </section>

          {session?.is_demo ? (
            <section className="dashboard-info-card">
              <div>
                <strong>Real session required</strong>
                <p>Live charts stream Nubra market data. Open a real UAT or PROD session to activate the scalper workspace.</p>
              </div>
            </section>
          ) : (
            <>
              {scalperSnapshotError && !liveConnected ? <section className="error-banner dashboard-error">{scalperSnapshotError}</section> : null}
              {scalperSnapshotNotice && !liveConnected ? <section className="message-banner">{scalperSnapshotNotice}</section> : null}
              <section className="scalper-terminal">
                <div className="scalper-toolbar">
                  <div className="scalper-toolbar-group">
                    <label className="scalper-field">
                      <span>Underlying</span>
                      <select value={scalperUnderlying} onChange={(event) => setScalperUnderlying(event.target.value)}>
                        {(scalperUnderlyings as readonly string[]).includes(scalperUnderlying)
                          ? scalperUnderlyings.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))
                          : [...scalperUnderlyings, scalperUnderlying].map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))
                        }
                      </select>
                    </label>
                    <label className="scalper-field">
                      <span>Timeframe</span>
                      <select value={scalperInterval} onChange={(event) => setScalperInterval(event.target.value as Interval)}>
                        {intervals.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="scalper-field">
                      <span>CE Strike</span>
                      <div className="scalper-step-input">
                        <button type="button" onClick={() => setScalperCeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, -1))}>-</button>
                        <input
                          value={scalperCeStrikePrice}
                          onChange={(event) => setScalperCeStrikePrice(event.target.value.replace(/[^\d]/g, ''))}
                          placeholder="24300"
                        />
                        <button type="button" onClick={() => setScalperCeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, 1))}>+</button>
                      </div>
                    </label>
                    <label className="scalper-field">
                      <span>PE Strike</span>
                      <div className="scalper-step-input">
                        <button type="button" onClick={() => setScalperPeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, -1))}>-</button>
                        <input
                          value={scalperPeStrikePrice}
                          onChange={(event) => setScalperPeStrikePrice(event.target.value.replace(/[^\d]/g, ''))}
                          placeholder="24300"
                        />
                        <button type="button" onClick={() => setScalperPeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, 1))}>+</button>
                      </div>
                    </label>
                    <label className="scalper-field">
                      <span>Expiry</span>
                      <input
                        value={scalperExpiry}
                        onChange={(event) => setScalperExpiry(event.target.value.toUpperCase())}
                        placeholder="21 APR 26"
                      />
                    </label>
                  </div>

                  <div className="scalper-toolbar-side">
                    <div className="scalper-status-stack">
                      <span className="scalper-status-pill" style={{ color: scalperFeedTone }}>{scalperFeedLabel}</span>
                      <span className="scalper-status-pill">{formatExpiryBadge(activeOptionPair?.expiry)}</span>
                      <span className="scalper-status-pill">Lot {activeOptionPair?.lot_size ?? '--'}</span>
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={scalperValidating}
                      onClick={() => { void validateScalperSessionAndReconnect() }}
                    >
                      {scalperValidating ? 'Checking Session...' : liveConnected ? 'Reconnect Feed' : 'Connect Feed'}
                    </button>
                  </div>
                </div>

                <div className="scalper-terminal-header">
                  <div className="scalper-terminal-title">Call</div>
                  <div className="scalper-terminal-title is-active">Underlying</div>
                  <div className="scalper-terminal-title">Put</div>
                </div>

                <section className="scalper-chart-board">
                  <ScalperLiveChart
                    panel="call_option"
                    accent="green"
                    title="Call Option"
                    displayName={callMeta?.display_name ?? null}
                    lastPrice={callMeta?.last_price ?? null}
                    interval={callMeta?.interval ?? scalperInterval}
                    exchange={callMeta?.exchange ?? 'NSE'}
                    fallbackCandles={scalperPanelMeta?.call_option ? undefined : scalperSnapshot?.call_option.candles}
                    overlays={indicatorOverlaysCall.overlays}
                    signals={indicatorOverlaysCall.signals}
                    height={306}
                    theme={theme}
                    onSeriesReady={registerPanel}
                  />
                  <ScalperLiveChart
                    panel="underlying"
                    accent="blue"
                    title="Underlying"
                    displayName={underlyingMeta?.display_name ?? null}
                    lastPrice={underlyingMeta?.last_price ?? null}
                    interval={underlyingMeta?.interval ?? scalperInterval}
                    exchange={underlyingMeta?.exchange ?? 'NSE'}
                    fallbackCandles={scalperPanelMeta?.underlying ? undefined : scalperSnapshot?.underlying.candles}
                    overlays={indicatorOverlaysUnderlying.overlays}
                    signals={indicatorOverlaysUnderlying.signals}
                    height={306}
                    theme={theme}
                    onSeriesReady={registerPanel}
                  />
                  <ScalperLiveChart
                    panel="put_option"
                    accent="red"
                    title="Put Option"
                    displayName={putMeta?.display_name ?? null}
                    lastPrice={putMeta?.last_price ?? null}
                    interval={putMeta?.interval ?? scalperInterval}
                    exchange={putMeta?.exchange ?? 'NSE'}
                    fallbackCandles={scalperPanelMeta?.put_option ? undefined : scalperSnapshot?.put_option.candles}
                    overlays={indicatorOverlaysPut.overlays}
                    signals={indicatorOverlaysPut.signals}
                    height={306}
                    theme={theme}
                    onSeriesReady={registerPanel}
                  />
                </section>

                <section className="scalper-trade-strip">
                  <article className="scalper-trade-panel">
                    <div className="scalper-trade-panel-head">
                      <span className="summary-label">Call execution</span>
                      <strong>{activeOptionPair ? `${activeOptionPair.ce_strike_price} CE` : 'Resolving...'}</strong>
                    </div>
                    <div className="scalper-trade-inputs">
                      <label className="scalper-field compact">
                        <span>Strike</span>
                        <div className="scalper-step-input">
                          <button type="button" onClick={() => setScalperCeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, -1))}>-</button>
                          <input
                            value={scalperCeStrikePrice}
                            onChange={(event) => setScalperCeStrikePrice(event.target.value.replace(/[^\d]/g, ''))}
                          />
                          <button type="button" onClick={() => setScalperCeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, 1))}>+</button>
                        </div>
                      </label>
                      <label className="scalper-field compact">
                        <span>Lots</span>
                        <div className="scalper-step-input">
                          <button type="button" onClick={() => setScalperCallLots(String(Math.max(1, callLots - 1)))}>-</button>
                          <input value={scalperCallLots} onChange={(event) => setScalperCallLots(event.target.value.replace(/[^\d]/g, ''))} />
                          <button type="button" onClick={() => setScalperCallLots(String(callLots + 1))}>+</button>
                        </div>
                      </label>
                    </div>
                    <div className="scalper-trade-buttons">
                      <button
                        type="button"
                        className="scalper-trade-button buy"
                        disabled={callTradingDisabled || scalperTradeAction !== null}
                        onClick={() => { void submitScalperOrder('CE', 'ORDER_SIDE_BUY') }}
                      >
                        <strong>Buy Call</strong>
                        <span>Req. {formatPrice(callEstimatedValue)}</span>
                      </button>
                      <button
                        type="button"
                        className="scalper-trade-button sell"
                        disabled={callTradingDisabled || scalperTradeAction !== null}
                        onClick={() => { void submitScalperOrder('CE', 'ORDER_SIDE_SELL') }}
                      >
                        <strong>Sell Call</strong>
                        <span>Req. {formatPrice(callEstimatedValue)}</span>
                      </button>
                    </div>
                  </article>

                  <article className="scalper-trade-summary">
                    <span className="summary-label">Execution summary</span>
                    <strong>{session?.environment ?? 'UAT'} scalper</strong>
                    <div className="scalper-trade-summary-grid">
                      <div><span>Lot size</span><strong>{lotSize || '--'}</strong></div>
                      <div><span>Tick</span><strong>{tickSize || '--'}</strong></div>
                      <div><span>Call LTP</span><strong>{formatPrice(callMeta?.last_price)}</strong></div>
                      <div><span>Put LTP</span><strong>{formatPrice(putMeta?.last_price)}</strong></div>
                    </div>
                    {scalperTradeError ? <div className="error-banner">{scalperTradeError}</div> : null}
                    {scalperTradeMessage ? <div className="message-banner">{scalperTradeMessage}</div> : null}
                  </article>

                  <article className="scalper-trade-panel">
                    <div className="scalper-trade-panel-head">
                      <span className="summary-label">Put execution</span>
                      <strong>{activeOptionPair ? `${activeOptionPair.pe_strike_price} PE` : 'Resolving...'}</strong>
                    </div>
                    <div className="scalper-trade-inputs">
                      <label className="scalper-field compact">
                        <span>Strike</span>
                        <div className="scalper-step-input">
                          <button type="button" onClick={() => setScalperPeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, -1))}>-</button>
                          <input
                            value={scalperPeStrikePrice}
                            onChange={(event) => setScalperPeStrikePrice(event.target.value.replace(/[^\d]/g, ''))}
                          />
                          <button type="button" onClick={() => setScalperPeStrikePrice((current) => adjustScalperStrike(current, scalperUnderlying, 1))}>+</button>
                        </div>
                      </label>
                      <label className="scalper-field compact">
                        <span>Lots</span>
                        <div className="scalper-step-input">
                          <button type="button" onClick={() => setScalperPutLots(String(Math.max(1, putLots - 1)))}>-</button>
                          <input value={scalperPutLots} onChange={(event) => setScalperPutLots(event.target.value.replace(/[^\d]/g, ''))} />
                          <button type="button" onClick={() => setScalperPutLots(String(putLots + 1))}>+</button>
                        </div>
                      </label>
                    </div>
                    <div className="scalper-trade-buttons">
                      <button
                        type="button"
                        className="scalper-trade-button buy"
                        disabled={putTradingDisabled || scalperTradeAction !== null}
                        onClick={() => { void submitScalperOrder('PE', 'ORDER_SIDE_BUY') }}
                      >
                        <strong>Buy Put</strong>
                        <span>Req. {formatPrice(putEstimatedValue)}</span>
                      </button>
                      <button
                        type="button"
                        className="scalper-trade-button sell"
                        disabled={putTradingDisabled || scalperTradeAction !== null}
                        onClick={() => { void submitScalperOrder('PE', 'ORDER_SIDE_SELL') }}
                      >
                        <strong>Sell Put</strong>
                        <span>Req. {formatPrice(putEstimatedValue)}</span>
                      </button>
                    </div>
                  </article>
                </section>

                <div className="scalper-terminal-footer">
                  <div className="scalper-terminal-note">
                    {activeOptionPair
                      ? `${activeOptionPair.call_display_name} / ${activeOptionPair.put_display_name}`
                      : scalperSnapshot?.option_pair
                        ? `${scalperSnapshot.option_pair.call_display_name} / ${scalperSnapshot.option_pair.put_display_name}`
                        : 'Resolving option pair...'}
                  </div>
                  <div className="scalper-terminal-note">
                    {liveError
                      ? liveError
                      : liveStatus || 'Live websocket updates are active for the current candle. REST is only used for periodic reconcile.'}
                  </div>
                </div>
              </section>

              <section className="scalper-screener">
                <div className="scalper-tool-switch" role="tablist" aria-label="Scalper tools">
                  <button
                    type="button"
                    className={activeScalperTool === 'delta-neutral' ? 'scalper-tool-button is-active' : 'scalper-tool-button'}
                    onClick={() => setActiveScalperTool('delta-neutral')}
                  >
                    Delta Neutral Pairs
                  </button>
                  <button
                    type="button"
                    className={activeScalperTool === 'expiry-heatmap' ? 'scalper-tool-button is-active' : 'scalper-tool-button'}
                    onClick={() => setActiveScalperTool('expiry-heatmap')}
                  >
                    Expiry Heatmap
                  </button>
                  <button
                    type="button"
                    className={activeScalperTool === 'volume-breakout' ? 'scalper-tool-button is-active' : 'scalper-tool-button'}
                    onClick={() => setActiveScalperTool('volume-breakout')}
                  >
                    Volume Breakout Finder
                  </button>
                  <button
                    type="button"
                    className={activeScalperTool === 'indicator-builder' ? 'scalper-tool-button is-active' : 'scalper-tool-button'}
                    onClick={() => setActiveScalperTool('indicator-builder')}
                  >
                    Indicator Builder
                    {indicatorHook.indicators.filter((i) => i.enabled).length > 0 && (
                      <span className="ind-count-badge" style={{ marginLeft: 6 }}>
                        {indicatorHook.indicators.filter((i) => i.enabled).length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={activeScalperTool === 'automate' ? 'scalper-tool-button is-active' : 'scalper-tool-button'}
                    onClick={() => setActiveScalperTool('automate')}
                    style={automateEnabled ? { color: '#ef4444', fontWeight: 700 } : undefined}
                  >
                    Automate
                    {automateEnabled && (
                      <span className="ind-count-badge" style={{ marginLeft: 6, background: '#ef4444' }}>ON</span>
                    )}
                  </button>
                </div>

                {activeScalperTool === 'delta-neutral' ? (
                  <>
                    <div className="scalper-screener-head">
                      <div>
                        <span className="summary-label">Delta Neutral Pairs</span>
                        <h2>Top 5 CE / PE combinations</h2>
                        <p>
                          Click a ranked pair to load separate call and put strikes into the scalper. Rankings use Nubra CE and PE delta values, with snapshot fallback when live data is unavailable.
                        </p>
                      </div>
                      <div className="scalper-screener-meta">
                        <span className="scalper-status-pill">{deltaNeutralLoading ? 'Loading pairs...' : `${deltaNeutralPairs.length} pairs`}</span>
                        <span className="scalper-status-pill">{formatExpiryBadge(scalperExpiry)}</span>
                      </div>
                    </div>

                    {deltaNeutralMessage ? <div className="message-banner">{deltaNeutralMessage}</div> : null}

                    <div className="scalper-pair-grid">
                      {deltaNeutralPairs.length === 0 ? (
                        <div className="table-empty">No delta-neutral pairs available yet.</div>
                      ) : (
                        deltaNeutralPairs.map((pair) => {
                          const isActive =
                            pair.ce_strike_price === Number(scalperCeStrikePrice) &&
                            pair.pe_strike_price === Number(scalperPeStrikePrice) &&
                            (pair.expiry ?? '') === (normalizedScalperExpiry ?? '')

                          return (
                            <button
                              key={`${pair.rank}-${pair.ce_strike_price}-${pair.pe_strike_price}`}
                              type="button"
                              className={isActive ? 'scalper-pair-card is-active' : 'scalper-pair-card'}
                              onClick={() => {
                                setScalperCeStrikePrice(String(pair.ce_strike_price))
                                setScalperPeStrikePrice(String(pair.pe_strike_price))
                                setScalperExpiry(formatExpiryInputValue(pair.expiry))
                                setScalperReconnectNonce((value) => value + 1)
                              }}
                            >
                              <div className="scalper-pair-rank">#{pair.rank}</div>
                              <div className="scalper-pair-strikes">
                                <strong>{pair.ce_strike_price} CE</strong>
                                <strong>{pair.pe_strike_price} PE</strong>
                              </div>
                              <div className="scalper-pair-score">
                                <span>Neutrality</span>
                                <strong>{pair.neutrality_score.toFixed(1)}</strong>
                              </div>
                              <div className="scalper-pair-metrics">
                                <span>Width {pair.width_points}</span>
                                <span>Spot {formatPrice(pair.spot_price)}</span>
                              </div>
                              <div className="scalper-pair-metrics">
                                <span>CE Delta {pair.call_delta != null ? pair.call_delta.toFixed(2) : '--'}</span>
                                <span>PE Delta {pair.put_delta != null ? pair.put_delta.toFixed(2) : '--'}</span>
                              </div>
                              <div className="scalper-pair-metrics">
                                <span>Net Delta {pair.net_delta != null ? pair.net_delta.toFixed(2) : '--'}</span>
                                <span>{(pair.expiry ?? '').trim() || 'Nearest expiry'}</span>
                              </div>
                              <div className="scalper-pair-bar">
                                <div
                                  className="scalper-pair-bar-fill"
                                  style={{ width: `${Math.max(12, Math.min(100, pair.neutrality_score))}%` }}
                                />
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </>
                ) : activeScalperTool === 'expiry-heatmap' ? (
                  <>
                    <div className="scalper-screener-head">
                      <div>
                        <span className="summary-label">Expiry Heatmap</span>
                        <h2>Nearest-expiry strike activity around ATM</h2>
                        <p>
                          Use the heatmap to spot the most active CE / PE strikes. Click a call cell, put cell, or strike row to load those levels into the scalper.
                        </p>
                      </div>
                      <div className="scalper-screener-meta">
                        <span className="scalper-status-pill">{expiryHeatmapLoading ? 'Loading heatmap...' : `${expiryHeatmapRows.length} strikes`}</span>
                        <span className="scalper-status-pill">{formatExpiryBadge(scalperExpiry)}</span>
                      </div>
                    </div>

                    {expiryHeatmapMessage ? <div className="message-banner">{expiryHeatmapMessage}</div> : null}

                    <div className="scalper-heatmap-shell">
                      <div className="scalper-heatmap-header">
                        <span>Call</span>
                        <span>Strike</span>
                        <span>Put</span>
                      </div>

                      {expiryHeatmapRows.length === 0 ? (
                        <div className="table-empty">No heatmap rows available yet.</div>
                      ) : (
                        <div className="scalper-heatmap-grid">
                          {expiryHeatmapRows.map((row) => {
                            const isCenter = row.distance_from_spot === 0
                            const callActive =
                              row.strike_price === Number(scalperCeStrikePrice) &&
                              (row.expiry ?? '') === (normalizedScalperExpiry ?? row.expiry ?? '')
                            const putActive =
                              row.strike_price === Number(scalperPeStrikePrice) &&
                              (row.expiry ?? '') === (normalizedScalperExpiry ?? row.expiry ?? '')

                            return (
                              <div key={`${row.expiry ?? 'nearest'}-${row.strike_price}`} className="scalper-heatmap-row">
                                <button
                                  type="button"
                                  className={callActive ? 'scalper-heatmap-cell call is-active' : 'scalper-heatmap-cell call'}
                                  style={{ ['--heat-alpha' as never]: `${Math.max(0.1, row.call_heat / 100)}` }}
                                  onClick={() => {
                                    if (!row.call_display_name) return
                                    setScalperCeStrikePrice(String(row.strike_price))
                                    setScalperExpiry(formatExpiryInputValue(row.expiry))
                                    setScalperReconnectNonce((value) => value + 1)
                                  }}
                                  disabled={!row.call_display_name}
                                >
                                  <strong>{formatPrice(row.call_last_price)}</strong>
                                  <span>{formatCompactVolume(row.call_volume)}</span>
                                  <small>{row.call_change_pct == null ? '--' : `${row.call_change_pct >= 0 ? '+' : ''}${row.call_change_pct.toFixed(2)}%`}</small>
                                </button>

                                <button
                                  type="button"
                                  className={isCenter ? 'scalper-heatmap-strike is-center' : 'scalper-heatmap-strike'}
                                  onClick={() => {
                                    setScalperCeStrikePrice(String(row.strike_price))
                                    setScalperPeStrikePrice(String(row.strike_price))
                                    setScalperExpiry(formatExpiryInputValue(row.expiry))
                                    setScalperReconnectNonce((value) => value + 1)
                                  }}
                                >
                                  <strong>{row.strike_price}</strong>
                                  <span>{row.distance_from_spot === 0 ? 'ATM' : `${row.distance_from_spot > 0 ? '+' : ''}${row.distance_from_spot}`}</span>
                                </button>

                                <button
                                  type="button"
                                  className={putActive ? 'scalper-heatmap-cell put is-active' : 'scalper-heatmap-cell put'}
                                  style={{ ['--heat-alpha' as never]: `${Math.max(0.1, row.put_heat / 100)}` }}
                                  onClick={() => {
                                    if (!row.put_display_name) return
                                    setScalperPeStrikePrice(String(row.strike_price))
                                    setScalperExpiry(formatExpiryInputValue(row.expiry))
                                    setScalperReconnectNonce((value) => value + 1)
                                  }}
                                  disabled={!row.put_display_name}
                                >
                                  <strong>{formatPrice(row.put_last_price)}</strong>
                                  <span>{formatCompactVolume(row.put_volume)}</span>
                                  <small>{row.put_change_pct == null ? '--' : `${row.put_change_pct >= 0 ? '+' : ''}${row.put_change_pct.toFixed(2)}%`}</small>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : activeScalperTool === 'volume-breakout' ? (
                  <>
                    <div className="scalper-screener-head">
                      <div>
                        <span className="summary-label">Volume Breakout Finder</span>
                        <h2>Top option-tradable breakout underlyings</h2>
                          <p>
                            Compare the current {scalperInterval} candle volume with the average of all {scalperInterval} candles from the previous {scalperVolumeBreakoutLookbackDays} trading days. After market hours and on weekends, the finder falls back to the latest historical session snapshot.
                          </p>
                      </div>
                      <div className="scalper-screener-meta">
                        <span className="scalper-status-pill">{scalperVolumeBreakoutLoading ? 'Scanning all stocks…' : `${scalperVolumeBreakoutRows.length} candidates`}</span>
                        <span className="scalper-status-pill">{scalperVolumeBreakoutLookbackDays}D lookback</span>
                      </div>
                    </div>

                    <div className="scalper-breakout-controls">
                      {[3, 5, 10, 20].map((days) => (
                        <button
                          key={days}
                          type="button"
                          className={scalperVolumeBreakoutLookbackDays === days ? 'scalper-lookback-button is-active' : 'scalper-lookback-button'}
                          onClick={() => setScalperVolumeBreakoutLookbackDays(days as 3 | 5 | 10 | 20)}
                        >
                          {days}D
                        </button>
                      ))}
                    </div>

                    {scalperVolumeBreakoutMessage ? <div className="message-banner">{scalperVolumeBreakoutMessage}</div> : null}

                    <div className="scalper-breakout-grid-wrap">
                    <div className="scalper-breakout-grid">
                      {scalperVolumeBreakoutRows.length === 0 ? (
                        <div className="table-empty">No volume breakout candidates are available for this trading-day baseline yet.</div>
                      ) : (
                        scalperVolumeBreakoutRows.map((row) => {
                          const isActive = row.underlying === scalperUnderlying
                          return (
                            <button
                              key={`${row.rank}-${row.underlying}`}
                              type="button"
                              className={isActive ? 'scalper-breakout-card is-active' : 'scalper-breakout-card'}
                              onClick={() => {
                                // Store expiry before changing underlying so the
                                // scalperUnderlying effect picks it up instead of resetting to ''.
                                const desiredExpiry = formatExpiryInputValue(row.nearest_expiry)
                                if (desiredExpiry) {
                                  pendingScalperExpiry.current = desiredExpiry
                                }
                                setScalperUnderlying(row.underlying)
                                if (row.atm_strike != null) {
                                  const strike = String(row.atm_strike)
                                  setScalperCeStrikePrice(strike)
                                  setScalperPeStrikePrice(strike)
                                }
                                setActiveScalperTool('delta-neutral')
                                setScalperReconnectNonce((value) => value + 1)
                              }}
                            >
                              <div className="scalper-breakout-rank">#{row.rank}</div>
                              <div className="scalper-breakout-header">
                                <div>
                                  <strong>{row.underlying}</strong>
                                  <span>{row.display_name}</span>
                                </div>
                                <span className="scalper-breakout-status">{row.status_label}</span>
                              </div>
                              <div className="scalper-breakout-price-row">
                                <strong>{formatPrice(row.last_price)}</strong>
                                <span>{row.price_change_pct == null ? '--' : `${row.price_change_pct >= 0 ? '+' : ''}${row.price_change_pct.toFixed(2)}%`}</span>
                              </div>
                              <div className="scalper-breakout-metrics">
                                <span>Vol ratio</span>
                                <strong>{row.volume_ratio.toFixed(2)}x</strong>
                              </div>
                              <div className="scalper-breakout-metrics">
                                <span>Current</span>
                                <strong>{formatCompactVolume(row.current_volume)}</strong>
                              </div>
                              <div className="scalper-breakout-metrics">
                                  <span>Avg candle ({scalperVolumeBreakoutLookbackDays}D)</span>
                                <strong>{formatCompactVolume(row.average_volume)}</strong>
                              </div>
                              <div className="scalper-breakout-metrics">
                                <span>Nearest expiry</span>
                                <strong>{formatExpiryBadge(row.nearest_expiry)}</strong>
                              </div>
                              <div className="scalper-breakout-metrics">
                                <span>ATM strike</span>
                                <strong>{row.atm_strike == null ? '--' : row.atm_strike}</strong>
                              </div>
                              <div className="scalper-breakout-bar">
                                <div
                                  className="scalper-breakout-bar-fill"
                                  style={{ width: `${Math.max(14, Math.min(100, row.breakout_strength))}%` }}
                                />
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                    </div>
                  </>
                ) : activeScalperTool === 'indicator-builder' ? (
                  <IndicatorBuilder
                    indicators={indicatorHook.indicators}
                    presets={indicatorHook.presets}
                    onAddFromPreset={indicatorHook.addFromPreset}
                    onToggle={indicatorHook.toggle}
                    onRemove={indicatorHook.remove}
                    onRename={indicatorHook.rename}
                    onUpdate={indicatorHook.update}
                    theme={theme}
                  />
                ) : activeScalperTool === 'automate' ? (
                  <AutomatePanel
                    enabled={automateEnabled}
                    onToggle={setAutomateEnabled}
                    config={automateConfig}
                    onConfigChange={(next) => setAutomateConfig((prev) => ({ ...prev, ...next }))}
                    hasSignals={automationHasSignals}
                    position={automation.position}
                    tradeCount={automation.tradeCount}
                    log={automation.log}
                    onClearLog={automation.clearLog}
                    onResetPosition={automation.resetPosition}
                    disabled={!session || !!session.is_demo}
                  />
                ) : null}
              </section>
            </>
          )}
        </section>
      </main>
    )
  }

  if (view === 'dashboard') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('Dashboard')}

          {isSessionChecking ? <p style={{ padding: '0 4px', fontSize: '0.82rem', color: 'var(--text-muted, #94a3b8)' }}>Checking session status...</p> : null}

          <section className="card-grid">
            {dashboardCards.map((card) => (
              <article
                key={card.title}
                className={card.key ? 'dashboard-module-card is-clickable' : 'dashboard-module-card'}
                onClick={card.key ? () => handleDashboardCardOpen(card.key) : undefined}
                role={card.key ? 'button' : undefined}
                tabIndex={card.key ? 0 : undefined}
                onKeyDown={
                  card.key
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          handleDashboardCardOpen(card.key)
                        }
                      }
                    : undefined
                }
              >
                <div className={`module-badge ${card.badgeClass}`}>{card.icon}</div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
                <span className="module-footer">{card.footer}{card.key ? ' ->' : ''}</span>
              </article>
            ))}
          </section>

          <section className="dashboard-info-card">
            <div>
              <strong>Getting Started</strong>
              <p>
                This is the first dashboard shell. Each card is a placeholder entry point for the
                Nubra-native modules we will build next.
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => window.open('https://docs.nubra.io', '_blank', 'noopener,noreferrer')}
            >
              View Documentation
            </button>
          </section>
        </section>
      </main>
    )
  }

    return (
      <main className="login-shell">
        <section className="login-stage">
          <div className="login-theme-switch">
            {renderThemeToggle('login-theme-toggle')}
          </div>
          <div className="login-grid" aria-hidden="true" />

          {!loginInitialized ? (
            <section className="launch-screen">
              <div className="launch-brand">
                <span>NubraOSS</span>
              </div>

            <p className="launch-caption">
              The professional operating system for algorithmic execution. Engineered for
              precision, built for scale.
            </p>

            <div className="launch-actions">
              <button type="button" className="launch-button" onClick={() => setLoginInitialized(true)}>
                Initialize System
                <span className="launch-button-arrow">&gt;</span>
              </button>

              <div className="launch-features" aria-label="Product highlights">
                <span>Secure</span>
                <span>Low Latency</span>
                <span>No-Code</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="auth-stage">
            <section className="login-frame">
              <div className="login-frame-inner">

                {/* Header */}
                <div className="auth-frame-head">
                  <button type="button" className="auth-back-link" onClick={() => setLoginInitialized(false)}>
                    {'<- Back'}
                  </button>
                  <div className="brand-block auth-brand-block">
                    <img src={nubraLogo} alt="Nubra" className="brand-logo" />
                    <div>
                      <div className="brand-name">NubraOSS</div>
                      <div className="brand-caption">Trading workspace</div>
                    </div>
                  </div>
                  <div className="env-switch" role="tablist" aria-label="Environment">
                    <button
                      type="button"
                      className={environment === 'PROD' ? 'env-button active' : 'env-button'}
                      onClick={() => setEnvironment('PROD')}
                    >
                      PROD
                    </button>
                    <button
                      type="button"
                      className={environment === 'UAT' ? 'env-button active' : 'env-button'}
                      onClick={() => setEnvironment('UAT')}
                    >
                      UAT
                    </button>
                  </div>
                </div>

                {/* Step progress */}
                <div className="auth-steps-progress">
                  {(['start', 'otp', 'mpin'] as const).map((s, i) => {
                    const labels = ['Phone', 'OTP', 'MPIN']
                    const isDone = (s === 'start' && phoneComplete) || (s === 'otp' && otpComplete) || (s === 'mpin' && mpinComplete)
                    const isActive = (s === 'start' && !phoneComplete) || (s === 'otp' && phoneComplete && !otpComplete) || (s === 'mpin' && otpComplete && !mpinComplete)
                    return (
                      <div key={s} className={`auth-step-node${isDone ? ' done' : isActive ? ' active' : ''}`}>
                        <div className="auth-step-circle">
                          {isDone ? 'Done' : <span>{i + 1}</span>}
                        </div>
                        <span className="auth-step-label">{labels[i]}</span>
                        {i < 2 && <div className={`auth-step-line${isDone ? ' done' : ''}`} />}
                      </div>
                    )
                  })}
                </div>

                {/* Step 1 - Phone */}
                {!phoneComplete && (
                  <div className="auth-wizard-step">
                    <div className="auth-wizard-heading">
                      <h1>Enter your phone number</h1>
                      <p>We'll send an OTP to your registered Nubra number.</p>
                    </div>
                    <form className="auth-wizard-form" onSubmit={handleStart}>
                      <div className="auth-input-group">
                        <label className="auth-label">Phone number</label>
                        <input
                          className="auth-input"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
                          placeholder="10-digit mobile number"
                          maxLength={15}
                          inputMode="numeric"
                          autoFocus
                          required
                        />
                      </div>
                      <button
                        className="auth-primary-btn"
                        disabled={activeAction !== null || phone.length < 10}
                        type="submit"
                      >
                        {activeAction === 'phone' ? (
                          <span className="auth-btn-loading"><span className="auth-spinner" />Sending OTP...</span>
                        ) : (
                          <>Send OTP <span className="auth-btn-arrow">{'->'}</span></>
                        )}
                      </button>
                    </form>
                  </div>
                )}

                {/* Step 2 - OTP */}
                {phoneComplete && !otpComplete && (
                  <div className="auth-wizard-step">
                    <div className="auth-wizard-heading">
                      <h1>Verify OTP</h1>
                      <p>OTP sent to <strong>{maskedPhone || 'your number'}</strong>. Enter it below.</p>
                    </div>
                    <form className="auth-wizard-form" onSubmit={handleOtp}>
                      <div className="auth-input-group">
                        <label className="auth-label">One-time password</label>
                        <input
                          className="auth-input auth-input-otp"
                          value={otp}
                          onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                          placeholder="Enter OTP"
                          maxLength={8}
                          inputMode="numeric"
                          autoFocus
                          required
                        />
                      </div>
                      <button
                        className="auth-primary-btn"
                        disabled={activeAction !== null || otp.length < 4}
                        type="submit"
                      >
                        {activeAction === 'otp' ? (
                          <span className="auth-btn-loading"><span className="auth-spinner" />Verifying...</span>
                        ) : (
                          <>Verify OTP <span className="auth-btn-arrow">{'->'}</span></>
                        )}
                      </button>
                    </form>
                    <button type="button" className="auth-ghost-btn" onClick={() => { setFlowId(''); setStep('start'); setOtp('') }}>
                      {'<- Change number'}
                    </button>
                  </div>
                )}

                {/* Step 3 - MPIN */}
                {otpComplete && !mpinComplete && (
                  <div className="auth-wizard-step">
                    <div className="auth-wizard-heading">
                      <h1>Confirm MPIN</h1>
                      <p>OTP verified. Enter your MPIN to enter the workspace.</p>
                    </div>
                    <form className="auth-wizard-form" onSubmit={handleMpin}>
                      <div className="auth-input-group">
                        <label className="auth-label">MPIN</label>
                        <input
                          className="auth-input auth-input-otp"
                          value={mpin}
                          onChange={(event) => setMpin(event.target.value.replace(/\D/g, ''))}
                          placeholder="Enter MPIN"
                          maxLength={6}
                          inputMode="numeric"
                          type="password"
                          autoFocus
                          required
                        />
                      </div>
                      <button
                        className="auth-primary-btn"
                        disabled={activeAction !== null || mpin.length < 4}
                        type="submit"
                      >
                        {activeAction === 'mpin' ? (
                          <span className="auth-btn-loading"><span className="auth-spinner" />Signing in...</span>
                        ) : (
                          <>Enter workspace <span className="auth-btn-arrow">{'->'}</span></>
                        )}
                      </button>
                    </form>
                  </div>
                )}

                {/* Feedback */}
                {(error || (message && step !== 'start')) && (
                  <div className="auth-feedback">
                    {error && <div className="error-banner">{error}</div>}
                    {!error && message && step !== 'start' && <div className="message-banner">{message}</div>}
                  </div>
                )}

                {/* Demo */}
                <div className="auth-demo-row">
                  <span>No credentials?</span>
                  <button type="button" className="auth-ghost-btn" onClick={handleDemoLogin}>
                    {'Try Demo mode ->'}
                  </button>
                </div>

              </div>
            </section>
          </section>
        )}
      </section>
    </main>
  )
}




