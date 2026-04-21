import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import StrategyPreviewChart, { type StrategyPreviewCandlePoint } from './StrategyPreviewChart'

type Environment = 'PROD' | 'UAT'
type Interval = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1mt'
type OperandCategory = 'price_level' | 'oscillator_bounded' | 'oscillator_unbounded' | 'volume_level'
type OperatorId =
  | 'greater_than'
  | 'less_than'
  | 'greater_equal'
  | 'less_equal'
  | 'equal'
  | 'crosses_above'
  | 'crosses_below'
  | 'up_by'
  | 'down_by'
  | 'within_range'

type ParamKind = 'int' | 'float' | 'source' | 'enum' | 'output'

interface CatalogParam {
  key: string
  label: string
  kind: ParamKind
  default: number | string
  min_value: number | null
  max_value: number | null
  choices: string[]
}

interface CatalogIndicator {
  type: string
  label: string
  category: OperandCategory
  has_source: boolean
  multi_output: boolean
  outputs: string[]
  default_output: string | null
  params: CatalogParam[]
}

interface CatalogOperator {
  id: OperatorId
  label: string
}

interface Catalog {
  indicators: CatalogIndicator[]
  operators: CatalogOperator[]
  rhs_rules: Record<OperandCategory, { default_kind: 'number' | 'indicator'; allow_number: boolean; indicator_categories: OperandCategory[] }>
  delta_operators: OperatorId[]
  range_operators: OperatorId[]
  comparison_operators: OperatorId[]
}

interface IndicatorExprState {
  type: string
  params: Record<string, number | string>
  output?: string | null
  offset: number
}

type RhsKind = 'number' | 'indicator' | 'range'

interface ConditionState {
  kind: 'condition'
  id: string
  lhs: IndicatorExprState
  operator: OperatorId
  rhsKind: RhsKind
  rhsIndicator?: IndicatorExprState
  rhsNumber?: string
  rhsLow?: string
  rhsHigh?: string
}

interface ConditionGroupState {
  kind: 'group'
  id: string
  logic: 'AND' | 'OR'
  items: StrategyNodeState[]
}

type StrategyNodeState = ConditionState | ConditionGroupState

interface StockSearchItem {
  instrument: string
  display_name: string
  exchange: string
  ref_id: number
  tick_size: number
  lot_size: number
}

interface StrategyPreviewChartPanel {
  instrument: string
  exchange: string
  instrument_type: string
  interval: string
  last_price: number | null
  candles: StrategyPreviewCandlePoint[]
}

interface StrategyPreviewResponse {
  status: 'success'
  chart: StrategyPreviewChartPanel
}

// ---- New response types matching the new engine output ----

interface StrategyEquityPoint {
  timestamp: string
  equity: number
}

interface StrategyTrade {
  symbol: string
  side: 'BUY' | 'SELL'
  entry_timestamp: string
  exit_timestamp: string
  entry_price: number
  exit_price: number
  quantity: number
  pnl: number
  pnl_pct: number
  bars_held: number
  exit_reason: string
  brokerage: number
}

interface StrategyDailySignalLogRow {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  entry_signal: boolean
  exit_signal: boolean
  action: string
  position_state: string
  stop_loss_price: number | null
  target_price: number | null
}

interface StrategyInstrumentMetrics {
  starting_capital: number
  ending_capital: number
  gross_profit: number
  gross_loss: number
  net_pnl: number
  return_pct: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate_pct: number
  avg_pnl: number
  avg_pnl_pct: number
  profit_factor: number | null
  max_drawdown_pct: number
  total_brokerage: number
}

interface StrategyInstrumentResult {
  symbol: string
  bars_processed: number
  metrics: StrategyInstrumentMetrics
  trades: StrategyTrade[]
  equity_curve: StrategyEquityPoint[]
  triggered_days: StrategyDailySignalLogRow[]
  daily_signal_log: StrategyDailySignalLogRow[]
  warning: string | null
}

interface StrategyPortfolioMetrics {
  starting_capital: number
  ending_capital: number
  gross_profit: number
  gross_loss: number
  net_pnl: number
  return_pct: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate_pct: number
  profit_factor: number | null
  max_drawdown_pct: number
  capital_per_instrument: number
  total_brokerage: number
  equity_curve: StrategyEquityPoint[]
}

interface StrategyBacktestResponse {
  status: 'success'
  mode: string
  strategy_summary: Record<string, unknown>
  portfolio: StrategyPortfolioMetrics
  instruments: StrategyInstrumentResult[]
}

interface StrategyLiveAlert {
  id: string
  instrument: string
  event: string
  candle_time_ist: string
  triggered_at_ist: string
  price: number
  detail: string
}

interface StrategyLiveStatus {
  running: boolean
  instruments: string[]
  interval: Interval | null
  entry_side: 'BUY' | 'SELL' | null
  market_status: string
  last_run_ist: string | null
  next_run_ist: string | null
  last_signal: string | null
  last_error: string | null
  alerts: StrategyLiveAlert[]
}

interface Props {
  apiBaseUrl: string
  sessionToken: string
  deviceId: string
  environment: Environment
  onBack: () => void
}

const INTERVAL_CHOICES: Interval[] = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w', '1mt']

function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function isConditionGroup(node: StrategyNodeState): node is ConditionGroupState {
  return node.kind === 'group'
}

function createConditionGroup(logic: 'AND' | 'OR', items: StrategyNodeState[] = []): ConditionGroupState {
  return {
    kind: 'group',
    id: uid(),
    logic,
    items,
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['detail', 'message', 'error']) {
      const val = record[key]
      if (typeof val === 'string' && val.trim()) return val
    }
  }
  return fallback
}

function defaultIndicatorExpr(
  spec: CatalogIndicator,
  options?: {
    params?: Record<string, number | string>
    output?: string | null
    offset?: number
  },
): IndicatorExprState {
  const params: Record<string, number | string> = {}
  for (const p of spec.params) {
    if (p.key === 'offset') continue
    params[p.key] = options?.params?.[p.key] ?? p.default
  }
  return {
    type: spec.type,
    params,
    output: spec.multi_output ? (options?.output ?? spec.default_output) : null,
    offset: options?.offset ?? 0,
  }
}

function formatIndicatorExpr(expr: IndicatorExprState, spec: CatalogIndicator | undefined): string {
  if (!spec) return expr.type
  const parts: string[] = []
  for (const p of spec.params) {
    if (p.key === 'offset') continue
    parts.push(String(expr.params[p.key] ?? p.default))
  }
  parts.push(String(expr.offset))
  const outputSuffix = spec.multi_output && expr.output ? `[${expr.output}]` : ''
  return `${spec.label}(${parts.join(', ')})${outputSuffix}`
}

function isVolumeFamilyExpr(expr: IndicatorExprState): boolean {
  const type = expr.type.toUpperCase()
  const source = String(expr.params.source ?? 'close').toLowerCase()
  return type === 'VOLUME' || type === 'OBV' || (['SMA', 'EMA', 'WMA'].includes(type) && source === 'volume')
}

function rhsRuleForExpr(expr: IndicatorExprState): {
  defaultKind: 'number' | 'indicator'
  allowNumber: boolean
  indicatorTypes: string[]
} {
  const type = expr.type.toUpperCase()
  const output = String(expr.output ?? '')

  if (type === 'RSI' || type === 'CCI' || type === 'ATR') {
    return { defaultKind: 'number', allowNumber: true, indicatorTypes: [] }
  }
  if (type === 'MACD') {
    return {
      defaultKind: output === 'histogram' ? 'number' : 'indicator',
      allowNumber: true,
      indicatorTypes: ['MACD'],
    }
  }
  if (type === 'STOCH') {
    return { defaultKind: 'indicator', allowNumber: true, indicatorTypes: ['STOCH'] }
  }
  if (type === 'ADX') {
    if (output === 'plus_di' || output === 'minus_di') {
      return { defaultKind: 'indicator', allowNumber: true, indicatorTypes: ['ADX'] }
    }
    return { defaultKind: 'number', allowNumber: true, indicatorTypes: [] }
  }
  if (isVolumeFamilyExpr(expr)) {
    return {
      defaultKind: 'indicator',
      allowNumber: true,
      indicatorTypes: ['VOLUME', 'OBV', 'SMA', 'EMA', 'WMA'],
    }
  }
  return {
    defaultKind: 'indicator',
    allowNumber: true,
    indicatorTypes: ['PRICE', 'SMA', 'EMA', 'WMA', 'VWAP', 'BB', 'PSAR'],
  }
}

function defaultOperatorForExpr(expr: IndicatorExprState): OperatorId {
  const type = expr.type.toUpperCase()
  if (type === 'CCI' || type === 'ATR') return 'greater_than'
  return 'crosses_above'
}

function alternatePeriod(value: number | string | undefined, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric === 9) return 21
  if (numeric === 21) return 9
  return numeric < 21 ? 21 : 9
}

function buildDefaultRhsIndicator(
  lhs: IndicatorExprState,
  indicatorByType: Map<string, CatalogIndicator>,
): IndicatorExprState | undefined {
  const type = lhs.type.toUpperCase()
  const source = String(lhs.params.source ?? 'close').toLowerCase()

  if (type === 'MACD') {
    const spec = indicatorByType.get('MACD')
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: { ...lhs.params },
      output: lhs.output === 'signal_line' ? 'macd_line' : 'signal_line',
    })
  }

  if (type === 'STOCH') {
    const spec = indicatorByType.get('STOCH')
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: { ...lhs.params },
      output: lhs.output === 'd_line' ? 'k_line' : 'd_line',
    })
  }

  if (type === 'ADX') {
    if (lhs.output !== 'plus_di' && lhs.output !== 'minus_di') return undefined
    const spec = indicatorByType.get('ADX')
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: { ...lhs.params },
      output: lhs.output === 'plus_di' ? 'minus_di' : 'plus_di',
    })
  }

  if (type === 'SMA' || type === 'EMA' || type === 'WMA') {
    const spec = indicatorByType.get(type)
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: {
        ...lhs.params,
        source,
        period: alternatePeriod(lhs.params.period, 21),
      },
    })
  }

  if (type === 'VOLUME' || type === 'OBV' || isVolumeFamilyExpr(lhs)) {
    const spec = indicatorByType.get('SMA')
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: {
        source: 'volume',
        period: 20,
      },
    })
  }

  if (type === 'PRICE') {
    const spec = indicatorByType.get('SMA')
    if (!spec) return undefined
    return defaultIndicatorExpr(spec, {
      params: {
        source,
        period: 20,
      },
    })
  }

  const priceSpec = indicatorByType.get('PRICE')
  if (!priceSpec) return undefined
  return defaultIndicatorExpr(priceSpec, { params: { source: 'close' } })
}

function buildRhsIndicatorForType(
  rhsType: string,
  lhs: IndicatorExprState,
  indicatorByType: Map<string, CatalogIndicator>,
): IndicatorExprState | undefined {
  const spec = indicatorByType.get(rhsType)
  if (!spec) return undefined
  const source = String(lhs.params.source ?? 'close').toLowerCase()

  if (['SMA', 'EMA', 'WMA'].includes(rhsType) && isVolumeFamilyExpr(lhs)) {
    return defaultIndicatorExpr(spec, {
      params: {
        source: 'volume',
        period: rhsType === lhs.type ? alternatePeriod(lhs.params.period, 20) : 20,
      },
    })
  }

  if (['SMA', 'EMA', 'WMA'].includes(rhsType)) {
    return defaultIndicatorExpr(spec, {
      params: {
        source,
        period: rhsType === lhs.type ? alternatePeriod(lhs.params.period, 21) : 20,
      },
    })
  }

  if (rhsType === 'MACD' && lhs.type.toUpperCase() === 'MACD') {
    return buildDefaultRhsIndicator(lhs, indicatorByType)
  }
  if (rhsType === 'STOCH' && lhs.type.toUpperCase() === 'STOCH') {
    return buildDefaultRhsIndicator(lhs, indicatorByType)
  }
  if (rhsType === 'ADX' && lhs.type.toUpperCase() === 'ADX') {
    return buildDefaultRhsIndicator(lhs, indicatorByType)
  }

  if (rhsType === 'PRICE') {
    return defaultIndicatorExpr(spec, {
      params: {
        source: isVolumeFamilyExpr(lhs) ? 'close' : source,
      },
    })
  }

  return defaultIndicatorExpr(spec)
}

function rhsRestrictionsForExpr(
  lhs: IndicatorExprState,
  rhs: IndicatorExprState,
): {
  sourceChoices?: string[]
  outputChoices?: string[]
} {
  if (['SMA', 'EMA', 'WMA'].includes(rhs.type)) {
    if (isVolumeFamilyExpr(lhs)) {
      return { sourceChoices: ['volume'] }
    }
    return { sourceChoices: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'] }
  }

  if (rhs.type === 'ADX' && lhs.type === 'ADX' && (lhs.output === 'plus_di' || lhs.output === 'minus_di')) {
    return { outputChoices: ['plus_di', 'minus_di'] }
  }

  return {}
}

// ---- Equity curve SVG ----

function EquityCurveChart({ points }: { points: StrategyEquityPoint[] }) {
  if (points.length < 2) {
    return <div className="conditions-empty">Not enough data points for equity chart.</div>
  }

  const equities = points.map((p) => p.equity)
  const minEq = Math.min(...equities)
  const maxEq = Math.max(...equities)
  const range = maxEq - minEq || 1
  const W = 600
  const H = 120

  const polyPoints = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W
      const y = H - ((p.equity - minEq) / range) * (H - 4) - 2
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const isPositive = equities[equities.length - 1] >= equities[0]
  const strokeColor = isPositive ? 'var(--color-success, #22c55e)' : 'var(--color-error, #ef4444)'
  const fillColor = isPositive ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'

  // build a closed fill path
  const firstX = 0
  const lastX = W
  const fillPath = `M${firstX},${H} L${polyPoints.split(' ').join(' L')} L${lastX},${H} Z`

  const formatK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))

  return (
    <div className="equity-chart-wrap">
      <div className="equity-chart-labels-top">
        <span className="eq-label-start">₹{formatK(equities[0])}</span>
        <span className={`eq-label-end ${isPositive ? 'pnl-pos' : 'pnl-neg'}`}>
          ₹{formatK(equities[equities.length - 1])}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="equity-chart-svg" preserveAspectRatio="none">
        <path d={fillPath} fill={fillColor} />
        <polyline points={polyPoints} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="equity-chart-labels-bottom">
        <span>₹{formatK(minEq)}</span>
        <span>{points.length} pts</span>
        <span>₹{formatK(maxEq)}</span>
      </div>
    </div>
  )
}

// ---- Main component ----

export default function StrategyBuilder({
  apiBaseUrl,
  sessionToken,
  deviceId,
  environment,
  onBack,
}: Props) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState('')

  const [instruments, setInstruments] = useState<string[]>([])
  const [instrumentQuery, setInstrumentQuery] = useState('')
  const [stockSuggestions, setStockSuggestions] = useState<StockSearchItem[]>([])
  const [intervalValue, setIntervalValue] = useState<Interval>('1d')
  const [strategyName, setStrategyName] = useState('')

  const [entrySide, setEntrySide] = useState<'BUY' | 'SELL'>('BUY')
  const [entryGroup, setEntryGroup] = useState<ConditionGroupState | null>(null)

  type ExitMode = 'condition' | 'sl_tgt' | 'both'
  const [exitMode, setExitMode] = useState<ExitMode>('condition')
  const [exitGroup, setExitGroup] = useState<ConditionGroupState | null>(null)
  const [stopLossPct, setStopLossPct] = useState('2')
  const [targetPct, setTargetPct] = useState('4')

  const today = new Date()
  const threeMonthsAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  const [initialCapital, setInitialCapital] = useState('100000')
  const [startDate, setStartDate] = useState(threeMonthsAgo.toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState('09:30')
  const [endTime, setEndTime] = useState('15:15')
  const [holdingType, setHoldingType] = useState<'intraday' | 'positional'>('positional')
  const [exchange, setExchange] = useState('NSE')
  const [instrumentType, setInstrumentType] = useState('STOCK')
  const [executionStyle, setExecutionStyle] = useState<'same_bar_close' | 'next_bar_open'>('same_bar_close')
  const [stopTargetConflict, setStopTargetConflict] = useState<'stop' | 'target'>('stop')
  const [brokerageEnabled, setBrokerageEnabled] = useState(false)
  const [brokeragePct, setBrokeragePct] = useState('0.03')
  const [brokerageFlat, setBrokerageFlat] = useState('20')

  const [backtestRunning, setBacktestRunning] = useState(false)
  const [backtestResult, setBacktestResult] = useState<StrategyBacktestResponse | null>(null)
  const [backtestError, setBacktestError] = useState('')
  const [backtestInstrument, setBacktestInstrument] = useState('')
  const [showFullLog, setShowFullLog] = useState(false)
  const [previewChart, setPreviewChart] = useState<StrategyPreviewChartPanel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const [liveStatus, setLiveStatus] = useState<StrategyLiveStatus | null>(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState('')
  const [defaultsSeeded, setDefaultsSeeded] = useState({ entry: false, exit: false })
  const primaryInstrument = instruments[0] ?? ''

  const indicatorByType = useMemo(() => {
    const map = new Map<string, CatalogIndicator>()
    catalog?.indicators.forEach((ind) => map.set(ind.type, ind))
    return map
  }, [catalog])

  // Fetch catalog
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/strategy/catalog`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(extractErrorMessage(data, 'Unable to load indicator catalog.'))
        }
        if (!cancelled) setCatalog(data as Catalog)
      } catch (err) {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Unable to load indicator catalog.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiBaseUrl])

  // Instrument search
  useEffect(() => {
    if (!sessionToken || instrumentQuery.trim().length < 1) {
      setStockSuggestions([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/instruments/stocks/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: sessionToken,
            device_id: deviceId,
            environment,
            query: instrumentQuery,
            limit: 8,
          }),
          signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) return
        setStockSuggestions((data as { items: StockSearchItem[] }).items)
      } catch {
        // ignore
      }
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [apiBaseUrl, sessionToken, deviceId, environment, instrumentQuery])

  useEffect(() => {
    if (!sessionToken || !deviceId || !primaryInstrument) {
      setPreviewChart(null)
      setPreviewError('')
      setPreviewLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError('')
      try {
        const response = await fetch(`${apiBaseUrl}/api/strategy/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: sessionToken,
            device_id: deviceId,
            environment,
            symbol: primaryInstrument,
            exchange,
            instrument_type: instrumentType,
            interval: intervalValue,
            bars: 180,
          }),
          signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) {
          throw new Error(extractErrorMessage(data, 'Unable to load chart preview.'))
        }
        if (!controller.signal.aborted) {
          setPreviewChart((data as StrategyPreviewResponse).chart)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setPreviewChart(null)
        setPreviewError(err instanceof Error ? err.message : 'Unable to load chart preview.')
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false)
        }
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [apiBaseUrl, sessionToken, deviceId, environment, primaryInstrument, exchange, instrumentType, intervalValue])

  // Live status poll
  useEffect(() => {
    let cancelled = false
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/strategy/live/status`)
        const data = await response.json()
        if (!cancelled && response.ok) setLiveStatus(data as StrategyLiveStatus)
      } catch {
        // ignore
      }
    }
    fetchStatus()
    const id = window.setInterval(fetchStatus, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [apiBaseUrl])

  const addInstrument = useCallback(() => {
    const trimmed = instrumentQuery.trim().toUpperCase()
    if (!trimmed) return
    setInstruments((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setInstrumentQuery('')
    setStockSuggestions([])
  }, [instrumentQuery])

  const removeInstrument = (symbol: string) => {
    setInstruments((prev) => prev.filter((item) => item !== symbol))
  }

  const makeDefaultCondition = useCallback(
    (category: OperandCategory): ConditionState | null => {
      if (!catalog) return null
      const lhsSpec =
        catalog.indicators.find((ind) => ind.category === category) ??
        catalog.indicators.find((ind) => ind.type === 'RSI') ??
        catalog.indicators[0]
      if (!lhsSpec) return null

      const lhs = defaultIndicatorExpr(lhsSpec)
      const rhsRule = rhsRuleForExpr(lhs)
      const rhsKind: RhsKind = rhsRule.defaultKind === 'indicator' ? 'indicator' : 'number'
      const rhsIndicator = rhsKind === 'indicator' ? buildDefaultRhsIndicator(lhs, indicatorByType) : undefined
      const operator = defaultOperatorForExpr(lhs)
      return {
        kind: 'condition',
        id: uid(),
        lhs,
        operator,
        rhsKind,
        rhsIndicator,
        rhsNumber: '30',
        rhsLow: '30',
        rhsHigh: '70',
      }
    },
    [catalog, indicatorByType],
  )

  const makeSeedGroup = useCallback(
    (logic: 'AND' | 'OR' = 'AND') => {
      const cond = makeDefaultCondition('oscillator_bounded')
      return createConditionGroup(logic, cond ? [cond] : [])
    },
    [makeDefaultCondition],
  )

  function countConditions(group: ConditionGroupState | null): number {
    if (!group) return 0
    return group.items.reduce((sum, item) => sum + (isConditionGroup(item) ? countConditions(item) : 1), 0)
  }

  function groupDepth(group: ConditionGroupState | null): number {
    if (!group) return 0
    const childDepths = group.items.filter(isConditionGroup).map(groupDepth)
    return 1 + (childDepths.length > 0 ? Math.max(...childDepths) : 0)
  }

  function updateGroupNode(
    group: ConditionGroupState,
    targetId: string,
    updater: (current: ConditionGroupState) => ConditionGroupState,
  ): ConditionGroupState {
    if (group.id === targetId) return updater(group)
    return {
      ...group,
      items: group.items.map((item) => (isConditionGroup(item) ? updateGroupNode(item, targetId, updater) : item)),
    }
  }

  function updateConditionNode(
    group: ConditionGroupState,
    targetId: string,
    updater: (current: ConditionState) => ConditionState,
  ): ConditionGroupState {
    return {
      ...group,
      items: group.items.map((item) => {
        if (isConditionGroup(item)) return updateConditionNode(item, targetId, updater)
        return item.id === targetId ? updater(item) : item
      }),
    }
  }

  function appendNodeToGroup(
    group: ConditionGroupState,
    targetId: string,
    node: StrategyNodeState,
  ): ConditionGroupState {
    return updateGroupNode(group, targetId, (current) => ({ ...current, items: [...current.items, node] }))
  }

  function removeNodeFromGroup(group: ConditionGroupState, targetId: string): ConditionGroupState {
    return {
      ...group,
      items: group.items
        .filter((item) => item.id !== targetId)
        .map((item) => (isConditionGroup(item) ? removeNodeFromGroup(item, targetId) : item)),
    }
  }

  useEffect(() => {
    if (!catalog || defaultsSeeded.entry || entryGroup) return
    const group = makeSeedGroup('AND')
    if (group.items.length > 0) {
      setEntryGroup(group)
      setDefaultsSeeded((prev) => ({ ...prev, entry: true }))
    }
  }, [catalog, defaultsSeeded.entry, entryGroup, makeSeedGroup])

  useEffect(() => {
    if (!catalog || defaultsSeeded.exit || exitMode === 'sl_tgt' || exitGroup) return
    const group = makeSeedGroup('OR')
    if (group.items.length > 0) {
      setExitGroup(group)
      setDefaultsSeeded((prev) => ({ ...prev, exit: true }))
    }
  }, [catalog, defaultsSeeded.exit, exitGroup, exitMode, makeSeedGroup])

  const addEntryCondition = useCallback(
    (groupId: string) => {
      const cond = makeDefaultCondition('oscillator_bounded')
      if (!cond) return
      setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, groupId, cond) : createConditionGroup('AND', [cond])))
    },
    [makeDefaultCondition],
  )

  const addExitCondition = useCallback(
    (groupId: string) => {
      const cond = makeDefaultCondition('oscillator_bounded')
      if (!cond) return
      setExitGroup((prev) => (prev ? appendNodeToGroup(prev, groupId, cond) : createConditionGroup('OR', [cond])))
    },
    [makeDefaultCondition],
  )

  const addEntryGroup = useCallback(
    (groupId: string) => {
      const nested = createConditionGroup('AND', [])
      const cond = makeDefaultCondition('oscillator_bounded')
      if (cond) nested.items.push(cond)
      setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, groupId, nested) : nested))
    },
    [makeDefaultCondition],
  )

  const addExitGroup = useCallback(
    (groupId: string) => {
      const nested = createConditionGroup('OR', [])
      const cond = makeDefaultCondition('oscillator_bounded')
      if (cond) nested.items.push(cond)
      setExitGroup((prev) => (prev ? appendNodeToGroup(prev, groupId, nested) : nested))
    },
    [makeDefaultCondition],
  )

  const updateEntryCondition = (id: string, next: ConditionState) => {
    setEntryGroup((prev) => (prev ? updateConditionNode(prev, id, () => next) : prev))
  }
  const removeEntryNode = (id: string) => {
    setEntryGroup((prev) => (prev ? removeNodeFromGroup(prev, id) : prev))
  }
  const setEntryGroupLogic = (id: string, logic: 'AND' | 'OR') => {
    setEntryGroup((prev) => (prev ? updateGroupNode(prev, id, (current) => ({ ...current, logic })) : prev))
  }

  const updateExitCondition = (id: string, next: ConditionState) => {
    setExitGroup((prev) => (prev ? updateConditionNode(prev, id, () => next) : prev))
  }
  const removeExitNode = (id: string) => {
    setExitGroup((prev) => (prev ? removeNodeFromGroup(prev, id) : prev))
  }
  const setExitGroupLogic = (id: string, logic: 'AND' | 'OR') => {
    setExitGroup((prev) => (prev ? updateGroupNode(prev, id, (current) => ({ ...current, logic })) : prev))
  }

  function validateStrategy(): string | null {
    if (instruments.length === 0) return 'Add at least one instrument.'
    if (countConditions(entryGroup) === 0) return 'Add at least one entry condition.'
    if ((exitMode === 'condition' || exitMode === 'both') && countConditions(exitGroup) === 0) {
      return 'Add at least one exit condition for the selected exit mode.'
    }
    if (exitMode !== 'condition') {
      const hasStop = Number(stopLossPct) > 0
      const hasTarget = Number(targetPct) > 0
      if (!hasStop && !hasTarget) return 'Enter a stop-loss or target percentage.'
    }
    if (startDate > endDate) return 'Start date must be on or before end date.'
    if (holdingType === 'intraday' && ['1d', '1w', '1mt'].includes(intervalValue)) {
      return 'Choose an intraday chart interval when holding type is intraday.'
    }
    if (holdingType === 'intraday' && startTime >= endTime) return 'Start time must be earlier than end time.'
    return null
  }

  function serializeCondition(cond: ConditionState): object {
    const lhsPayload = {
      type: cond.lhs.type,
      params: { ...cond.lhs.params },
      output: cond.lhs.output ?? null,
      offset: cond.lhs.offset,
    }
    let rhs: unknown
    if (cond.rhsKind === 'number') {
      rhs = Number(cond.rhsNumber ?? '0')
    } else if (cond.rhsKind === 'range') {
      rhs = { low: Number(cond.rhsLow ?? '0'), high: Number(cond.rhsHigh ?? '0') }
    } else if (cond.rhsIndicator) {
      rhs = {
        type: cond.rhsIndicator.type,
        params: { ...cond.rhsIndicator.params },
        output: cond.rhsIndicator.output ?? null,
        offset: cond.rhsIndicator.offset,
      }
    } else {
      rhs = 0
    }
    return { lhs: lhsPayload, op: cond.operator, rhs }
  }

  function serializeNode(node: StrategyNodeState): object {
    if (isConditionGroup(node)) return buildConditionGroup(node)
    return serializeCondition(node)
  }

  function buildConditionGroup(group: ConditionGroupState): object {
    return {
      logic: group.logic,
      items: group.items.map(serializeNode),
    }
  }

  function buildStrategyPayload(): object {
    const costConfig = brokerageEnabled
      ? {
          intraday_brokerage_pct: Number(brokeragePct) || 0.03,
          intraday_brokerage_flat: Number(brokerageFlat) || 20.0,
          delivery_brokerage_pct: 0.0,
          delivery_brokerage_flat: 0.0,
        }
      : null
    const executePayload: Record<string, unknown> = {
      initial_capital: Number(initialCapital || 0),
      start_date: startDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      holding_type: holdingType,
      exchange,
      instrument_type: instrumentType,
      execution_style: executionStyle,
      stop_target_conflict: stopTargetConflict,
    }
    if (costConfig) executePayload.cost_config = costConfig

    const exitPayload: Record<string, unknown> = { mode: exitMode }
    if (exitMode !== 'condition') {
      const sl = Number(stopLossPct || 0)
      const tgt = Number(targetPct || 0)
      if (sl > 0) exitPayload.stop_loss_pct = sl
      if (tgt > 0) exitPayload.target_pct = tgt
    }
    if (exitMode !== 'sl_tgt' && exitGroup && countConditions(exitGroup) > 0) {
      exitPayload.conditions = buildConditionGroup(exitGroup)
    }

    return {
      instruments,
      chart: {
        type: 'Candlestick',
        interval: intervalValue,
      },
      entry: {
        side: entrySide,
        conditions: buildConditionGroup(entryGroup ?? createConditionGroup('AND', [])),
      },
      exit: exitPayload,
      execute: executePayload,
    }
  }

  async function handleRunBacktest(event: FormEvent) {
    event.preventDefault()
    setBacktestError('')
    const validationError = validateStrategy()
    if (validationError) {
      setBacktestError(validationError)
      return
    }
    setBacktestRunning(true)
    setBacktestResult(null)
    try {
      const response = await fetch(`${apiBaseUrl}/api/strategy/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: sessionToken,
          device_id: deviceId,
          environment,
          strategy: buildStrategyPayload(),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Backtest failed.'))
      }
      const result = data as StrategyBacktestResponse
      setBacktestResult(result)
      setBacktestInstrument(result.instruments[0]?.symbol ?? '')
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed.')
    } finally {
      setBacktestRunning(false)
    }
  }

  async function handleDeployLive() {
    setLiveError('')
    const validationError = validateStrategy()
    if (validationError) {
      setLiveError(validationError)
      return
    }
    setLiveBusy(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/strategy/live/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: sessionToken,
          device_id: deviceId,
          environment,
          strategy: buildStrategyPayload(),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Unable to deploy strategy live.'))
      }
      setLiveStatus(data.job as StrategyLiveStatus)
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Unable to deploy strategy live.')
    } finally {
      setLiveBusy(false)
    }
  }

  async function handleStopLive() {
    setLiveBusy(true)
    try {
      await fetch(`${apiBaseUrl}/api/strategy/live/stop`, { method: 'POST' })
      setLiveStatus(null)
    } catch {
      // ignore
    } finally {
      setLiveBusy(false)
    }
  }

  if (catalogError) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          <button type="button" className="back-link" onClick={onBack}>
            {'< Back to Dashboard'}
          </button>
          <section className="error-banner dashboard-error">{catalogError}</section>
        </section>
      </main>
    )
  }

  if (!catalog) {
    return (
      <main className="dashboard-shell">
        <section className="dashboard-panel">
          <section className="dashboard-header no-code-header">
            <div>
              <button type="button" className="back-link" onClick={onBack}>
                {'< Back to Dashboard'}
              </button>
              <h1>No Code Algo</h1>
              <p>Loading indicator catalog...</p>
            </div>
          </section>
        </section>
      </main>
    )
  }

  const selectedInstrumentResult = backtestResult?.instruments.find((item) => item.symbol === backtestInstrument)
  const entryConditionCount = countConditions(entryGroup)
  const exitConditionCount = countConditions(exitGroup)
  const entryDepth = groupDepth(entryGroup)
  const exitDepth = groupDepth(exitGroup)
  const isIntradayChart = !['1d', '1w', '1mt'].includes(intervalValue)

  return (
    <main className="dashboard-shell strategy-builder-workspace">
      <section className="dashboard-panel strategy-builder-panel">
        <section className="dashboard-header no-code-header strategy-builder-header">
          <div>
            <button type="button" className="back-link" onClick={onBack}>
              {'< Back to Dashboard'}
            </button>
            <h1>No Code Algo</h1>
            <p>Build, backtest, and deploy rule-based strategies.</p>
          </div>
          <div className="header-actions">
            {liveStatus?.running ? (
              <button type="button" className="secondary-button" onClick={handleStopLive} disabled={liveBusy}>
                {liveBusy ? 'Stopping...' : 'Stop Live'}
              </button>
            ) : null}
          </div>
        </section>

        <div className="builder-summary-row">
          <span className="pill-v2 pill-accent">{entryConditionCount + exitConditionCount} rules</span>
          <span className="pill-v2">
            {instruments.length} instrument{instruments.length === 1 ? '' : 's'}
          </span>
          <span className="pill-v2">{holdingType === 'intraday' ? `${startTime} - ${endTime} intraday` : 'Positional session'}</span>
        </div>

        <form className="strategy-builder strategy-wire-builder" onSubmit={handleRunBacktest}>
          <div className="strategy-wire-shell">
            <div className="strategy-wire-left">
          <article className="builder-paper">
            <div className="builder-paper-head">
              <span className="builder-paper-num">1</span>
              <div className="builder-paper-head-copy">
                <h2>Instrument &amp; Chart Settings</h2>
                <span>Choose what to preview and backtest.</span>
              </div>
            </div>

            <div className="builder-field-stack">
              <div className="builder-field">
                <span className="builder-paper-label">Instruments</span>
                <div className="builder-instrument-input">
                  {instruments.map((symbol) => (
                    <span key={symbol} className="builder-chip builder-chip-ticker">
                      {symbol}
                      <button type="button" onClick={() => removeInstrument(symbol)}>x</button>
                    </span>
                  ))}
                  <input
                    list="strategy-stock-suggestions"
                    placeholder="Search and add ticker..."
                    value={instrumentQuery}
                    onChange={(e) => setInstrumentQuery(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addInstrument()
                      }
                    }}
                  />
                  <button type="button" className="builder-outline-btn" onClick={addInstrument}>
                    Add
                  </button>
                  <datalist id="strategy-stock-suggestions">
                    {stockSuggestions.map((item) => (
                      <option key={`${item.exchange}-${item.ref_id}`} value={item.instrument}>
                        {item.display_name} ({item.exchange})
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="builder-inline-grid">
                <label className="builder-field">
                  <span className="builder-paper-label">Chart Type</span>
                  <select className="builder-sketch-select" value="Candlestick" disabled>
                    <option>Candlestick</option>
                  </select>
                </label>
                <label className="builder-field">
                  <span className="builder-paper-label">Timeframe</span>
                  <select className="builder-sketch-select" value={intervalValue} onChange={(e) => setIntervalValue(e.target.value as Interval)}>
                    {INTERVAL_CHOICES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="builder-field">
                  <span className="builder-paper-label">Session</span>
                  <select className="builder-sketch-select" value={holdingType} onChange={(e) => setHoldingType(e.target.value as 'intraday' | 'positional')}>
                    <option value="positional">Regular hours</option>
                    <option value="intraday">Intraday only</option>
                  </select>
                </label>
              </div>

              <div className="builder-status-note">
                <span>Chart JSON: Candlestick / {intervalValue}</span>
                <span>{holdingType === 'intraday' ? (isIntradayChart ? 'Intraday session active' : 'Choose an intraday interval') : 'Swing or positional allowed'}</span>
              </div>
            </div>
          </article>

          <article className="builder-paper">
            <div className="builder-paper-head">
              <span className="builder-paper-num">2</span>
              <div className="builder-paper-head-copy">
                <h2>Entry Conditions</h2>
                <span>Define the setup that opens a position.</span>
              </div>
            </div>

            <div className="builder-entry-toolbar">
              <div className="builder-paper-label">Side</div>
              <div className="builder-radio-row">
                <button
                  type="button"
                  className={entrySide === 'BUY' ? 'builder-radio is-buy active' : 'builder-radio is-buy'}
                  onClick={() => setEntrySide('BUY')}
                >
                  <span className="dot" />
                  BUY (long)
                </button>
                <button
                  type="button"
                  className={entrySide === 'SELL' ? 'builder-radio is-sell active' : 'builder-radio is-sell'}
                  onClick={() => setEntrySide('SELL')}
                >
                  <span className="dot" />
                  SELL (short)
                </button>
              </div>
              <div className="builder-tree-meta">
                {entryConditionCount} rules - depth {entryDepth}
              </div>
            </div>

            {entryGroup ? (
              <ConditionGroupEditor
                catalog={catalog}
                indicatorByType={indicatorByType}
                group={entryGroup}
                depth={0}
                allowRemove={false}
                onLogicChange={setEntryGroupLogic}
                onAddCondition={addEntryCondition}
                onAddGroup={addEntryGroup}
                onUpdateCondition={updateEntryCondition}
                onRemoveNode={removeEntryNode}
              />
            ) : (
              <div className="conditions-empty">Loading entry builder...</div>
            )}
          </article>

          <article className="builder-paper">
            <div className="builder-paper-head">
              <span className="builder-paper-num">3</span>
              <div className="builder-paper-head-copy">
                <h2>Exit Conditions</h2>
                <span>Control how positions get closed.</span>
              </div>
            </div>

            <div className="builder-mode-chips">
              {(['condition', 'sl_tgt', 'both'] as ExitMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={exitMode === mode ? 'builder-chip builder-chip-mode active' : 'builder-chip builder-chip-mode'}
                  onClick={() => setExitMode(mode)}
                >
                  {mode === 'condition' ? 'Condition only' : mode === 'sl_tgt' ? 'SL / Target' : 'Both'}
                </button>
              ))}
            </div>

            {exitMode !== 'condition' ? (
              <div className="builder-inline-grid">
                <label className="builder-field">
                  <span className="builder-paper-label">Stop Loss %</span>
                  <input
                    className="builder-sketch-input"
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="4.0"
                  />
                  <span className="builder-field-hint">exit if position loses at least this much</span>
                </label>
                <label className="builder-field">
                  <span className="builder-paper-label">Target Profit %</span>
                  <input
                    className="builder-sketch-input"
                    value={targetPct}
                    onChange={(e) => setTargetPct(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="8.0"
                  />
                  <span className="builder-field-hint">exit if position gains at least this much</span>
                </label>
              </div>
            ) : null}

            {exitMode !== 'sl_tgt' ? (
              <>
                <div className="builder-tree-meta builder-tree-meta-exit">
                  {exitConditionCount} rules - depth {exitDepth}
                </div>
                {exitGroup ? (
                  <ConditionGroupEditor
                    catalog={catalog}
                    indicatorByType={indicatorByType}
                    group={exitGroup}
                    depth={0}
                    allowRemove={false}
                    onLogicChange={setExitGroupLogic}
                    onAddCondition={addExitCondition}
                    onAddGroup={addExitGroup}
                    onUpdateCondition={updateExitCondition}
                    onRemoveNode={removeExitNode}
                  />
                ) : (
                  <div className="conditions-empty">Loading exit builder...</div>
                )}
              </>
            ) : null}
          </article>
            </div>

            <aside className="strategy-wire-right">
              <article className="builder-paper builder-preview-card">
                <div className="builder-preview-head">
                  <div className="builder-preview-head-copy">
                    <h3>Chart Preview</h3>
                    <span>{primaryInstrument ? `${exchange} / ${intervalValue}` : 'Select an instrument to begin'}</span>
                  </div>
                  <div className="builder-preview-price">{formatPrice(previewChart?.last_price)}</div>
                </div>
                <div className="builder-preview-frame">
                  {!primaryInstrument ? (
                    <div className="builder-preview-state">
                      <strong>No instrument selected</strong>
                      <span>Add a symbol in the chart settings to load historical candles.</span>
                    </div>
                  ) : previewLoading ? (
                    <div className="builder-preview-state">
                      <strong>Loading preview...</strong>
                      <span>Fetching normalized candles for {primaryInstrument}.</span>
                    </div>
                  ) : previewError ? (
                    <div className="builder-preview-state builder-preview-state-error">
                      <strong>Preview unavailable</strong>
                      <span>{previewError}</span>
                    </div>
                  ) : previewChart && previewChart.candles.length > 0 ? (
                    <StrategyPreviewChart candles={previewChart.candles} interval={previewChart.interval} />
                  ) : (
                    <div className="builder-preview-state">
                      <strong>No candles available</strong>
                      <span>Try another instrument or timeframe.</span>
                    </div>
                  )}
                </div>
                <div className="builder-preview-meta">
                  <span>{primaryInstrument || 'No symbol'}</span>
                  <span>{previewChart?.exchange ?? exchange}</span>
                  <span>{previewChart?.instrument_type ?? instrumentType}</span>
                  <span>{previewChart?.candles.length ?? 0} bars</span>
                </div>
              </article>

              <article className="builder-paper builder-settings-card">
                <div className="builder-paper-head builder-paper-head-tight">
                  <span className="builder-paper-num">4</span>
                  <div className="builder-paper-head-copy">
                    <h2>Backtest Settings</h2>
                    <span>Capital, session, execution, and costs.</span>
                  </div>
                </div>

            <div className="strategy-row">
              <div className="field-group field-group-wide">
                <span>Strategy Name (Optional)</span>
                <input
                  className="field-input"
                  value={strategyName}
                  onChange={(event) => setStrategyName(event.target.value)}
                  placeholder="Optional label for this setup"
                />
              </div>
            </div>

            <div className="strategy-row">
              <div className="field-group">
                <span>Initial Capital (INR)</span>
                <input className="field-input" value={initialCapital} onChange={(e) => setInitialCapital(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
              <div className="field-group">
                <span>Start Date</span>
                <input className="field-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field-group">
                <span>End Date</span>
                <input className="field-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="strategy-row">
              <div className="field-group">
                <span>Holding Type</span>
                <select className="field-select" value={holdingType} onChange={(e) => setHoldingType(e.target.value as 'intraday' | 'positional')}>
                  <option value="positional">Positional (CNC)</option>
                  <option value="intraday">Intraday (MIS)</option>
                </select>
              </div>
              <div className="field-group">
                <span>Exchange</span>
                <select className="field-select" value={exchange} onChange={(e) => setExchange(e.target.value)}>
                  <option value="NSE">NSE</option>
                  <option value="BSE">BSE</option>
                </select>
              </div>
              <div className="field-group">
                <span>Instrument Type</span>
                <select className="field-select" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value)}>
                  <option value="STOCK">STOCK</option>
                  <option value="INDEX">INDEX</option>
                </select>
              </div>
            </div>

            {holdingType === 'intraday' ? (
              <div className="strategy-row">
                <div className="field-group">
                  <span>Session Start</span>
                  <input className="field-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="field-group">
                  <span>Session End</span>
                  <input className="field-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            ) : null}

            <div className="strategy-row">
              <div className="field-group">
                <span>Execution Style</span>
                <div className="side-toggle" role="tablist">
                  <button
                    type="button"
                    className={executionStyle === 'same_bar_close' ? 'side-chip active' : 'side-chip'}
                    onClick={() => setExecutionStyle('same_bar_close')}
                  >
                    Same Bar Close
                  </button>
                  <button
                    type="button"
                    className={executionStyle === 'next_bar_open' ? 'side-chip active' : 'side-chip'}
                    onClick={() => setExecutionStyle('next_bar_open')}
                  >
                    Next Bar Open
                  </button>
                </div>
              </div>

              {exitMode !== 'condition' ? (
                <div className="field-group">
                  <span>SL/TGT Conflict</span>
                  <div className="side-toggle" role="tablist">
                    <button
                      type="button"
                      className={stopTargetConflict === 'stop' ? 'side-chip active' : 'side-chip'}
                      onClick={() => setStopTargetConflict('stop')}
                    >
                      Stop First
                    </button>
                    <button
                      type="button"
                      className={stopTargetConflict === 'target' ? 'side-chip active' : 'side-chip'}
                      onClick={() => setStopTargetConflict('target')}
                    >
                      Target First
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="strategy-row">
              <div className="field-group field-group-wide">
                <span>
                  <label className="brokerage-toggle-label">
                    <input
                      type="checkbox"
                      checked={brokerageEnabled}
                      onChange={(e) => setBrokerageEnabled(e.target.checked)}
                      style={{ marginRight: '0.5rem' }}
                    />
                    Include Brokerage
                  </label>
                </span>
                {brokerageEnabled ? (
                  <div className="brokerage-fields">
                    <div className="field-group">
                      <span>Brokerage %</span>
                      <input
                        className="field-input"
                        value={brokeragePct}
                        onChange={(e) => setBrokeragePct(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="0.03"
                      />
                    </div>
                    <div className="field-group">
                      <span>Flat Cap (INR)</span>
                      <input
                        className="field-input"
                        value={brokerageFlat}
                        onChange={(e) => setBrokerageFlat(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="20"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="strategy-actions">
              <button className="primary-button" type="submit" disabled={backtestRunning}>
                {backtestRunning ? 'Running Backtest...' : 'Run Backtest'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={handleDeployLive}
                disabled={liveBusy || (liveStatus?.running ?? false)}
              >
                {liveBusy ? 'Deploying...' : liveStatus?.running ? 'Live Running' : 'Deploy Live'}
              </button>
            </div>
                {backtestError ? <section className="error-banner">{backtestError}</section> : null}
                {liveError ? <section className="error-banner">{liveError}</section> : null}
              </article>
            </aside>
          </div>

          {/* ---- RESULTS ---- */}
          {backtestResult ? (
            <>
              {/* Portfolio summary */}
              <article className="dashboard-module-card strategy-card">
                <header className="strategy-card-head">
                  <h2>Portfolio Performance</h2>
                  <span className="strategy-badge">
                    {backtestResult.strategy_summary.start_date as string} → {backtestResult.strategy_summary.end_date as string}
                  </span>
                </header>

                <EquityCurveChart points={backtestResult.portfolio.equity_curve} />

                <div className="metrics-grid metrics-grid-wide">
                  <div>
                    <span>Starting Capital</span>
                    <strong>₹{backtestResult.portfolio.starting_capital.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Ending Capital</span>
                    <strong className={backtestResult.portfolio.ending_capital >= backtestResult.portfolio.starting_capital ? 'pnl-pos' : 'pnl-neg'}>
                      ₹{backtestResult.portfolio.ending_capital.toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Net PnL</span>
                    <strong className={backtestResult.portfolio.net_pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                      {backtestResult.portfolio.net_pnl >= 0 ? '+' : ''}₹{backtestResult.portfolio.net_pnl.toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Return %</span>
                    <strong className={backtestResult.portfolio.return_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                      {backtestResult.portfolio.return_pct >= 0 ? '+' : ''}{backtestResult.portfolio.return_pct.toFixed(2)}%
                    </strong>
                  </div>
                  <div>
                    <span>Total Trades</span>
                    <strong>{backtestResult.portfolio.total_trades}</strong>
                  </div>
                  <div>
                    <span>Win Rate</span>
                    <strong>{backtestResult.portfolio.win_rate_pct.toFixed(2)}%</strong>
                  </div>
                  <div>
                    <span>Wins / Losses</span>
                    <strong>
                      <span className="pnl-pos">{backtestResult.portfolio.winning_trades}W</span>
                      {' / '}
                      <span className="pnl-neg">{backtestResult.portfolio.losing_trades}L</span>
                    </strong>
                  </div>
                  <div>
                    <span>Profit Factor</span>
                    <strong>{backtestResult.portfolio.profit_factor != null ? backtestResult.portfolio.profit_factor.toFixed(2) : '—'}</strong>
                  </div>
                  <div>
                    <span>Max Drawdown</span>
                    <strong className="pnl-neg">{backtestResult.portfolio.max_drawdown_pct.toFixed(2)}%</strong>
                  </div>
                  <div>
                    <span>Total Brokerage</span>
                    <strong>₹{backtestResult.portfolio.total_brokerage.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Capital / Instrument</span>
                    <strong>₹{backtestResult.portfolio.capital_per_instrument.toFixed(2)}</strong>
                  </div>
                </div>
              </article>

              {/* Per-instrument results */}
              <article className="dashboard-module-card strategy-card">
                <header className="strategy-card-head">
                  <h2>Instrument Breakdown</h2>
                </header>

                <div className="instrument-tabs">
                  {backtestResult.instruments.map((item) => (
                    <button
                      type="button"
                      key={item.symbol}
                      className={backtestInstrument === item.symbol ? 'indicator-box active' : 'indicator-box'}
                      onClick={() => setBacktestInstrument(item.symbol)}
                    >
                      {item.symbol}
                    </button>
                  ))}
                </div>

                {selectedInstrumentResult ? (
                  <>
                    {selectedInstrumentResult.warning ? (
                      <div className="conditions-empty">{selectedInstrumentResult.warning}</div>
                    ) : null}

                    <div className="metrics-grid metrics-grid-wide">
                      <div>
                        <span>Starting Capital</span>
                        <strong>₹{selectedInstrumentResult.metrics.starting_capital.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Ending Capital</span>
                        <strong className={selectedInstrumentResult.metrics.ending_capital >= selectedInstrumentResult.metrics.starting_capital ? 'pnl-pos' : 'pnl-neg'}>
                          ₹{selectedInstrumentResult.metrics.ending_capital.toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Net PnL</span>
                        <strong className={selectedInstrumentResult.metrics.net_pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                          {selectedInstrumentResult.metrics.net_pnl >= 0 ? '+' : ''}₹{selectedInstrumentResult.metrics.net_pnl.toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Return %</span>
                        <strong className={selectedInstrumentResult.metrics.return_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                          {selectedInstrumentResult.metrics.return_pct >= 0 ? '+' : ''}{selectedInstrumentResult.metrics.return_pct.toFixed(2)}%
                        </strong>
                      </div>
                      <div>
                        <span>Total Trades</span>
                        <strong>{selectedInstrumentResult.metrics.total_trades}</strong>
                      </div>
                      <div>
                        <span>Win Rate</span>
                        <strong>{selectedInstrumentResult.metrics.win_rate_pct.toFixed(2)}%</strong>
                      </div>
                      <div>
                        <span>Avg PnL / Trade</span>
                        <strong className={selectedInstrumentResult.metrics.avg_pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                          ₹{selectedInstrumentResult.metrics.avg_pnl.toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Avg PnL %</span>
                        <strong className={selectedInstrumentResult.metrics.avg_pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                          {selectedInstrumentResult.metrics.avg_pnl_pct.toFixed(2)}%
                        </strong>
                      </div>
                      <div>
                        <span>Profit Factor</span>
                        <strong>{selectedInstrumentResult.metrics.profit_factor != null ? selectedInstrumentResult.metrics.profit_factor.toFixed(2) : '—'}</strong>
                      </div>
                      <div>
                        <span>Max Drawdown</span>
                        <strong className="pnl-neg">{selectedInstrumentResult.metrics.max_drawdown_pct.toFixed(2)}%</strong>
                      </div>
                      <div>
                        <span>Gross Profit</span>
                        <strong className="pnl-pos">₹{selectedInstrumentResult.metrics.gross_profit.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Gross Loss</span>
                        <strong className="pnl-neg">₹{selectedInstrumentResult.metrics.gross_loss.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Brokerage</span>
                        <strong>₹{selectedInstrumentResult.metrics.total_brokerage.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span>Bars Processed</span>
                        <strong>{selectedInstrumentResult.bars_processed}</strong>
                      </div>
                    </div>

                    {/* Equity curve for instrument */}
                    {selectedInstrumentResult.equity_curve.length > 1 ? (
                      <EquityCurveChart points={selectedInstrumentResult.equity_curve} />
                    ) : null}

                    {/* Trades table */}
                    <div className="conditions-header" style={{ marginTop: '1.25rem' }}>
                      <span>Trade Log ({selectedInstrumentResult.metrics.total_trades} trades)</span>
                    </div>
                    <div className="trade-table">
                      <div className="trade-row trade-head">
                        <span>Entry</span>
                        <span>Exit</span>
                        <span>Side</span>
                        <span>Qty</span>
                        <span>Entry Px</span>
                        <span>Exit Px</span>
                        <span>PnL (₹)</span>
                        <span>PnL %</span>
                        <span>Bars</span>
                        <span>Brokerage</span>
                        <span>Reason</span>
                      </div>
                      {selectedInstrumentResult.trades.length === 0 ? (
                        <div className="conditions-empty">No trades in this range.</div>
                      ) : (
                        selectedInstrumentResult.trades.map((trade, idx) => (
                          <div className="trade-row" key={`${trade.entry_timestamp}-${idx}`}>
                            <span>{trade.entry_timestamp}</span>
                            <span>{trade.exit_timestamp}</span>
                            <span className={trade.side === 'BUY' ? 'pnl-pos' : 'pnl-neg'}>{trade.side}</span>
                            <span>{trade.quantity.toFixed(2)}</span>
                            <span>₹{trade.entry_price.toFixed(2)}</span>
                            <span>₹{trade.exit_price.toFixed(2)}</span>
                            <span className={trade.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                              {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}
                            </span>
                            <span className={trade.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>
                              {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(2)}%
                            </span>
                            <span>{trade.bars_held}</span>
                            <span>₹{trade.brokerage.toFixed(2)}</span>
                            <span className="trade-reason">{trade.exit_reason.replace(/_/g, ' ')}</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Signal log (triggered days only by default) */}
                    <div className="conditions-header" style={{ marginTop: '1.25rem' }}>
                      <span>
                        Signal Log — {showFullLog ? `All ${selectedInstrumentResult.daily_signal_log.length} bars` : `${selectedInstrumentResult.triggered_days.length} triggered`}
                      </span>
                      <button
                        type="button"
                        className="chip-add-button"
                        onClick={() => setShowFullLog((prev) => !prev)}
                      >
                        {showFullLog ? 'Show Triggered Only' : 'Show All Bars'}
                      </button>
                    </div>
                    <div className="trade-table">
                      <div className="trade-row trade-head trade-head-signal">
                        <span>Timestamp</span>
                        <span>Close</span>
                        <span>Action</span>
                        <span>Entry?</span>
                        <span>Exit?</span>
                        <span>State</span>
                        <span>SL Price</span>
                        <span>TGT Price</span>
                      </div>
                      {(showFullLog ? selectedInstrumentResult.daily_signal_log : selectedInstrumentResult.triggered_days).length === 0 ? (
                        <div className="conditions-empty">No signal events in this range.</div>
                      ) : (
                        (showFullLog ? selectedInstrumentResult.daily_signal_log : selectedInstrumentResult.triggered_days)
                          .slice(-200)
                          .map((row, idx) => (
                            <div className={`trade-row ${row.action !== 'hold' ? 'trade-row-triggered' : ''}`} key={`${row.timestamp}-${idx}`}>
                              <span>{row.timestamp}</span>
                              <span>₹{row.close.toFixed(2)}</span>
                              <span className="trade-reason">{row.action.replace(/_/g, ' ')}</span>
                              <span>{row.entry_signal ? '✓' : '—'}</span>
                              <span>{row.exit_signal ? '✓' : '—'}</span>
                              <span>{row.position_state.replace(/_/g, ' ')}</span>
                              <span>{row.stop_loss_price != null ? `₹${row.stop_loss_price.toFixed(2)}` : '—'}</span>
                              <span>{row.target_price != null ? `₹${row.target_price.toFixed(2)}` : '—'}</span>
                            </div>
                          ))
                      )}
                    </div>
                  </>
                ) : null}
              </article>
            </>
          ) : null}

          {/* ---- LIVE RUNNER STATUS ---- */}
          {liveStatus?.running ? (
            <article className="dashboard-module-card strategy-card">
              <header className="strategy-card-head">
                <h2>Live Runner</h2>
              </header>
              <div className="status-list">
                <div><span>Status</span><strong>Running</strong></div>
                <div><span>Market</span><strong>{liveStatus.market_status}</strong></div>
                <div><span>Instruments</span><strong>{liveStatus.instruments.join(', ')}</strong></div>
                <div><span>Interval</span><strong>{liveStatus.interval}</strong></div>
                <div><span>Entry Side</span><strong>{liveStatus.entry_side}</strong></div>
                <div><span>Last Run</span><strong>{liveStatus.last_run_ist ?? '-'}</strong></div>
                <div><span>Next Run</span><strong>{liveStatus.next_run_ist ?? '-'}</strong></div>
                <div><span>Last Signal</span><strong>{liveStatus.last_signal ?? '-'}</strong></div>
              </div>
              <div className="trade-table">
                <div className="trade-row trade-head">
                  <span>Time</span>
                  <span>Instrument</span>
                  <span>Event</span>
                  <span>Price</span>
                  <span>Candle</span>
                  <span>Detail</span>
                </div>
                {liveStatus.alerts.length === 0 ? (
                  <div className="conditions-empty">No alerts yet.</div>
                ) : (
                  liveStatus.alerts.map((alert) => (
                    <div className="trade-row" key={alert.id}>
                      <span>{alert.triggered_at_ist}</span>
                      <span>{alert.instrument}</span>
                      <span>{alert.event}</span>
                      <span>{alert.price.toFixed(2)}</span>
                      <span>{alert.candle_time_ist}</span>
                      <span>{alert.detail}</span>
                    </div>
                  ))
                )}
              </div>
            </article>
          ) : null}
        </form>
      </section>
    </main>
  )
}

interface ConditionGroupEditorProps {
  catalog: Catalog
  indicatorByType: Map<string, CatalogIndicator>
  group: ConditionGroupState
  depth: number
  allowRemove: boolean
  onLogicChange: (id: string, logic: 'AND' | 'OR') => void
  onAddCondition: (groupId: string) => void
  onAddGroup: (groupId: string) => void
  onUpdateCondition: (id: string, next: ConditionState) => void
  onRemoveNode: (id: string) => void
  path?: number[]
}

function ConditionGroupEditor({
  catalog,
  indicatorByType,
  group,
  depth,
  allowRemove,
  onLogicChange,
  onAddCondition,
  onAddGroup,
  onUpdateCondition,
  onRemoveNode,
  path = [],
}: ConditionGroupEditorProps) {
  return (
    <div className={group.logic === 'OR' ? 'builder-logic-group is-or' : 'builder-logic-group is-and'}>
      <div className="builder-logic-badge">{group.logic}</div>
      <div className="builder-logic-meta">
        <span>{group.logic === 'OR' ? 'any one true ->' : 'all must be true ->'}</span>
        <div className="builder-logic-switch">
          <button
            type="button"
            className={group.logic === 'AND' ? 'active' : ''}
            onClick={() => onLogicChange(group.id, 'AND')}
          >
            AND
          </button>
          <button
            type="button"
            className={group.logic === 'OR' ? 'active' : ''}
            onClick={() => onLogicChange(group.id, 'OR')}
          >
            OR
          </button>
        </div>
      </div>

      {group.items.length === 0 ? (
        <div className="conditions-empty">Add a condition or nested group to get started.</div>
      ) : (
        group.items.map((item, index) => {
          const nextPath = [...path, index + 1]
          if (isConditionGroup(item)) {
            return (
              <ConditionGroupEditor
                key={item.id}
                catalog={catalog}
                indicatorByType={indicatorByType}
                group={item}
                depth={depth + 1}
                allowRemove
                onLogicChange={onLogicChange}
                onAddCondition={onAddCondition}
                onAddGroup={onAddGroup}
                onUpdateCondition={onUpdateCondition}
                onRemoveNode={onRemoveNode}
                path={nextPath}
              />
            )
          }
          return (
            <ConditionRow
              key={item.id}
              catalog={catalog}
              indicatorByType={indicatorByType}
              condition={item}
              prefix={nextPath.join('.')}
              onChange={(next) => onUpdateCondition(item.id, next)}
              onRemove={() => onRemoveNode(item.id)}
            />
          )
        })
      )}

      <div className="builder-add-row">
        <button type="button" className="builder-outline-btn" onClick={() => onAddCondition(group.id)}>
          + Add Condition
        </button>
        <button type="button" className="builder-outline-btn" onClick={() => onAddGroup(group.id)}>
          + Add Nested Group
        </button>
        {allowRemove ? (
          <button type="button" className="builder-outline-btn is-danger" onClick={() => onRemoveNode(group.id)}>
            Remove Group
          </button>
        ) : null}
      </div>
    </div>
  )
}

interface ConditionRowProps {
  catalog: Catalog
  indicatorByType: Map<string, CatalogIndicator>
  condition: ConditionState
  prefix: string
  onChange: (next: ConditionState) => void
  onRemove: () => void
}

function ConditionRow({ catalog, indicatorByType, condition, prefix, onChange, onRemove }: ConditionRowProps) {
  const lhsSpec = indicatorByType.get(condition.lhs.type)
  const rhsRule = rhsRuleForExpr(condition.lhs)

  const applicableRhsIndicators = useMemo(() => {
    return catalog.indicators.filter((ind) => rhsRule.indicatorTypes.includes(ind.type))
  }, [catalog, rhsRule])

  const rhsIndicatorCandidate = condition.rhsIndicator ?? buildDefaultRhsIndicator(condition.lhs, indicatorByType)
  const rhsRestrictions =
    condition.rhsIndicator && rhsIndicatorCandidate
      ? rhsRestrictionsForExpr(condition.lhs, condition.rhsIndicator)
      : {}

  function changeLhsType(nextType: string) {
    const nextSpec = indicatorByType.get(nextType)
    if (!nextSpec) return
    const nextLhs = defaultIndicatorExpr(nextSpec)
    const newRule = rhsRuleForExpr(nextLhs)
    const nextRhsKind: RhsKind = newRule.defaultKind === 'indicator' ? 'indicator' : 'number'
    const nextOperator = defaultOperatorForExpr(nextLhs)
    const nextRhsIndicator = nextRhsKind === 'indicator' ? buildDefaultRhsIndicator(nextLhs, indicatorByType) : undefined
    onChange({
      ...condition,
      lhs: nextLhs,
      operator: nextOperator,
      rhsKind: nextRhsKind,
      rhsIndicator: nextRhsIndicator,
    })
  }

  function updateLhsParam(key: string, value: number | string) {
    const nextLhs = { ...condition.lhs, params: { ...condition.lhs.params, [key]: value } }
    const nextRule = rhsRuleForExpr(nextLhs)
    const nextRhsKind =
      catalog.delta_operators.includes(condition.operator) || catalog.range_operators.includes(condition.operator)
        ? condition.rhsKind
        : nextRule.defaultKind === 'indicator'
          ? 'indicator'
          : 'number'
    onChange({
      ...condition,
      lhs: nextLhs,
      rhsKind: nextRhsKind,
      rhsIndicator: nextRhsKind === 'indicator' ? buildDefaultRhsIndicator(nextLhs, indicatorByType) : condition.rhsIndicator,
    })
  }

  function updateLhsOffset(value: string) {
    const parsed = Number(value)
    onChange({
      ...condition,
      lhs: { ...condition.lhs, offset: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 },
    })
  }

  function updateLhsOutput(value: string) {
    const nextLhs = { ...condition.lhs, output: value }
    const nextRule = rhsRuleForExpr(nextLhs)
    const nextRhsKind =
      catalog.delta_operators.includes(condition.operator) || catalog.range_operators.includes(condition.operator)
        ? condition.rhsKind
        : nextRule.defaultKind === 'indicator'
          ? 'indicator'
          : 'number'
    onChange({
      ...condition,
      lhs: nextLhs,
      rhsKind: nextRhsKind,
      rhsIndicator: nextRhsKind === 'indicator' ? buildDefaultRhsIndicator(nextLhs, indicatorByType) : condition.rhsIndicator,
    })
  }

  function updateOperator(op: OperatorId) {
    let nextKind = condition.rhsKind
    if (catalog.delta_operators.includes(op)) nextKind = 'number'
    else if (catalog.range_operators.includes(op)) nextKind = 'range'
    else nextKind = rhsRule.defaultKind === 'indicator' ? 'indicator' : 'number'

    let nextRhsIndicator = condition.rhsIndicator
    if (nextKind === 'indicator' && !nextRhsIndicator) {
      nextRhsIndicator = buildDefaultRhsIndicator(condition.lhs, indicatorByType)
    }
    onChange({ ...condition, operator: op, rhsKind: nextKind, rhsIndicator: nextRhsIndicator })
  }

  function updateRhsKind(kind: RhsKind) {
    if (kind === 'indicator' && !condition.rhsIndicator) {
      onChange({ ...condition, rhsKind: kind, rhsIndicator: buildDefaultRhsIndicator(condition.lhs, indicatorByType) })
      return
    }
    onChange({ ...condition, rhsKind: kind })
  }

  function updateRhsIndicatorType(nextType: string) {
    const nextIndicator = buildRhsIndicatorForType(nextType, condition.lhs, indicatorByType)
    if (!nextIndicator) return
    onChange({ ...condition, rhsIndicator: nextIndicator })
  }

  function updateRhsIndicatorParam(key: string, value: number | string) {
    if (!condition.rhsIndicator) return
    onChange({
      ...condition,
      rhsIndicator: { ...condition.rhsIndicator, params: { ...condition.rhsIndicator.params, [key]: value } },
    })
  }

  function updateRhsIndicatorOffset(value: string) {
    if (!condition.rhsIndicator) return
    const parsed = Number(value)
    onChange({
      ...condition,
      rhsIndicator: { ...condition.rhsIndicator, offset: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 },
    })
  }

  function updateRhsIndicatorOutput(value: string) {
    if (!condition.rhsIndicator) return
    onChange({ ...condition, rhsIndicator: { ...condition.rhsIndicator, output: value } })
  }

  const operatorChoices = catalog.operators
  const isNumberAllowed = rhsRule.allowNumber
  const isIndicatorAllowed = rhsRule.indicatorTypes.length > 0
  const showRhsKindToggle =
    isNumberAllowed &&
    isIndicatorAllowed &&
    !catalog.delta_operators.includes(condition.operator) &&
    !catalog.range_operators.includes(condition.operator)

  return (
    <div className="condition-row">
      <span className="condition-prefix">{prefix}</span>

      <div className="operand-slot">
        <IndicatorPicker
          catalog={catalog}
          spec={lhsSpec}
          expr={condition.lhs}
          onTypeChange={changeLhsType}
          onParamChange={updateLhsParam}
          onOffsetChange={updateLhsOffset}
          onOutputChange={updateLhsOutput}
        />
      </div>

      <select
        className="operator-select"
        value={condition.operator}
        onChange={(e) => updateOperator(e.target.value as OperatorId)}
      >
        {operatorChoices.map((op) => (
          <option key={op.id} value={op.id}>
            {op.label}
          </option>
        ))}
      </select>

      <div className="operand-slot">
        {condition.rhsKind === 'range' ? (
          <div className="range-inputs">
            <input
              value={condition.rhsLow ?? ''}
              onChange={(e) => onChange({ ...condition, rhsLow: e.target.value.replace(/[^0-9.\-]/g, '') })}
              placeholder="low"
            />
            <input
              value={condition.rhsHigh ?? ''}
              onChange={(e) => onChange({ ...condition, rhsHigh: e.target.value.replace(/[^0-9.\-]/g, '') })}
              placeholder="high"
            />
          </div>
        ) : condition.rhsKind === 'indicator' && condition.rhsIndicator && rhsIndicatorCandidate ? (
          <IndicatorPicker
            catalog={catalog}
            spec={indicatorByType.get(condition.rhsIndicator.type)}
            expr={condition.rhsIndicator}
            onTypeChange={updateRhsIndicatorType}
            onParamChange={updateRhsIndicatorParam}
            onOffsetChange={updateRhsIndicatorOffset}
            onOutputChange={updateRhsIndicatorOutput}
            restrictTypes={rhsRule.indicatorTypes}
            sourceChoicesOverride={rhsRestrictions.sourceChoices}
            outputChoicesOverride={rhsRestrictions.outputChoices}
          />
        ) : (
          <input
            className="number-input"
            value={condition.rhsNumber ?? ''}
            onChange={(e) => onChange({ ...condition, rhsNumber: e.target.value.replace(/[^0-9.\-]/g, '') })}
            placeholder="value"
          />
        )}
      </div>

      {showRhsKindToggle ? (
        <select
          className="rhs-kind-select"
          value={condition.rhsKind}
          onChange={(e) => updateRhsKind(e.target.value as RhsKind)}
        >
          <option value="number">Number</option>
          <option value="indicator">Indicator</option>
        </select>
      ) : null}

      <button type="button" className="condition-remove" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

interface IndicatorPickerProps {
  catalog: Catalog
  spec: CatalogIndicator | undefined
  expr: IndicatorExprState
  onTypeChange: (type: string) => void
  onParamChange: (key: string, value: number | string) => void
  onOffsetChange: (value: string) => void
  onOutputChange: (value: string) => void
  restrictTypes?: string[]
  sourceChoicesOverride?: string[]
  outputChoicesOverride?: string[]
}

function IndicatorPicker({
  catalog,
  spec,
  expr,
  onTypeChange,
  onParamChange,
  onOffsetChange,
  onOutputChange,
  restrictTypes,
  sourceChoicesOverride,
  outputChoicesOverride,
}: IndicatorPickerProps) {
  const [open, setOpen] = useState(false)

  const available = useMemo(() => {
    if (restrictTypes && restrictTypes.length > 0) {
      return catalog.indicators.filter((ind) => restrictTypes.includes(ind.type))
    }
    return catalog.indicators
  }, [catalog, restrictTypes])

  if (!spec) {
    return <span>Unknown indicator: {expr.type}</span>
  }

  const summary = formatIndicatorExpr(expr, spec)

  return (
    <div className="indicator-picker">
      <button type="button" className="indicator-summary" onClick={() => setOpen((prev) => !prev)}>
        {summary}
      </button>
      {open ? (
        <div className="indicator-popover">
          <div className="popover-row">
            <span>Indicator</span>
            <select
              value={expr.type}
              onChange={(e) => {
                onTypeChange(e.target.value)
                setOpen(false)
              }}
            >
              {available.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {spec.params.filter((p) => p.key !== 'offset').map((p) => (
            <ParamField
              key={p.key}
              param={p}
              value={expr.params[p.key] ?? p.default}
              choicesOverride={p.key === 'source' ? sourceChoicesOverride : undefined}
              onChange={(value) => onParamChange(p.key, value)}
            />
          ))}
          {spec.multi_output ? (
            <div className="popover-row">
              <span>Output</span>
              <select value={expr.output ?? spec.default_output ?? ''} onChange={(e) => onOutputChange(e.target.value)}>
                {(outputChoicesOverride ?? spec.outputs).map((output) => (
                  <option key={output} value={output}>
                    {output}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="popover-row">
            <span>Offset (bars back)</span>
            <input value={expr.offset} onChange={(e) => onOffsetChange(e.target.value)} />
          </div>
          <button type="button" className="popover-close" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface ParamFieldProps {
  param: CatalogParam
  value: number | string
  choicesOverride?: string[]
  onChange: (value: number | string) => void
}

function ParamField({ param, value, choicesOverride, onChange }: ParamFieldProps) {
  if (param.kind === 'source' || param.kind === 'enum') {
    const choices = choicesOverride ?? param.choices
    return (
      <div className="popover-row">
        <span>{param.label}</span>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </div>
    )
  }
  return (
    <div className="popover-row">
      <span>{param.label}</span>
      <input
        value={String(value)}
        onChange={(e) => {
          const parsed = param.kind === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
          else onChange(e.target.value)
        }}
      />
    </div>
  )
}
