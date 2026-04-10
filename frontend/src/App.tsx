import { FormEvent, useMemo, useState } from 'react'

type Environment = 'PROD' | 'UAT'
type Step = 'start' | 'otp' | 'mpin' | 'success'
type View = 'login' | 'dashboard'

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

const API_BASE_URL = 'http://127.0.0.1:8000'
const dashboardTabs = [
  'Dashboard',
  'Orderbook',
  'Tradebook',
  'Positions',
  'Action Center',
  'Platforms',
  'Strategy',
  'Logs',
  'Tools',
]

const dashboardCards = [
  {
    badge: 'NC',
    badgeClass: 'badge-indigo',
    title: 'No Code Algo',
    description: 'Visual strategy builder for creating and launching rule-based trading flows.',
    footer: 'Open No Code Algo',
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

export default function App() {
  const [view, setView] = useState<View>('login')
  const [step, setStep] = useState<Step>('start')
  const [environment, setEnvironment] = useState<Environment>('PROD')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [mpin, setMpin] = useState('')
  const [flowId, setFlowId] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [message, setMessage] = useState(
    'Enter your phone number, verify the OTP, then confirm MPIN.',
  )
  const [error, setError] = useState('')
  const [activeAction, setActiveAction] = useState<'phone' | 'otp' | 'mpin' | null>(null)
  const [session, setSession] = useState<SuccessResponse | null>(null)

  const phoneComplete = flowId.length > 0
  const otpComplete = step === 'mpin' || step === 'success'
  const mpinComplete = step === 'success'
  const derivedDeviceId = phone ? `Nubra-OSS-${phone}` : 'Nubra-OSS-<phone>'

  const helperText = useMemo(() => {
    if (step === 'otp') {
      return `OTP sent to ${maskedPhone || 'your number'}.`
    }
    if (step === 'mpin') {
      return 'OTP verified. Confirm MPIN to enter the product.'
    }
    if (step === 'success') {
      return 'Authentication complete.'
    }
    return 'Enter your phone number, verify the OTP, then confirm MPIN.'
  }, [maskedPhone, step])

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

  if (view === 'dashboard') {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          <header className="dashboard-nav">
            <div className="dashboard-brand">
              <div className="brand-mark">N</div>
              <span>NubraOSS</span>
            </div>

            <nav className="dashboard-tabs" aria-label="Primary">
              {dashboardTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={tab === 'Dashboard' ? 'dashboard-tab active' : 'dashboard-tab'}
                >
                  {tab}
                </button>
              ))}
            </nav>

            <div className="dashboard-actions">
              <span className="pill">{session?.broker.toLowerCase() ?? 'nubra'}</span>
              <span className="pill pill-dark">{session?.environment === 'UAT' ? 'UAT Mode' : 'Live Mode'}</span>
              <span className="avatar-pill">{session?.user_name?.[0] ?? 'N'}</span>
            </div>
          </header>

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
              <article key={card.title} className="dashboard-module-card">
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
                    disabled={
                      activeAction !== null || !phoneComplete || otp.length < 4 || otpComplete
                    }
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
                    disabled={
                      activeAction !== null || !otpComplete || mpin.length < 4 || mpinComplete
                    }
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
