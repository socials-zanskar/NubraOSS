import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import nubraLogo from './assets/nubra.png'
import ScalperLiveChart from './components/ScalperLiveChart'
import StrategyBuilder from './components/StrategyBuilder'
import { useScalperLive } from './hooks/useScalperLive'

type Environment = 'PROD' | 'UAT'
type Step = 'start' | 'otp' | 'mpin' | 'success'
type View = 'login' | 'dashboard' | 'no-code' | 'volume-breakout' | 'tradingview-webhook' | 'scalper'
type TradingViewMode = 'strategy' | 'line'
type TradingViewAction = 'BUY' | 'SELL'
type Interval = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1h'
type OrderDeliveryType = 'ORDER_DELIVERY_TYPE_CNC' | 'ORDER_DELIVERY_TYPE_IDAY'

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
  strike_price: number
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

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)}Cr`
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(2)}L`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
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
  const [activeAction, setActiveAction] = useState<'phone' | 'otp' | 'mpin' | null>(null)
  const [session, setSession] = useState<SuccessResponse | null>(() => loadStoredSession())
  const [isSessionChecking, setIsSessionChecking] = useState<boolean>(() => Boolean(loadStoredSession()))
  const [publicIp, setPublicIp] = useState<string>('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

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
  const [scalperUnderlying, setScalperUnderlying] = useState<(typeof scalperUnderlyings)[number]>('NIFTY')
  const [scalperInterval, setScalperInterval] = useState<Interval>('1m')
  const [scalperStrikePrice, setScalperStrikePrice] = useState('24300')
  const [scalperExpiry, setScalperExpiry] = useState('')
  const [scalperReconnectNonce, setScalperReconnectNonce] = useState(0)
  const [scalperValidating, setScalperValidating] = useState(false)
  const derivedDeviceId = session?.device_id ?? (phone ? `Nubra-OSS-${phone}` : 'Nubra-OSS-<phone>')

  const [theme, setTheme] = useState<'dark'|'light'>('dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function toggleTheme() { setTheme((t) => t === 'dark' ? 'light' : 'dark') }

  function renderDashboardNav(pageLabel: string) {
    const initials = (session?.user_name ?? 'N').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
    return (
      <header className="dash-top">
        <div className="dash-top-l">
          <div className="logo">
            <img className="mark-img" src={nubraLogo} alt="" aria-hidden width={32} height={32} />
            <span className="wm" style={{ fontSize: 15 }}>NubraOSS</span>
          </div>
          <span className="topbar-sep" />
          <nav className="topbar-nav" aria-label="Primary navigation">
            {['Dashboard','Scanner','Webhook','Scalper'].map((tab) => (
              <button
                key={tab}
                type="button"
                className={tab === pageLabel ? 'nav-item active' : 'nav-item'}
                onClick={() => {
                  if (tab === 'Dashboard') setView('dashboard')
                  else if (tab === 'Scanner') setView('volume-breakout')
                  else if (tab === 'Webhook') setView('tradingview-webhook')
                  else if (tab === 'Scalper') setView('scalper')
                }}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        <div className="dash-top-c">
          <label className="search-bar" aria-label="Search">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx={11} cy={11} r={6}/><path d="M20 20l-4-4"/></svg>
            <input placeholder="Search modules, symbols..." />
            <kbd>⌘K</kbd>
          </label>
        </div>

        <div className="dash-top-r">
          <div className="session-pill">
            <span className="live-dot" />
            {session?.environment === 'UAT' ? 'UAT' : 'MARKET OPEN'} / NSE
          </div>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            <span className={`tt-track ${theme}`}>
              <span className="tt-thumb">
                {theme === 'dark'
                  ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/></svg>
                  : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={12} r={4}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>
                }
              </span>
            </span>
          </button>
          <div className="profile-menu">
            <button
              type="button"
              className="avatar profile-trigger"
              onClick={() => setProfileMenuOpen((open) => !open)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
            >
              {initials}
            </button>
            {profileMenuOpen ? (
              <div className="profile-popover-v2" role="menu" aria-label="Profile menu">
                <div>
                  <strong style={{ fontSize: 14, fontWeight: 500 }}>{session?.user_name ?? 'Nubra User'}</strong>
                  <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 2 }}>{session?.account_id ?? 'NUBRA'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="pill-v2">{session?.broker?.toLowerCase() ?? 'nubra'}</span>
                  <span className="pill-v2 pill-accent">{session?.environment === 'UAT' ? 'UAT' : 'PROD'}</span>
                </div>
                {publicIp ? <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>IP: {publicIp}</div> : null}
                <button
                  type="button"
                  className="ghost-inline"
                  style={{ width: '100%', textAlign: 'center' }}
                  onClick={() => { setProfileMenuOpen(false); resetSession() }}
                >
                  Sign Out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
    )
  }

  const scalperLive = useScalperLive({
    enabled:
      view === 'scalper' &&
      !!session &&
      !session.is_demo &&
      !scalperValidating &&
      Number.isFinite(Number(scalperStrikePrice)) &&
      Number(scalperStrikePrice) > 0,
    session_token: session?.access_token ?? '',
    device_id: derivedDeviceId,
    environment: session?.environment ?? 'PROD',
    underlying: scalperUnderlying,
    exchange: 'NSE',
    interval: scalperInterval,
    strike_price: Number(scalperStrikePrice) || 1,
    expiry: scalperExpiry.trim() || null,
    lookback_days: 5,
    reconnect_nonce: scalperReconnectNonce,
  })

  function resetSession(reason?: string) {
    setSession(null)
    setView('login')
    setStep('start')
    setFlowId('')
    setOtp('')
    setMpin('')
    setMaskedPhone('')
    setVolumeBreakoutStatus(null)
    setPublicIp('')
    setProfileMenuOpen(false)
    setIsSessionChecking(false)
    setVolumeBreakoutError('')
    setTradingViewStatus(null)
    setTradingViewError('')
    setTradingViewSecret('')
    setTradingViewMessage('Configure the webhook once, then paste the generated JSON into TradingView alerts.')
    setError(reason ?? '')
    setMessage(reason ?? 'Enter your phone number, verify the OTP, then confirm MPIN.')
    fetch(`${API_BASE_URL}/api/strategy/live/stop`, { method: 'POST' }).catch(() => undefined)
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
      resetSession(err instanceof Error ? err.message : 'Unable to validate your session.')
    } finally {
      setScalperValidating(false)
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
        resetSession(err instanceof Error ? err.message : 'Unable to validate your session.')
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
    if (view !== 'scalper' || !session || session.is_demo) return
    if (!scalperLive.error) return

    const normalizedError = scalperLive.error.toLowerCase()
    if (!normalizedError.includes('expired') && !normalizedError.includes('log in again')) return

    resetSession('Your Nubra session expired. Please log in again to restore the live scalper feed.')
  }, [scalperLive.error, session, view])

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
    setScalperStrikePrice(scalperUnderlying === 'BANKNIFTY' ? '56500' : '24300')
    setScalperExpiry('')
  }, [scalperUnderlying])

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

      const data = (await response.json()) as StartResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to start login flow.'))
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

      const data = (await response.json()) as OtpResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to verify OTP.'))
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

      const data = (await response.json()) as SuccessResponse | ApiErrorPayload
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to verify MPIN.'))
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
    setVolumeBreakoutMessage(
      'DB bootstrap loads first, then the backend websocket overlays live bucket updates while this page stays open.',
    )
  }

  function handleDashboardCardOpen(nextView: Extract<View, 'no-code' | 'volume-breakout' | 'tradingview-webhook' | 'scalper'>) {
    setView(nextView)
  }

  async function handleTunnelAction(action: 'start' | 'stop' | 'refresh') {
    if (!session || session.is_demo) return
    setTunnelAction(action)
    try {
      const endpoint =
        action === 'start' ? '/api/system/tunnel/start' :
        action === 'stop'  ? '/api/system/tunnel/stop'  : '/api/system/tunnel/status'
      const method = action === 'refresh' ? 'GET' : 'POST'
      const response = await fetch(`${API_BASE_URL}${endpoint}`, { method })
      const data = (await response.json()) as TunnelStatusResponse | ApiErrorPayload
      if (!response.ok) throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to manage Cloudflare tunnel.'))
      setTunnelStatus(data as TunnelStatusResponse)
    } catch (err) {
      setTunnelStatus((current) => ({
        running: current?.running ?? false, public_url: current?.public_url ?? null,
        target_url: current?.target_url ?? 'http://127.0.0.1:8000',
        last_error: err instanceof Error ? err.message : 'Unable to manage Cloudflare tunnel.', logs: current?.logs ?? [],
      }))
    } finally { setTunnelAction(null) }
  }

  async function handleTradingViewConfigure() {
    if (!session || session.is_demo) return
    setTradingViewError(''); setTradingViewActionState('configure')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/configure`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: session.access_token, device_id: derivedDeviceId, environment: session.environment, user_name: session.user_name, account_id: session.account_id, secret: tradingViewSecret.trim() || undefined, order_delivery_type: tradingViewProduct }),
      })
      const data = (await response.json()) as TradingViewWebhookConfigureResponse | ApiErrorPayload
      if (!response.ok) throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to configure TradingView webhook.'))
      const result = data as TradingViewWebhookConfigureResponse
      setTradingViewStatus(result.config); setTradingViewSecret(result.config.secret ?? '')
      setTradingViewProduct(result.config.order_delivery_type ?? tradingViewProduct); setTradingViewMessage(result.message)
    } catch (err) { setTradingViewError(err instanceof Error ? err.message : 'Unable to configure TradingView webhook.')
    } finally { setTradingViewActionState(null) }
  }

  async function handleTradingViewReset() {
    setTradingViewError(''); setTradingViewActionState('reset')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/reset`, { method: 'POST' })
      const data = (await response.json()) as TradingViewWebhookResetResponse | ApiErrorPayload
      if (!response.ok) throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to reset TradingView webhook.'))
      const result = data as TradingViewWebhookResetResponse
      setTradingViewStatus({ configured: false, environment: session?.environment ?? null, broker: session?.broker ?? null, user_name: session?.user_name ?? null, account_id: session?.account_id ?? null, configured_at_utc: null, order_delivery_type: tradingViewProduct, secret: null, has_secret: false, webhook_path: '/api/webhooks/tradingview', webhook_url: tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : null, strategy_template: {}, line_alert_template: {}, execution_enabled: true, last_error: null, logs: [], history: [], summary: { total_events: 0, live_events: 0, test_events: 0, blocked_events: 0, error_events: 0, accepted_events: 0, today_pnl: 0, today_orders: 0 }, order_history: [], positions: [], pnl_summary: { realized_pnl: 0, unrealized_pnl: 0, total_pnl: 0, open_positions: 0, closed_groups: 0 } })
      setTradingViewSecret(''); setTradingViewMessage(result.message)
    } catch (err) { setTradingViewError(err instanceof Error ? err.message : 'Unable to reset TradingView webhook.')
    } finally { setTradingViewActionState(null) }
  }

  async function handleTradingViewKillSwitch(enabled: boolean) {
    setTradingViewError(''); setTradingViewActionState(enabled ? 'configure' : 'reset')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/execution-mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ execution_enabled: enabled }) })
      const data = (await response.json()) as TradingViewWebhookExecutionModeResponse | ApiErrorPayload
      if (!response.ok) throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to update webhook execution mode.'))
      setTradingViewStatus((current) => (current ? { ...current, execution_enabled: enabled } : current))
      setTradingViewMessage(enabled ? 'Webhook execution enabled.' : 'Kill switch enabled. Incoming webhook orders will be blocked.')
    } catch (err) { setTradingViewError(err instanceof Error ? err.message : 'Unable to update webhook execution mode.')
    } finally { setTradingViewActionState(null) }
  }

  async function copyToClipboard(value: string, kind: 'copy-url' | 'copy-strategy' | 'copy-line') {
    setTradingViewActionState(kind)
    try {
      await navigator.clipboard.writeText(value)
      setTradingViewMessage(kind === 'copy-url' ? 'Webhook URL copied.' : kind === 'copy-strategy' ? 'Strategy JSON copied.' : 'Line alert JSON copied.')
    } catch { setTradingViewError('Unable to copy to clipboard.')
    } finally { setTradingViewActionState(null) }
  }

  async function handleTradingViewTest() {
    if (!session || session.is_demo) return
    setTradingViewError(''); setTradingViewActionState('test')
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/tradingview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-source': 'test' }, body: JSON.stringify(tradingViewLinePayload) })
      const data = (await response.json()) as Record<string, unknown> | ApiErrorPayload
      if (!response.ok) throw new Error(extractErrorMessage(data as ApiErrorPayload, 'Unable to send test webhook payload.'))
      setTradingViewMessage('Test payload sent. Check webhook activity below for capture and order result.')
      const statusResponse = await fetch(`${API_BASE_URL}/api/webhooks/tradingview/status`)
      const statusData = (await statusResponse.json()) as TradingViewWebhookStatusResponse | ApiErrorPayload
      if (statusResponse.ok) setTradingViewStatus(statusData as TradingViewWebhookStatusResponse)
    } catch (err) { setTradingViewError(err instanceof Error ? err.message : 'Unable to send test webhook payload.')
    } finally { setTradingViewActionState(null) }
  }

  function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  // ── Computed values ─────────────────────────────────────────────────────────
  const resolvedTradingViewSecret = tradingViewStatus?.secret ?? tradingViewSecret
  const resolvedTradingViewProduct = tradingViewProduct
  const tradingViewStrategyPayload = { secret: resolvedTradingViewSecret || '<your-webhook-secret>', strategy: tradingViewStrategyName || 'Nubra Strategy Alert', instrument: tradingViewSymbol || 'RELIANCE', exchange: tradingViewExchange || 'NSE', order_side: '{{strategy.order.action}}', order_delivery_type: resolvedTradingViewProduct, price_type: 'MARKET', order_qty: '{{strategy.order.contracts}}', position_size: '{{strategy.position_size}}', tag: tradingViewTag || undefined }
  const tradingViewLinePayload = { secret: resolvedTradingViewSecret || '<your-webhook-secret>', strategy: tradingViewStrategyName || 'Nubra Line Alert', instrument: tradingViewSymbol || 'RELIANCE', exchange: tradingViewExchange || 'NSE', order_side: tradingViewOrderAction, order_delivery_type: resolvedTradingViewProduct, price_type: 'MARKET', order_qty: Number(tradingViewQuantity || '1'), tag: tradingViewTag || undefined }
  const tradingViewStrategyJson = JSON.stringify(tradingViewStrategyPayload, null, 2)
  const tradingViewLineJson = JSON.stringify(tradingViewLinePayload, null, 2)
  const webhookUrl = tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : ''
  const filteredHistory = (tradingViewStatus?.history ?? []).filter((e) => historySourceFilter === 'all' ? true : e.source === historySourceFilter)
  const filteredOrderHistory = (tradingViewStatus?.order_history ?? []).filter((e) => historySourceFilter === 'all' ? true : e.source === historySourceFilter)
  const filteredPositions = (tradingViewStatus?.positions ?? []).filter((p) => {
    if (historySourceFilter === 'all') return true
    return Boolean(filteredOrderHistory.find((e) => (e.strategy ?? null) === (p.strategy ?? null) && (e.tag ?? null) === (p.tag ?? null) && e.instrument === p.instrument && e.exchange === p.exchange))
  })
  const webhookConfigured = Boolean(tradingViewStatus?.configured)
  const tunnelReady = Boolean(tunnelStatus?.public_url)
  const hasTestHistory = (tradingViewStatus?.history ?? []).some((e) => e.source === 'test')
  const executionEnabled = tradingViewStatus?.execution_enabled !== false
  const nextWebhookAction = !webhookConfigured ? 'Step 1: save your webhook secret and default product.' : !tunnelReady ? 'Step 2: generate the public webhook URL.' : !hasTestHistory ? 'Step 4: send a test payload before going live.' : !executionEnabled ? 'Kill switch is on. Re-enable execution before using live TradingView alerts.' : 'Setup complete. Copy the live URL and payload into TradingView.'

  // ── Scalper local vars ────────────────────────────────────────────────────
  const { status: liveStatus, error: liveError, connected: liveConnected, optionPair, panelMeta, registerPanel } = scalperLive
  const scalperFeedLabel = scalperValidating ? 'Checking Session' : liveConnected ? 'Live Connected' : liveError ? 'Feed Error' : 'Connecting'
  const scalperFeedTone = scalperValidating ? '#f59e0b' : liveConnected ? '#22c55e' : liveError ? '#ef4444' : '#64748b'
  const underlyingMeta = panelMeta?.underlying ?? null
  const callMeta = panelMeta?.call_option ?? null
  const putMeta = panelMeta?.put_option ?? null

  // ── OTP/MPIN cell state ──────────────────────────────────────────────────
  const otpCells = useRef<(HTMLInputElement | null)[]>([])
  const mpinCells = useRef<(HTMLInputElement | null)[]>([])
  const [otpDigits, setOtpDigits] = useState(['','','','','',''])
  const [mpinDigits, setMpinDigits] = useState(['','','',''])

  function handleOtpCell(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...otpDigits]; next[index] = value; setOtpDigits(next); setOtp(next.join(''))
    if (value && index < 5) otpCells.current[index + 1]?.focus()
  }
  function handleMpinCell(index: number, value: string) {
    if (!/^\d?$/.test(value)) return
    const next = [...mpinDigits]; next[index] = value; setMpinDigits(next); setMpin(next.join(''))
    if (value && index < 3) mpinCells.current[index + 1]?.focus()
  }

  const phoneComplete = flowId.length > 0
  const otpComplete = step === 'mpin' || step === 'success'
  const mpinComplete = step === 'success'
  const currentStep = step === 'start' ? 0 : step === 'otp' ? 1 : 2

  // ── Routing ──────────────────────────────────────────────────────────────
  if (view === 'no-code') {
    return (
      <StrategyBuilder
        apiBaseUrl={API_BASE_URL}
        sessionToken={session?.access_token ?? ''}
        deviceId={derivedDeviceId}
        environment={session?.environment ?? 'PROD'}
        onBack={() => setView('dashboard')}
      />
    )
  }

  if (view === 'volume-breakout') {
    return (
      <div className="subview-shell">
        {renderDashboardNav('Scanner')}
        <main className="subview-main">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="ghost-inline" onClick={() => setView('dashboard')}>← Dashboard</button>
            <span className="builder-crumb-sep">/</span>
            <span style={{ fontSize: 13, color: 'var(--fg-dim)' }}>Volume Breakout</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span className="pill-v2">{volumeBreakoutStatus?.interval ?? '5m'} / {volumeBreakoutStatus?.refresh_seconds ?? 30}s</span>
              <span className="pill-v2">Live: {volumeBreakoutStatus?.live_status ?? 'idle'}</span>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card"><span className="summary-label">Universe</span><strong>{volumeBreakoutStatus?.summary.tracked_stocks ?? 0}</strong><small>Tracked stocks</small></div>
            <div className="summary-card"><span className="summary-label">Active Breakouts</span><strong>{volumeBreakoutStatus?.summary.active_breakouts ?? 0}</strong><small>Above threshold</small></div>
            <div className="summary-card"><span className="summary-label">Latest Candle</span><strong>{volumeBreakoutStatus?.summary.latest_candle_ist ? 'Ready' : 'Pending'}</strong><small>{volumeBreakoutStatus?.summary.latest_candle_ist ?? 'Waiting...'}</small></div>
            <div className="summary-card"><span className="summary-label">Price Confirmed</span><strong>{volumeBreakoutStatus?.summary.leaders_with_price_breakout ?? 0}</strong><small>Above lookback high</small></div>
          </div>
          <div className="msg-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div><strong style={{ display: 'block', marginBottom: 4 }}>Scanner Mode</strong>{volumeBreakoutMessage}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
              <span className="pill-v2">WS: {volumeBreakoutStatus?.live_subscribed_symbols ?? 0}</span>
              <span className="pill-v2">Last: {volumeBreakoutStatus?.last_run_ist ?? 'Waiting...'}</span>
            </div>
          </div>

          <div className="volume-breakout-grid">
            <div className="sb-card">
              <div className="sb-card-head"><div><span className="sb-card-kicker">Market Rankers</span><h3>Top Volume Ratio</h3></div></div>
              <div className="table-shell">
                <div className="table-row table-head volume-stock-grid"><span>Stock</span><span>Exchange</span><span>Ratio</span><span>Volume</span><span>Price</span></div>
                {(volumeBreakoutStatus?.market_breakouts ?? []).length === 0 ? (
                  <div className="table-empty">No market-wide leaders available yet.</div>
                ) : (
                  (volumeBreakoutStatus?.market_breakouts ?? []).map((row) => (
                    <div key={`${row.symbol}-${row.candle_time_ist}`} className="table-row volume-stock-grid">
                      <span><strong>{row.symbol}</strong><small>{row.display_name}</small></span>
                      <span>{row.exchange}</span>
                      <span className={row.meets_breakout ? 'text-success' : 'text-muted'}>{row.volume_ratio.toFixed(2)}x</span>
                      <span>{formatCompactNumber(row.current_volume)}</span>
                      <span className={row.is_green ? 'text-success' : 'text-danger'}>{row.last_price.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sb-card">
              <div className="sb-card-head"><div><span className="sb-card-kicker">Fresh Entrants</span><h3>Latest Candle Breakouts</h3></div></div>
              <div className="table-shell">
                <div className="table-row table-head volume-recent-grid"><span>Stock</span><span>Exchange</span><span>Time</span><span>Ratio</span><span>Price Breakout</span></div>
                {(volumeBreakoutStatus?.recent_breakouts ?? []).length === 0 ? (
                  <div className="table-empty">No fresh entrants yet.</div>
                ) : (
                  (volumeBreakoutStatus?.recent_breakouts ?? []).map((row) => (
                    <div key={`recent-${row.symbol}-${row.candle_time_ist}`} className="table-row volume-recent-grid">
                      <span>{row.symbol}</span><span>{row.exchange}</span><span>{row.candle_time_ist}</span>
                      <span>{row.volume_ratio.toFixed(2)}x</span>
                      <span className={row.is_price_breakout ? 'text-success' : 'text-muted'}>{row.is_price_breakout ? formatPercent(row.price_breakout_pct) : 'Not yet'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {volumeBreakoutError ? <div className="err-banner">{volumeBreakoutError}</div> : null}
        </main>
      </div>
    )
  }

  if (view === 'tradingview-webhook') {
    return (
      <div className="subview-shell">
        {renderDashboardNav('Webhook')}
        <main className="subview-main">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="ghost-inline" onClick={() => setView('dashboard')}>← Dashboard</button>
            <span className="builder-crumb-sep">/</span>
            <span style={{ fontSize: 13, color: 'var(--fg-dim)' }}>TradingView Webhook</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span className={`pill-v2 ${webhookConfigured ? 'pill-success' : ''}`}>{webhookConfigured ? 'Configured' : 'Not configured'}</span>
              <span className="pill-v2">{tradingViewProduct === 'ORDER_DELIVERY_TYPE_IDAY' ? 'Intraday' : 'CNC'}</span>
              <span className={`pill-v2 ${executionEnabled ? 'pill-success' : 'pill-danger'}`}>{executionEnabled ? 'Execution On' : 'Kill Switch On'}</span>
            </div>
          </div>

          <div className="msg-banner" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Next Step</strong>
              <p style={{ fontSize: 13, color: 'var(--fg-dim)' }}>{nextWebhookAction}</p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <span className={`pill-v2 ${webhookConfigured ? 'pill-success' : ''}`}>1. Config {webhookConfigured ? '✓' : 'Pending'}</span>
              <span className={`pill-v2 ${tunnelReady ? 'pill-success' : ''}`}>2. URL {tunnelReady ? '✓' : 'Pending'}</span>
              <span className={`pill-v2 ${hasTestHistory ? 'pill-success' : ''}`}>3. Test {hasTestHistory ? '✓' : 'Pending'}</span>
              <span className={`pill-v2 ${executionEnabled ? 'pill-success' : 'pill-danger'}`}>4. Live {executionEnabled ? 'Ready' : 'Blocked'}</span>
            </div>
          </div>

          {/* Step 1: Configure */}
          <div className="webhook-step-section">
            <div className="step-heading"><span className={webhookConfigured ? 'step-badge done' : 'step-badge'}>1</span><div><h2>Set Up Webhook Access</h2><p>Create the private secret and execution defaults.</p></div></div>
            <div className="tradingview-grid">
              <div className="sb-card">
                <h3 style={{ marginBottom: 14 }}>Access & Execution Settings</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label className="field-group-label">Webhook Secret</label><input className="field-input" value={tradingViewSecret} onChange={(e) => setTradingViewSecret(e.target.value)} placeholder="Auto-generated if left blank" /></div>
                  <div><label className="field-group-label">Default Product</label><select className="field-select" value={tradingViewProduct} onChange={(e) => setTradingViewProduct(e.target.value as OrderDeliveryType)}><option value="ORDER_DELIVERY_TYPE_IDAY">Intraday (MIS)</option><option value="ORDER_DELIVERY_TYPE_CNC">Delivery (CNC)</option></select></div>
                  <div className="kill-switch-card">
                    <div><strong style={{ fontSize: 13, fontWeight: 500 }}>Order Execution</strong><p style={{ fontSize: 12, color: 'var(--fg-dim)', marginTop: 4 }}>Pause live orders without stopping the webhook.</p></div>
                    <div className="kill-switch-actions">
                      <button className={`ghost-inline ${tradingViewStatus?.execution_enabled !== false ? 'ghost-inline-accent' : ''}`} onClick={() => handleTradingViewKillSwitch(true)} disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}>Allow Orders</button>
                      <button className="ghost-inline" onClick={() => handleTradingViewKillSwitch(false)} disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}>Pause Orders</button>
                    </div>
                  </div>
                  <button className="primary-btn" style={{ width: '100%' }} onClick={handleTradingViewConfigure} disabled={!session || Boolean(session?.is_demo) || tradingViewActionState !== null}>{tradingViewActionState === 'configure' ? 'Saving...' : 'Save Webhook Settings'}</button>
                  <button className="ghost-inline" style={{ width: '100%', textAlign: 'center' }} onClick={handleTradingViewReset} disabled={tradingViewActionState !== null || !tradingViewStatus?.configured}>{tradingViewActionState === 'reset' ? 'Resetting...' : 'Clear Webhook Settings'}</button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Tunnel */}
          <div className="webhook-step-section">
            <div className="step-heading"><span className={tunnelReady ? 'step-badge done' : 'step-badge'}>2</span><div><h2>Generate Public URL</h2><p>Create the public HTTPS endpoint TradingView will POST to.</p></div></div>
            <div className="tradingview-grid">
              <div className="sb-card">
                <div className="tunnel-grid">
                  <div className="tunnel-panel"><span className="summary-label">Webhook URL</span><strong className="tunnel-url">{tunnelStatus?.public_url ? `${tunnelStatus.public_url}/api/webhooks/tradingview` : 'Generate URL first'}</strong><small>TradingView requires HTTPS. Reuse while tunnel runs.</small></div>
                  <div className="tunnel-panel"><span className="summary-label">Session</span><strong>{tradingViewStatus?.user_name ?? session?.user_name ?? 'Nubra User'}</strong><small>{session?.environment ?? 'UAT'} / {tradingViewProduct === 'ORDER_DELIVERY_TYPE_IDAY' ? 'MIS' : 'CNC'}</small></div>
                </div>
                <div className="tunnel-actions" style={{ marginTop: 14 }}>
                  <button className="ghost-inline ghost-inline-accent" onClick={() => handleTunnelAction('start')} disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}>{tunnelAction === 'start' ? 'Starting...' : 'Generate Public Webhook URL'}</button>
                  <button className="ghost-inline" onClick={() => handleTunnelAction('refresh')} disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}>Refresh</button>
                  <button className="ghost-inline" onClick={() => handleTunnelAction('stop')} disabled={!tunnelStatus?.running || tunnelAction !== null}>Stop</button>
                  <button className="ghost-inline" onClick={() => copyToClipboard(webhookUrl, 'copy-url')} disabled={!webhookUrl || tradingViewActionState !== null}>{tradingViewActionState === 'copy-url' ? 'Copying...' : 'Copy URL'}</button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Payload Builder */}
          <div className="webhook-step-section">
            <div className="step-heading"><span className="step-badge">3</span><div><h2>Build Payload</h2><p>Generate the Nubra JSON alert body for TradingView.</p></div></div>
            <div className="sb-card">
              <div className="sb-card-head">
                <div><span className="sb-card-kicker">Payload Builder</span><h3>Alert JSON Generator</h3></div>
                <div className="mode-toggle">
                  <button className={tradingViewMode === 'line' ? 'indicator-box active' : 'indicator-box'} onClick={() => setTradingViewMode('line')}>Line Alert</button>
                  <button className={tradingViewMode === 'strategy' ? 'indicator-box active' : 'indicator-box'} onClick={() => setTradingViewMode('strategy')}>Strategy Alert</button>
                </div>
              </div>
              <div className="tradingview-form-grid">
                <div><label className="field-group-label">Strategy Name</label><input className="field-input" value={tradingViewStrategyName} onChange={(e) => setTradingViewStrategyName(e.target.value)} /></div>
                <div><label className="field-group-label">Symbol</label><input className="field-input" value={tradingViewSymbol} onChange={(e) => setTradingViewSymbol(e.target.value.toUpperCase())} /></div>
                <div><label className="field-group-label">Exchange</label><select className="field-select" value={tradingViewExchange} onChange={(e) => setTradingViewExchange(e.target.value)}><option value="NSE">NSE</option><option value="BSE">BSE</option></select></div>
                <div><label className="field-group-label">Action</label><select className="field-select" value={tradingViewOrderAction} onChange={(e) => setTradingViewOrderAction(e.target.value as TradingViewAction)}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></div>
                <div><label className="field-group-label">Quantity</label><input className="field-input" value={tradingViewQuantity} onChange={(e) => setTradingViewQuantity(e.target.value.replace(/\D/g,'') || '1')} /></div>
                <div><label className="field-group-label">Tag</label><input className="field-input" value={tradingViewTag} onChange={(e) => setTradingViewTag(e.target.value)} placeholder="swing-1 or 2026-04-15" /></div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="primary-btn" style={{ fontSize: 13, padding: '10px 18px' }} onClick={handleTradingViewTest} disabled={!tradingViewStatus?.configured || !session || Boolean(session.is_demo) || tradingViewActionState !== null}>{tradingViewActionState === 'test' ? 'Sending...' : 'Send Test Payload'}</button>
              </div>
            </div>
          </div>

          {/* Step 4: Copy JSONs */}
          <div className="webhook-step-section">
            <div className="step-heading"><span className={hasTestHistory ? 'step-badge done' : 'step-badge'}>4</span><div><h2>Copy and Test</h2><p>Copy the payload, then send a test before going live.</p></div></div>
            <div className="tradingview-grid">
              <div className="sb-card">
                <div className="sb-card-head"><div><span className="sb-card-kicker">Strategy JSON</span><h3>Nubra Strategy Alert</h3></div><button className="ghost-inline" onClick={() => copyToClipboard(tradingViewStrategyJson, 'copy-strategy')} disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}>{tradingViewActionState === 'copy-strategy' ? 'Copying...' : 'Copy JSON'}</button></div>
                <pre className="code-block">{tradingViewStrategyJson}</pre>
              </div>
              <div className="sb-card">
                <div className="sb-card-head"><div><span className="sb-card-kicker">Line Alert JSON</span><h3>Nubra Manual Alert</h3></div><button className="ghost-inline" onClick={() => copyToClipboard(tradingViewLineJson, 'copy-line')} disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}>{tradingViewActionState === 'copy-line' ? 'Copying...' : 'Copy JSON'}</button></div>
                <pre className="code-block">{tradingViewLineJson}</pre>
              </div>
            </div>
          </div>

          {/* Step 5: Monitor */}
          <div className="webhook-step-section">
            <div className="step-heading"><span className={executionEnabled ? 'step-badge done' : 'step-badge'}>5</span><div><h2>Go Live and Monitor</h2><p>Watch webhook orders and event history below.</p></div></div>
            <div className="tradingview-grid">
              <div className="sb-card">
                <div className="sb-card-head"><div><span className="sb-card-kicker">Order History</span><h3>Webhook Orders</h3></div><span className="pill-v2">{filteredOrderHistory.length} orders</span></div>
                {filteredOrderHistory.length === 0 ? <div className="table-empty">No accepted webhook orders yet.</div> : (
                  <div className="table-shell">
                    <div className="table-row table-head webhook-order-grid" style={{ gridTemplateColumns: '1.5fr 1.5fr 1fr 1.5fr 1fr' }}><span>Time</span><span>Trade</span><span>Qty</span><span>Prices</span><span>P&L</span></div>
                    {filteredOrderHistory.map((entry) => (
                      <div key={`${entry.time_ist}-${entry.order_id ?? entry.instrument ?? 'trade'}`} className="table-row webhook-order-grid" style={{ gridTemplateColumns: '1.5fr 1.5fr 1fr 1.5fr 1fr' }}>
                        <span><strong>{entry.time_ist}</strong><small>{entry.source === 'test' ? 'Test' : 'Live'}</small></span>
                        <span><strong>{entry.instrument ?? '-'}</strong><small>{entry.action ?? '-'} | {entry.strategy ?? 'No strategy'}</small></span>
                        <span><strong>{entry.filled_qty ?? entry.placed_qty ?? entry.requested_qty ?? '-'}</strong><small>{entry.order_status ?? 'Pending'}</small></span>
                        <span><strong>Fill {entry.avg_filled_price?.toFixed(2) ?? 'Pending'}</strong><small>LTP {entry.current_price?.toFixed(2) ?? 'Pending'}</small></span>
                        <span><strong>{entry.pnl === null ? 'Pending' : entry.pnl.toFixed(2)}</strong></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="sb-card">
                <div className="sb-card-head"><div><span className="sb-card-kicker">Event Log</span><h3>Webhook Activity</h3></div>
                  <div className="mode-toggle">
                    <button className={historySourceFilter === 'all' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('all')}>All</button>
                    <button className={historySourceFilter === 'test' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('test')}>Test</button>
                    <button className={historySourceFilter === 'live' ? 'indicator-box active' : 'indicator-box'} onClick={() => setHistorySourceFilter('live')}>Live</button>
                  </div>
                </div>
                {filteredHistory.length === 0 ? <div className="table-empty">No webhook history yet.</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredHistory.map((entry) => (
                      <div key={entry.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong style={{ fontSize: 13 }}>{entry.message}</strong><span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{entry.time_ist}</span></div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`pill-v2 ${entry.status === 'accepted' ? 'pill-success' : entry.status === 'error' || entry.status === 'blocked' ? 'pill-danger' : ''}`}>{entry.status}</span>
                          <span className="pill-v2">{entry.source === 'test' ? 'Test' : 'Live'}</span>
                          {entry.instrument && <span className="pill-v2 pill-accent">{entry.instrument}</span>}
                          {entry.action && <span className="pill-v2">{entry.action}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {tradingViewError ? <div className="err-banner">{tradingViewError}</div> : null}
          {tradingViewMessage ? <div className="msg-banner">{tradingViewMessage}</div> : null}
        </main>
      </div>
    )
  }

  if (view === 'scalper') {
    return (
      <div className="subview-shell">
        {renderDashboardNav('Scalper')}
        <main className="subview-main">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="ghost-inline" onClick={() => setView('dashboard')}>← Dashboard</button>
            <span className="builder-crumb-sep">/</span>
            <span style={{ fontSize: 13, color: 'var(--fg-dim)' }}>Scalper</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span className="pill-v2">{session?.environment ?? 'UAT'}</span>
              <span className="pill-v2">{scalperUnderlying} · {scalperInterval}</span>
              <span className="pill-v2" style={{ color: scalperFeedTone }}>
                {scalperValidating ? '◌ Checking' : liveConnected ? '● Live' : liveError ? '● Error' : '○ Connecting'}
              </span>
            </div>
          </div>

          {session?.is_demo ? (
            <div className="msg-banner">
              <strong style={{ display: 'block', marginBottom: 4 }}>Real session required</strong>
              Live charts stream Nubra market data. Open a real UAT or PROD session to activate the scalper workspace.
            </div>
          ) : (
            <>
              <div className="scalper-controls">
                <label>UNDERLYING<select value={scalperUnderlying} onChange={(e) => setScalperUnderlying(e.target.value as (typeof scalperUnderlyings)[number])}>{scalperUnderlyings.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label>TIMEFRAME<select value={scalperInterval} onChange={(e) => setScalperInterval(e.target.value as Interval)}>{intervals.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label>STRIKE<input type="text" value={scalperStrikePrice} onChange={(e) => setScalperStrikePrice(e.target.value.replace(/[^\d]/g,''))} placeholder="24300" /></label>
                <label>EXPIRY<input type="text" value={scalperExpiry} onChange={(e) => setScalperExpiry(e.target.value.toUpperCase())} placeholder="21 APR 26" /></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span className="pill-v2" style={{ color: scalperFeedTone }}>{scalperFeedLabel}</span>
                    <span className="pill-v2">{optionPair?.expiry ?? 'No expiry'}</span>
                    <span className="pill-v2">Lot {optionPair?.lot_size ?? '--'}</span>
                  </div>
                  <button className="primary-btn" style={{ padding: '10px 18px', fontSize: 13 }} disabled={scalperValidating} onClick={() => { void validateScalperSessionAndReconnect() }}>
                    {scalperValidating ? 'Checking...' : liveConnected ? 'Reconnect Feed' : 'Connect Feed'}
                  </button>
                </div>
              </div>

              <div className="scalper-grid">
                <ScalperLiveChart panel="call_option" accent="green" title="Call Option" displayName={callMeta?.display_name ?? null} lastPrice={callMeta?.last_price ?? null} interval={callMeta?.interval ?? scalperInterval} exchange={callMeta?.exchange ?? 'NSE'} height={360} onSeriesReady={registerPanel} />
                <ScalperLiveChart panel="underlying" accent="blue" title="Underlying" displayName={underlyingMeta?.display_name ?? null} lastPrice={underlyingMeta?.last_price ?? null} interval={underlyingMeta?.interval ?? scalperInterval} exchange={underlyingMeta?.exchange ?? 'NSE'} height={360} onSeriesReady={registerPanel} />
                <ScalperLiveChart panel="put_option" accent="red" title="Put Option" displayName={putMeta?.display_name ?? null} lastPrice={putMeta?.last_price ?? null} interval={putMeta?.interval ?? scalperInterval} exchange={putMeta?.exchange ?? 'NSE'} height={360} onSeriesReady={registerPanel} />
              </div>

              <div className="msg-banner" style={{ fontSize: 12 }}>
                {optionPair ? `${optionPair.call_display_name} / ${optionPair.put_display_name}` : 'Resolving option pair...'}
                {liveError ? <span style={{ color: 'var(--neg-soft)', marginLeft: 16 }}>{liveError}</span> : null}
              </div>
            </>
          )}
        </main>
      </div>
    )
  }

  if (view === 'dashboard') {
    const moduleCards = [
      { key: 'no-code' as const,            title: 'No-Code Backtester', sub: 'Visual strategy authoring',    accent: 'rgb(124,207,94)',  glow: '124,207,94',  icon: 'backtest' },
      { key: 'volume-breakout' as const,     title: 'Volume Breakout',    sub: 'Market-wide breakout scanner', accent: 'rgb(120,201,255)', glow: '120,201,255', icon: 'platform' },
      { key: 'tradingview-webhook' as const, title: 'Webhook Strategies', sub: 'Signal-driven automation',     accent: 'rgb(177,102,16)',  glow: '177,102,16',  icon: 'webhook'  },
      { key: 'scalper' as const,             title: 'Scalper',            sub: 'Intraday live charts',          accent: 'rgb(149,220,122)', glow: '149,220,122', icon: 'chain'    },
      { key: null,                           title: 'Trade Book',         sub: 'Historical ledger',             accent: 'rgb(0,118,196)',   glow: '0,118,196',   icon: 'book'     },
      { key: null,                           title: 'Risk & Tools',       sub: 'Exposure & position sizing',   accent: 'rgb(241,66,66)',   glow: '241,66,66',   icon: 'risk'     },
    ]
    const iconPaths: Record<string, React.ReactNode> = {
      backtest: <><path d="M3 17l4-6 4 3 6-9"/><path d="M3 21h18"/></>,
      platform: <><rect x={3} y={4} width={18} height={13} rx={1.5}/><path d="M3 14h18M8 20h8M12 17v3"/></>,
      webhook:  <><circle cx={7} cy={7} r={2.5}/><circle cx={17} cy={17} r={2.5}/><circle cx={17} cy={7} r={2.5}/><path d="M9 8.5L15 15.5M15 7h-6"/></>,
      book:     <><path d="M4 5v15a1 1 0 001 1h15V6a2 2 0 00-2-2H6a2 2 0 00-2 1z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
      chain:    <><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/><path d="M12 4v16"/></>,
      risk:     <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z"/><path d="M12 9v4M12 16v.01"/></>,
    }
    return (
      <div className="dash">
        {renderDashboardNav('Dashboard')}
        <main className="dash-main">
          <section className="hero">
            <div className="hero-l">
              <div className="eyebrow"><span className="eyebrow-dot"/>SESSION / {session?.environment ?? 'PROD'}</div>
              <h1 className="hero-title">{isSessionChecking ? 'Checking session...' : `Welcome, ${session?.user_name?.split(' ')[0] ?? 'Trader'}.`}</h1>
              <p className="hero-sub">Your NubraOSS workspace is live on <em>{session?.environment ?? 'PROD'}</em>. Launch any module below to begin executing strategies.</p>
            </div>
            <div className="hero-r">
              <div className="live-stat"><span className="ls-label">Environment</span><span className="ls-value">{session?.environment ?? '—'}</span><span className="ls-delta">{tunnelStatus?.running ? 'Tunnel active' : 'Tunnel off'}</span></div>
              <div className="live-stat"><span className="ls-label">Broker</span><span className="ls-value">{session?.broker ?? '—'}</span><span className="ls-delta">Session active</span></div>
              <div className="live-stat"><span className="ls-label">Public IP</span><span className="ls-value" style={{fontSize:14}}>{publicIp || '...'}</span><span className="ls-delta">Machine IP</span></div>
              <div className="live-stat"><span className="ls-label">Tunnel</span><span className={`ls-value ls-delta ${tunnelStatus?.running ? 'pos' : ''}`} style={{fontSize:14}}>{tunnelStatus?.running ? 'Running' : 'Stopped'}</span><span className="ls-delta">{tunnelStatus?.public_url ? 'URL ready' : 'Generate URL'}</span></div>
            </div>
          </section>

          <section className="modules">
            <div className="section-head"><h2>Operating modules</h2><span className="section-meta">Six surfaces / unified runtime</span></div>
            <div className="module-grid">
              {moduleCards.map((mod, index) => (
                <button
                  key={mod.title}
                  className="module-card"
                  style={{ '--accent': mod.accent, '--glow': mod.glow } as React.CSSProperties}
                  onClick={mod.key ? () => handleDashboardCardOpen(mod.key!) : undefined}
                  disabled={!mod.key}
                >
                  <div className="mc-glow" aria-hidden />
                  <div className="mc-top">
                    <div className="mc-icon">
                      <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">{iconPaths[mod.icon]}</svg>
                    </div>
                    <span className="mc-num">0{index + 1}</span>
                  </div>
                  <div className="mc-body"><h3 className="mc-title">{mod.title}</h3><p className="mc-sub">{mod.sub}</p></div>
                  <div className="mc-foot"><span className="mc-cta">{mod.key ? 'Open' : 'Soon'}<svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></div>
                </button>
              ))}
            </div>
          </section>

          <section className="rail">
            <div className="rail-panel">
              <div className="panel-h"><h3>Public Webhook Tunnel</h3><span className="panel-h-meta">{tunnelStatus?.running ? 'Active' : 'Offline'}</span></div>
              <div className="tunnel-grid">
                <div className="tunnel-panel"><span className="summary-label">Webhook URL</span><strong className="tunnel-url">{tunnelStatus?.public_url ?? 'Not generated'}</strong><small>{tunnelStatus?.running ? 'TradingView ready' : 'Start tunnel to get URL'}</small></div>
                <div className="tunnel-panel"><span className="summary-label">Local Target</span><strong>{tunnelStatus?.target_url ?? 'http://127.0.0.1:8000'}</strong><small>Status: {tunnelStatus?.running ? 'Running' : 'Stopped'}</small></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="ghost-inline ghost-inline-accent" onClick={() => handleTunnelAction('start')} disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}>{tunnelAction === 'start' ? 'Starting...' : 'Start Tunnel'}</button>
                <button className="ghost-inline" onClick={() => handleTunnelAction('refresh')} disabled={!session || Boolean(session?.is_demo) || tunnelAction !== null}>Refresh</button>
                <button className="ghost-inline" onClick={() => handleTunnelAction('stop')} disabled={!tunnelStatus?.running || tunnelAction !== null}>Stop</button>
              </div>
              {tunnelStatus?.last_error ? <div className="err-banner" style={{marginTop:10}}>{tunnelStatus.last_error}</div> : null}
            </div>
            <div className="rail-panel">
              <div className="panel-h"><h3>Session</h3><span className="panel-h-meta">Active</span></div>
              <div className="system">
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Account</span><span className="sys-v">{session?.account_id ?? '—'}</span></div></div>
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">User</span><span className="sys-v">{session?.user_name ?? '—'}</span></div></div>
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Environment</span><span className="sys-v">{session?.environment ?? '—'}</span></div></div>
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Broker</span><span className="sys-v">{session?.broker ?? '—'}</span></div></div>
              </div>
            </div>
            <div className="rail-panel">
              <div className="panel-h"><h3>System</h3><span className="panel-h-meta">Live</span></div>
              <div className="system">
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Tunnel</span><span className="sys-v">{tunnelStatus?.running ? 'Running' : 'Stopped'}</span></div><div className="sys-bar"><span className={`sys-fill ${tunnelStatus?.running ? 'green' : ''}`} style={{width: tunnelStatus?.running ? '100%' : '0%'}} /></div></div>
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Session</span><span className="sys-v">Active</span></div><div className="sys-bar"><span className="sys-fill green" style={{width:'100%'}} /></div></div>
                <div className="sys-row"><div className="sys-meta"><span className="sys-k">Public IP</span><span className="sys-v">{publicIp || 'Loading'}</span></div><div className="sys-bar"><span className="sys-fill" style={{width: publicIp ? '100%' : '20%'}} /></div></div>
              </div>
            </div>
          </section>
        </main>
      </div>
    )
  }

  // ── Login Screen ─────────────────────────────────────────────────────────
  return (
    <div className="auth-scene">
      <div className="auth-bg">
        <div className="grid-pattern" />
        <div className="ambient a1" />
        <div className="ambient a2" />
      </div>

      <header className="auth-chrome">
        <div className="logo">
          <img className="mark-img" src={nubraLogo} alt="" aria-hidden width={34} height={34} />
          <span className="wm" style={{ fontSize: 16 }}>NubraOSS</span>
        </div>
        <div className="chrome-right">
          <span className="chrome-meta"><span className="live-dot"/>All systems nominal</span>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            <span className={`tt-track ${theme}`}>
              <span className="tt-thumb">
                {theme === 'dark'
                  ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/></svg>
                  : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round"><circle cx={12} cy={12} r={4}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>
                }
              </span>
            </span>
          </button>
        </div>
      </header>

      <main className="auth-stage">
        <div className="glass-panel">
          <div className="panel-edge" aria-hidden />
          <div className="panel-head">
            <div className="eyebrow"><span className="eyebrow-dot"/>INSTITUTIONAL GRADE · V2.0</div>
            <h1 className="panel-title">Sign in</h1>
            <p className="panel-sub">Resume where precision meets scale.</p>
          </div>

          <div className="seg-control" role="tablist" aria-label="Environment selector">
            <span className={`seg-pill ${environment === 'UAT' ? 'right' : ''}`} />
            {(['PROD','UAT'] as const).map((env) => (
              <button key={env} className={`seg-btn ${environment === env ? 'on' : ''}`} onClick={() => setEnvironment(env)}>
                <span className={`env-dot ${env === 'PROD' ? 'prod' : 'uat'}`}/>{env}
              </button>
            ))}
          </div>

          <div className="step-rail">
            {(['Identity','Verification','MPIN'] as const).map((label, idx) => (
              <div key={label} className={`step ${idx === currentStep ? 'active' : ''} ${idx < currentStep ? 'done' : ''}`}>
                <span className="step-n">0{idx + 1}</span>
                <span className="step-l">{label}</span>
              </div>
            ))}
          </div>

          <div className="form-body">
            {step === 'start' && (
              <form onSubmit={handleStart}>
                <div className="field-group-v2">
                  <label className="field">
                    <span className="field-label">Phone number</span>
                    <div className="field-row">
                      <span className="prefix">+91</span>
                      <input autoFocus type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="00000 00000" />
                      <span className="field-hint">{phone.length}/10</span>
                    </div>
                    <span className="field-line"/>
                  </label>
                </div>
                <button type="submit" className={`primary-btn ${activeAction !== null || phone.length < 10 ? 'disabled' : ''}`} disabled={activeAction !== null || phone.length < 10} style={{ marginTop: 24, width: '100%' }}>
                  <span>{activeAction === 'phone' ? 'Sending OTP...' : 'Continue'}</span>
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </button>
                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <button type="button" className="link-btn" onClick={handleDemoLogin}>Try demo mode</button>
                </div>
              </form>
            )}

            {step === 'otp' && (
              <form onSubmit={handleOtp}>
                <div className="field-group-v2">
                  <span className="field-label center">One-time passcode sent to +91 {maskedPhone || 'xxxxx'}</span>
                  <div className="otp-row">
                    {otpDigits.map((digit, idx) => (
                      <input key={idx} ref={(el) => { otpCells.current[idx] = el }} className="otp-cell" value={digit}
                        onChange={(e) => handleOtpCell(idx, e.target.value.slice(-1))}
                        onKeyDown={(e) => { if (e.key === 'Backspace' && !digit) otpCells.current[idx-1]?.focus() }}
                        inputMode="numeric" maxLength={1} />
                    ))}
                  </div>
                </div>
                <button type="submit" className={`primary-btn ${activeAction !== null || otp.length < 4 ? 'disabled' : ''}`} disabled={activeAction !== null || otp.length < 4} style={{ marginTop: 24, width: '100%' }}>
                  <span>{activeAction === 'otp' ? 'Verifying...' : 'Verify OTP'}</span>
                </button>
                <button type="button" className="ghost-btn" onClick={() => setStep('start')}>Back</button>
              </form>
            )}

            {(step === 'mpin' || step === 'success') && (
              <form onSubmit={handleMpin}>
                <div className="field-group-v2">
                  <span className="field-label center">Enter your MPIN</span>
                  <div className="mpin-row">
                    {[0,1,2,3].map((idx) => (
                      <input key={idx} ref={(el) => { mpinCells.current[idx] = el }} className="mpin-cell" type="password"
                        value={mpinDigits[idx] ?? ''}
                        onChange={(e) => handleMpinCell(idx, e.target.value.slice(-1))}
                        onKeyDown={(e) => { if (e.key === 'Backspace' && !mpinDigits[idx]) mpinCells.current[idx-1]?.focus() }}
                        inputMode="numeric" maxLength={1} disabled={mpinComplete} />
                    ))}
                  </div>
                  <span className="field-hint center">Encrypted end-to-end</span>
                </div>
                <button type="submit" className={`primary-btn ${activeAction !== null || mpin.length < 4 || mpinComplete ? 'disabled' : ''}`} disabled={activeAction !== null || mpin.length < 4 || mpinComplete} style={{ marginTop: 24, width: '100%' }}>
                  <span>{activeAction === 'mpin' ? 'Entering platform...' : 'Enter Platform'}</span>
                </button>
                <button type="button" className="ghost-btn" onClick={() => setStep('otp')}>Back</button>
              </form>
            )}

            {error ? <div className="err-banner">{error}</div> : null}
            {message && !error ? <div className="msg-banner">{message}</div> : null}
          </div>

          <div className="panel-foot">
            <span>
              <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x={4} y={10} width={16} height={11} rx={2}/><path d="M8 10V7a4 4 0 118 0v3"/></svg>
              Zero-knowledge / 256-bit
            </span>
            <span className="dot-sep">/</span>
            <span>SEBI / FINRA</span>
          </div>
        </div>
      </main>

      <footer className="auth-foot">
        <span>© 2026 NubraOSS</span>
        <span>Sovereign-grade infrastructure</span>
        <span>Build 2.0 / mumbai-1</span>
      </footer>
    </div>
  )
}
