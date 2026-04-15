import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import nubraLogo from './assets/nubra-logo.png'

type Environment = 'PROD' | 'UAT'
type Step = 'start' | 'otp' | 'mpin' | 'success'
type View = 'login' | 'dashboard' | 'no-code' | 'volume-breakout' | 'tradingview-webhook'
type TradingViewMode = 'strategy' | 'line'
type TradingViewAction = 'BUY' | 'SELL'
type Interval = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1h'
type Indicator = 'EMA' | 'MA' | 'RSI'
type OrderDeliveryType = 'ORDER_DELIVERY_TYPE_CNC' | 'ORDER_DELIVERY_TYPE_IDAY'
type StrategySideMode = 'BOTH' | 'LONG_ONLY' | 'SHORT_ONLY'

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
const dashboardTabs = ['Dashboard']

const dashboardCards = [
  {
    badge: 'NC',
    badgeClass: 'badge-indigo',
    title: 'No Code Algo',
    description: 'Visual strategy builder for creating and launching rule-based trading flows.',
    footer: 'Open No Code Algo',
    key: 'no-code' as const,
  },
  {
    badge: 'VB',
    badgeClass: 'badge-blue',
    title: 'Volume Breakout',
    description: 'Scan sector leaders and market-wide volume breakouts across major Indian stocks.',
    footer: 'Open Scanner',
    key: 'volume-breakout' as const,
  },
  {
    badge: 'WS',
    badgeClass: 'badge-emerald',
    title: 'Webhook Strategies',
    description: 'Manage alert-driven trading strategies and view active automation status.',
    footer: 'Open Strategies',
    key: 'tradingview-webhook' as const,
  },
  {
    badge: 'TB',
    badgeClass: 'badge-slate',
    title: 'Trade Book',
    description: 'Review executed trades, fills, and trade-side summaries across the session.',
    footer: 'Open Trade Book',
  },
  {
    badge: 'OC',
    badgeClass: 'badge-orange',
    title: 'Option Chain',
    description: 'Monitor live option chain data, strike context, and quick action flows.',
    footer: 'Open Option Chain',
  },
  {
    badge: 'RT',
    badgeClass: 'badge-cyan',
    title: 'Risk & Tools',
    description: 'Launch margin checks, analytics utilities, and internal risk helpers.',
    footer: 'Open Tools',
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
  return '—'
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
  const previousAlertCount = useRef(0)

  const phoneComplete = flowId.length > 0
  const otpComplete = step === 'mpin' || step === 'success'
  const mpinComplete = step === 'success'
  const derivedDeviceId = session?.device_id ?? (phone ? `Nubra-OSS-${phone}` : 'Nubra-OSS-<phone>')

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
    setNoCodeMessage('Configure one instrument and start the IST scheduler.')
    setVolumeBreakoutMessage(
      'DB bootstrap loads first, then the backend websocket overlays live bucket updates while this page stays open.',
    )
  }

  function handleDashboardCardOpen(nextView: Extract<View, 'no-code' | 'volume-breakout' | 'tradingview-webhook'>) {
    if (session?.is_demo && nextView !== 'tradingview-webhook') {
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
  const pnlSummary = tradingViewStatus?.pnl_summary ?? {
    realized_pnl: 0,
    unrealized_pnl: 0,
    total_pnl: 0,
    open_positions: 0,
    closed_groups: 0,
  }
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
                  <div><span>Instrument</span><strong>{noCodeStatus?.instrument ?? 'â€”'}</strong></div>
                  <div><span>Interval</span><strong>{noCodeStatus?.interval ?? 'â€”'}</strong></div>
                  <div><span>Indicator</span><strong>{noCodeStatus?.indicator ?? 'â€”'}</strong></div>
                  <div><span>Strategy Side</span><strong>{formatStrategySideMode(noCodeStatus?.strategy_side_mode)}</strong></div>
                  <div><span>Last Run</span><strong>{noCodeStatus?.last_run_ist ?? 'â€”'}</strong></div>
                  <div><span>Next Run</span><strong>{noCodeStatus?.next_run_ist ?? 'â€”'}</strong></div>
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

          <section className="webhook-summary-grid">
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Realized P&L</span>
              <strong>{pnlSummary.realized_pnl.toFixed(2)}</strong>
              <small>Closed webhook trades matched by strategy, tag, and instrument.</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Unrealized P&L</span>
              <strong>{pnlSummary.unrealized_pnl.toFixed(2)}</strong>
              <small>Mark-to-market on currently open webhook positions.</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Total P&L</span>
              <strong>{pnlSummary.total_pnl.toFixed(2)}</strong>
              <small>Combined realized and open-position webhook trading P&L.</small>
            </article>
            <article className="dashboard-module-card compact-card">
              <span className="summary-label">Open / Closed Groups</span>
              <strong>{pnlSummary.open_positions} / {pnlSummary.closed_groups}</strong>
              <small>Grouped by strategy, tag, and instrument for clean tracking.</small>
            </article>
          </section>

          <section className="webhook-step-section">
            <div className="step-heading">
              <span className={webhookConfigured ? 'step-badge done' : 'step-badge'}>1</span>
              <div>
                <h2>Configure Webhook</h2>
                <p>Save your secret and default product first. Everything else depends on this step.</p>
              </div>
            </div>

          <section className="tradingview-grid">
            <article className="dashboard-module-card">
              <h2>Secret and Product</h2>
              <p className="module-subtitle">
                Save one secret and product type. TradingView can then post directly into NubraOSS.
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
                  <strong>Execution Kill Switch</strong>
                  <p className="module-subtitle">
                    Turn this off to stop all webhook order placements while still keeping request history.
                  </p>
                </div>
                <div className="kill-switch-actions">
                  <button
                    type="button"
                    className={tradingViewStatus?.execution_enabled === false ? 'secondary-button' : 'primary-button'}
                    onClick={() => handleTradingViewKillSwitch(true)}
                    disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                  >
                    Enable
                  </button>
                  <button
                    type="button"
                    className={tradingViewStatus?.execution_enabled === false ? 'primary-button' : 'secondary-button'}
                    onClick={() => handleTradingViewKillSwitch(false)}
                    disabled={!tradingViewStatus?.configured || tradingViewActionState !== null}
                  >
                    Kill Switch
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="primary-button wide-button"
                onClick={handleTradingViewConfigure}
                disabled={!session || Boolean(session?.is_demo) || tradingViewActionState !== null}
              >
                {tradingViewActionState === 'configure' ? 'Saving...' : 'Save TradingView Webhook'}
              </button>
              <button
                type="button"
                className="secondary-button wide-button"
                onClick={handleTradingViewReset}
                disabled={tradingViewActionState !== null || !tradingViewStatus?.configured}
              >
                {tradingViewActionState === 'reset' ? 'Resetting...' : 'Reset Webhook'}
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

  if (view === 'dashboard') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          {renderDashboardNav('Dashboard')}

          <section className="dashboard-header">
            <div>
              <h1>Dashboard</h1>
              <p>
                Logged in as {session?.user_name ?? 'Nubra User'} on {session?.environment ?? 'PROD'}.
              </p>
              {isSessionChecking ? <p>Checking session status...</p> : null}
            </div>
          </section>

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
                <div className={`module-badge ${card.badgeClass}`}>{card.badge}</div>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
                <span className="module-footer">{card.footer}</span>
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

          <section className="dashboard-module-card tunnel-card">
            <div className="tunnel-card-header">
              <div>
                <h2>Public Webhook URL</h2>
                <p>Start a built-in Cloudflare tunnel so TradingView can reach your local NubraOSS backend.</p>
              </div>
              <div className="tunnel-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleTunnelAction('start')}
                  disabled={!session || Boolean(session.is_demo) || tunnelAction !== null}
                >
                  {tunnelAction === 'start' ? 'Starting...' : 'Generate Public Webhook URL'}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleTunnelAction('refresh')}
                  disabled={!session || Boolean(session.is_demo) || tunnelAction !== null}
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
              </div>
            </div>

            <div className="tunnel-grid">
              <div className="tunnel-panel">
                <span className="summary-label">Webhook URL</span>
                <strong className="tunnel-url">
                  {tunnelStatus?.public_url ?? 'Not generated yet'}
                </strong>
                <small>TradingView target: {(tunnelStatus?.public_url ?? 'Generate URL') + '/api/webhooks/tradingview'}</small>
              </div>
              <div className="tunnel-panel">
                <span className="summary-label">Target</span>
                <strong>{tunnelStatus?.target_url ?? 'http://127.0.0.1:8000'}</strong>
                <small>Status: {tunnelStatus?.running ? 'Running' : 'Stopped'}</small>
              </div>
            </div>

            {tunnelStatus?.last_error ? <div className="error-banner">{tunnelStatus.last_error}</div> : null}

            <div className="tunnel-log-card">
              <span className="summary-label">Tunnel Logs</span>
              {(tunnelStatus?.logs ?? []).length === 0 ? (
                <div className="table-empty">No tunnel logs yet.</div>
              ) : (
                <div className="tunnel-log-list">
                  {(tunnelStatus?.logs ?? []).slice(-6).map((line, index) => (
                    <div key={`${index}-${line}`} className="tunnel-log-line">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>
    )
  }

  return (
    <main className="login-shell">
      <section className="login-layout">
        <section className="hero-panel">
          <div className="hero-surface">
            <div className="brand-block">
              <img src={nubraLogo} alt="Nubra" className="brand-logo hero-brand-logo" />
              <div>
                <div className="brand-name">NubraOSS</div>
                <div className="brand-caption">Personal algo trading workspace</div>
              </div>
            </div>

            <div className="hero-copy">
              <h1>
                Welcome to <span className="hero-accent">NubraOSS</span>
              </h1>
              <p>
                Sign in to your account to access your trading dashboard and manage your no-code
                and automated trading workflows.
              </p>
              <div className="hero-alert">
                <strong>First Time User?</strong>
                <span>
                  This section will later hold onboarding guidance, release notes, and product
                  help.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="login-frame">
          <div className="login-frame-inner">
            <div className="title-block">
              <h1>Sign in to Nubra</h1>
              <p>{helperText}</p>
            </div>

            <div className="demo-banner">
              <div>
                <strong>Need a safe test path?</strong>
                <span>Use demo mode to inspect the latest UI without real credentials.</span>
              </div>
              <button type="button" className="secondary-button demo-button" onClick={handleDemoLogin}>
                Enter Demo
              </button>
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

            <div className="steps-column">
              <section className="step-card">
                <div className="step-header">
                  <div className={phoneComplete ? 'status-dot complete' : 'status-dot'} />
                  <div>
                    <h2>Phone number</h2>
                    <p>Bootstrap the OTP flow from your Nubra account.</p>
                  </div>
                </div>

                <form className="step-form step-form-phone" onSubmit={handleStart}>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
                    placeholder="Enter phone number"
                    maxLength={15}
                    required
                  />
                  <button
                    className="primary-button"
                    disabled={activeAction !== null || phone.length < 10}
                    type="submit"
                  >
                    {activeAction === 'phone' ? 'Sending OTP...' : 'Send OTP'}
                  </button>
                </form>
              </section>

              <section className="step-card">
                <div className="step-header">
                  <div className={otpComplete ? 'status-dot complete' : 'status-dot'} />
                  <div>
                    <h2>OTP</h2>
                    <p>
                      {maskedPhone
                        ? `Verify the SMS OTP sent to ${maskedPhone}.`
                        : 'Enter OTP after the first step completes.'}
                    </p>
                  </div>
                </div>

                <form className="step-form step-form-inline" onSubmit={handleOtp}>
                  <input
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                    placeholder="Enter OTP"
                    maxLength={8}
                    required
                    disabled={!phoneComplete || otpComplete}
                  />
                  <button
                    className="secondary-button"
                    disabled={activeAction !== null || !phoneComplete || otp.length < 4 || otpComplete}
                    type="submit"
                  >
                    {activeAction === 'otp' ? 'Verifying OTP...' : 'Verify OTP'}
                  </button>
                </form>
              </section>

              <section className="step-card">
                <div className="step-header">
                  <div className={mpinComplete ? 'status-dot complete' : 'status-dot'} />
                  <div>
                    <h2>MPIN</h2>
                    <p>Confirm the MPIN only after OTP verification succeeds.</p>
                  </div>
                </div>

                <form className="step-form step-form-inline" onSubmit={handleMpin}>
                  <input
                    value={mpin}
                    onChange={(event) => setMpin(event.target.value.replace(/\D/g, ''))}
                    placeholder="Enter MPIN"
                    maxLength={6}
                    required
                    disabled={!otpComplete || mpinComplete}
                  />
                  <button
                    className="secondary-button"
                    disabled={activeAction !== null || !otpComplete || mpin.length < 4 || mpinComplete}
                    type="submit"
                  >
                    {activeAction === 'mpin' ? 'Confirming MPIN...' : 'Confirm MPIN'}
                  </button>
                </form>
              </section>
            </div>

            <div className="feedback-column">
              {message ? <div className="message-banner">{message}</div> : null}
              {error ? <div className="error-banner">{error}</div> : null}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}


