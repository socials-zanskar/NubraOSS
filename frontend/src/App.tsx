import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'

type Environment = 'PROD' | 'UAT'
type Step = 'start' | 'otp' | 'mpin' | 'success'
type View = 'login' | 'dashboard' | 'no-code'
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
  environment: Environment
  broker: 'Nubra'
  expires_in: number
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

const API_BASE_URL = 'http://127.0.0.1:8000'
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
    badge: 'TP',
    badgeClass: 'badge-blue',
    title: 'Trading Platforms',
    description: 'Connect TradingView, GoCharting, and scanner workflows for signal routing.',
    footer: 'Open Platforms',
  },
  {
    badge: 'WS',
    badgeClass: 'badge-emerald',
    title: 'Webhook Strategies',
    description: 'Manage alert-driven trading strategies and view active automation status.',
    footer: 'Open Strategies',
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

const intervals: Interval[] = ['1m', '2m', '3m', '5m', '15m', '30m', '1h']

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
  const [view, setView] = useState<View>('login')
  const [step, setStep] = useState<Step>('start')
  const [environment, setEnvironment] = useState<Environment>('PROD')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [mpin, setMpin] = useState('')
  const [flowId, setFlowId] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [message, setMessage] = useState('Enter your phone number, verify the OTP, then confirm MPIN.')
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<'phone' | 'otp' | 'mpin' | 'no-code' | 'stop' | null>(null)
  const [session, setSession] = useState<SuccessResponse | null>(null)
  const [publicIp, setPublicIp] = useState<string>('')

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
  const previousAlertCount = useRef(0)

  const phoneComplete = flowId.length > 0
  const otpComplete = step === 'mpin' || step === 'success'
  const mpinComplete = step === 'success'
  const derivedDeviceId = phone ? `Nubra-OSS-${phone}` : 'Nubra-OSS-<phone>'

  const helperText = useMemo(() => {
    if (step === 'otp') return `OTP sent to ${maskedPhone || 'your number'}.`
    if (step === 'mpin') return 'OTP verified. Confirm MPIN to enter the product.'
    if (step === 'success') return 'Authentication complete.'
    return 'Enter your phone number, verify the OTP, then confirm MPIN.'
  }, [maskedPhone, step])

  useEffect(() => {
    if (!session) {
      setPublicIp('')
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
      setMessage(result.message)
      setStep('success')
      setView('dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify MPIN.')
    } finally {
      setActiveAction(null)
    }
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

  function renderDashboardNav(activeTab: string) {
    return (
      <section className="dashboard-topbar">
        <header className="dashboard-nav">
          <div className="dashboard-brand">
            <div className="brand-mark">N</div>
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
            <span className="pill pill-dark">
              {session?.environment === 'UAT' ? 'UAT' : 'PROD'}
            </span>
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
            </div>
          </section>

          <section className="card-grid">
            {dashboardCards.map((card) => (
              <article
                key={card.title}
                className={card.key === 'no-code' ? 'dashboard-module-card is-clickable' : 'dashboard-module-card'}
                onClick={card.key === 'no-code' ? () => setView('no-code') : undefined}
                role={card.key === 'no-code' ? 'button' : undefined}
                tabIndex={card.key === 'no-code' ? 0 : undefined}
                onKeyDown={
                  card.key === 'no-code'
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          setView('no-code')
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
            <button type="button" className="secondary-button">
              View Documentation
            </button>
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
              <div className="brand-mark">N</div>
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


