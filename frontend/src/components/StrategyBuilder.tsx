import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PostLoginFooter from './PostLoginFooter'
import StrategyPreviewChart, { type StrategyPreviewCandlePoint } from './StrategyPreviewChart'

type Environment = 'PROD' | 'UAT'
type Interval = '1m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1mt'
type AllocationMode = 'split_total' | 'per_stock' | 'custom'
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

interface StrategyLivePosition {
  instrument: string
  quantity: number
  entry_side: string
  entry_price: number
  entry_time_ist: string
  entry_order_id: number | null
  entry_order_status: string | null
}

interface StrategyLiveStatus {
  running: boolean
  environment: Environment | null
  instruments: string[]
  interval: Interval | null
  entry_side: 'BUY' | 'SELL' | null
  market_status: string
  last_run_ist: string | null
  next_run_ist: string | null
  last_signal: string | null
  last_error: string | null
  alerts: StrategyLiveAlert[]
  positions: Record<string, StrategyLivePosition>
}

interface Props {
  apiBaseUrl: string
  sessionToken: string
  deviceId: string
  dataEnvironment: Environment
  executionEnvironment: Environment
  executionSessionToken: string
  executionDeviceId: string
  onExecutionEnvironmentSelect: (environment: Environment) => void
  onBack: () => void
  renderNav: (activeTab: string) => ReactNode
  mode?: 'full' | 'backtest'
}

const INTERVAL_CHOICES: Interval[] = ['1m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d', '1w', '1mt']
const AI_OPERATOR_IDS: OperatorId[] = [
  'greater_than',
  'less_than',
  'greater_equal',
  'less_equal',
  'equal',
  'crosses_above',
  'crosses_below',
  'up_by',
  'down_by',
  'within_range',
]

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isoDateToDisplay(value: string): string {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}-${month}-${year}`
}

function displayDateToIso(value: string): string | null {
  const cleaned = value.trim().replace(/\//g, '-')
  const parts = cleaned.split('-')
  if (parts.length !== 3) return null
  const [dayRaw, monthRaw, yearRaw] = parts
  const day = Number(dayRaw)
  const month = Number(monthRaw)
  const year = Number(yearRaw)
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function formatCurrencyDisplay(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberLikeToString(value: unknown, fallback = ''): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && 'value' in value) {
    return numberLikeToString((value as { value?: unknown }).value, fallback)
  }
  return fallback
}

function extractJsonCandidate(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1)
  return raw.trim()
}

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
  if (type === 'RSI' || type === 'CCI' || type === 'ATR') return 'greater_than'
  return 'crosses_above'
}

function nodeContainsCrossOperator(node: StrategyNodeState): boolean {
  if (isConditionGroup(node)) return node.items.some(nodeContainsCrossOperator)
  return node.operator === 'crosses_above' || node.operator === 'crosses_below'
}

function groupNeedsCrossTimingHint(group: ConditionGroupState | null): boolean {
  if (!group) return false
  if (group.logic === 'AND' && group.items.length > 1 && group.items.some(nodeContainsCrossOperator)) {
    return true
  }
  return group.items.some((item) => isConditionGroup(item) && groupNeedsCrossTimingHint(item))
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
  dataEnvironment,
  executionEnvironment,
  executionSessionToken,
  executionDeviceId,
  onExecutionEnvironmentSelect,
  onBack,
  renderNav,
  mode = 'full',
}: Props) {
  const isBacktestMode = mode === 'backtest'
  const pageTitle = isBacktestMode ? 'Backtest Lab' : 'No Code'
  const pageCrumb = pageTitle
  const pageSubtitle = isBacktestMode
    ? 'Build strategy rules and test them against historical candles.'
    : 'Build, backtest, and deploy rule-based strategies.'

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [aiAssistOpen, setAiAssistOpen] = useState(false)
  const [aiEntryBrief, setAiEntryBrief] = useState('')
  const [aiExitBrief, setAiExitBrief] = useState('')
  const [aiRiskBrief, setAiRiskBrief] = useState('')
  const [aiImportedText, setAiImportedText] = useState('')
  const [aiAssistError, setAiAssistError] = useState('')
  const [aiAssistStatus, setAiAssistStatus] = useState('')

  const [instruments, setInstruments] = useState<string[]>([])
  const [instrumentQuery, setInstrumentQuery] = useState('')
  const [stockSuggestions, setStockSuggestions] = useState<StockSearchItem[]>([])
  const [intervalValue, setIntervalValue] = useState<Interval>('1d')
  const [strategyName, setStrategyName] = useState('')

  const [entrySide, setEntrySide] = useState<'BUY' | 'SELL'>('BUY')
  const [entryGroup, setEntryGroup] = useState<ConditionGroupState | null>(null)
  const [entryIndicatorSearchQuery, setEntryIndicatorSearchQuery] = useState('')
  const [entryIndicatorSearchOpen, setEntryIndicatorSearchOpen] = useState(false)
  const [entryIndicatorSearchActiveIndex, setEntryIndicatorSearchActiveIndex] = useState(0)
  const entryIndicatorSearchCloseTimerRef = useRef<number | null>(null)

  type ExitMode = 'condition' | 'sl_tgt' | 'both'
  const [exitMode, setExitMode] = useState<ExitMode>('condition')
  const [exitGroup, setExitGroup] = useState<ConditionGroupState | null>(null)
  const [stopLossPct, setStopLossPct] = useState('2')
  const [targetPct, setTargetPct] = useState('4')

  const today = new Date()
  const threeMonthsAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
  const [initialCapital, setInitialCapital] = useState('100000')
  const [allocationMode, setAllocationMode] = useState<AllocationMode>('split_total')
  const [customCapitalBySymbol, setCustomCapitalBySymbol] = useState<Record<string, string>>({})
  const [startDate, setStartDate] = useState(threeMonthsAgo.toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(today.toISOString().slice(0, 10))
  const [startDateInput, setStartDateInput] = useState(isoDateToDisplay(threeMonthsAgo.toISOString().slice(0, 10)))
  const [endDateInput, setEndDateInput] = useState(isoDateToDisplay(today.toISOString().slice(0, 10)))
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
  // showFullLog removed — we now only show triggered bars
  const [execLogOpen, setExecLogOpen] = useState(false)
  const [backtestEntryOpen, setBacktestEntryOpen] = useState(mode !== 'backtest')
  const [backtestExitOpen, setBacktestExitOpen] = useState(mode !== 'backtest')
  const [backtestResultsTab, setBacktestResultsTab] = useState<'overview' | 'trades' | 'signals'>('overview')
  const [showAllBacktestTrades, setShowAllBacktestTrades] = useState(false)
  const [previewChart, setPreviewChart] = useState<StrategyPreviewChartPanel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const [liveStatus, setLiveStatus] = useState<StrategyLiveStatus | null>(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState('')
  const [showProdConfirm, setShowProdConfirm] = useState(false)
  const [exitDefaultsSeeded, setExitDefaultsSeeded] = useState(false)
  const primaryInstrument = instruments[0] ?? ''

  useEffect(() => {
    setShowAllBacktestTrades(false)
  }, [backtestInstrument])

  useEffect(() => {
    setCustomCapitalBySymbol((prev) => {
      const next: Record<string, string> = {}
      const fallbackValue = instruments.length > 0 && Number(initialCapital) > 0
        ? String(Math.max(1, Math.round(Number(initialCapital) / instruments.length)))
        : ''
      for (const symbol of instruments) {
        next[symbol] = prev[symbol] ?? fallbackValue
      }
      const changed =
        Object.keys(prev).length !== Object.keys(next).length ||
        Object.entries(next).some(([symbol, value]) => prev[symbol] !== value)
      return changed ? next : prev
    })
  }, [instruments, initialCapital])

  useEffect(() => {
    if (!isBacktestMode || !backtestResult) return
    window.setTimeout(() => {
      document.getElementById('backtest-results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }, [isBacktestMode, backtestResult])

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
            environment: dataEnvironment,
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
  }, [apiBaseUrl, sessionToken, deviceId, dataEnvironment, instrumentQuery])

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
            environment: dataEnvironment,
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
  }, [apiBaseUrl, sessionToken, deviceId, dataEnvironment, primaryInstrument, exchange, instrumentType, intervalValue])

  // Live status poll
  useEffect(() => {
    if (isBacktestMode) return
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
  }, [apiBaseUrl, isBacktestMode])

  const addInstrument = useCallback(() => {
    const trimmed = instrumentQuery.trim().toUpperCase()
    if (!trimmed) return
    setInstruments((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    setInstrumentQuery('')
    setStockSuggestions([])
  }, [instrumentQuery])

  const selectInstrumentSuggestion = useCallback((item: StockSearchItem) => {
    setInstruments((prev) => (prev.includes(item.instrument) ? prev : [...prev, item.instrument]))
    setInstrumentQuery('')
    setStockSuggestions([])
  }, [])

  const removeInstrument = (symbol: string) => {
    setInstruments((prev) => prev.filter((item) => item !== symbol))
  }

  const parsedStartDate = useMemo(() => displayDateToIso(startDateInput), [startDateInput])
  const parsedEndDate = useMemo(() => displayDateToIso(endDateInput), [endDateInput])
  const capitalNumber = Number(initialCapital || 0)
  const customCapitalTotal = useMemo(
    () => instruments.reduce((total, symbol) => total + (Number(customCapitalBySymbol[symbol] || 0) || 0), 0),
    [customCapitalBySymbol, instruments],
  )
  const effectiveTotalCapital =
    allocationMode === 'split_total'
      ? capitalNumber
      : allocationMode === 'per_stock'
        ? capitalNumber * instruments.length
        : customCapitalTotal
  const allocationSummary = useMemo(() => {
    if (instruments.length === 0) return 'Add at least one stock to configure capital.'
    if (allocationMode === 'split_total') {
      const each = instruments.length > 0 ? effectiveTotalCapital / instruments.length : 0
      return `Total ₹${formatCurrencyDisplay(effectiveTotalCapital)} split equally across ${instruments.length} stock${instruments.length === 1 ? '' : 's'} -> ₹${formatCurrencyDisplay(each)} each.`
    }
    if (allocationMode === 'per_stock') {
      return `₹${formatCurrencyDisplay(capitalNumber)} allocated per stock across ${instruments.length} stock${instruments.length === 1 ? '' : 's'} -> total deployed ₹${formatCurrencyDisplay(effectiveTotalCapital)}.`
    }
    return `Custom stock-wise allocation across ${instruments.length} stock${instruments.length === 1 ? '' : 's'} -> total deployed ₹${formatCurrencyDisplay(customCapitalTotal)}.`
  }, [allocationMode, capitalNumber, customCapitalTotal, effectiveTotalCapital, instruments.length])

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

  const makeConditionForIndicatorType = useCallback(
    (indicatorType: string): ConditionState | null => {
      if (!catalog) return null
      const lhsSpec = catalog.indicators.find((ind) => ind.type === indicatorType)
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

  function makeConditionFromPreset(
    lhsType: string,
    operator: OperatorId,
    options: {
      lhsParams?: Record<string, number | string>
      lhsOutput?: string | null
      rhsKind?: RhsKind
      rhsNumber?: string
      rhsIndicatorType?: string
      rhsIndicatorParams?: Record<string, number | string>
    } = {},
  ): ConditionState | null {
    const lhsSpec = indicatorByType.get(lhsType)
    if (!lhsSpec) return makeDefaultCondition('oscillator_bounded')
    const lhs = defaultIndicatorExpr(lhsSpec, {
      params: options.lhsParams,
      output: options.lhsOutput ?? undefined,
    })
    const rhsKind = options.rhsKind ?? (options.rhsIndicatorType ? 'indicator' : 'number')
    const rhsIndicator = options.rhsIndicatorType
      ? (() => {
          const rhsSpec = indicatorByType.get(options.rhsIndicatorType!)
          if (!rhsSpec) return buildDefaultRhsIndicator(lhs, indicatorByType)
          return defaultIndicatorExpr(rhsSpec, { params: options.rhsIndicatorParams })
        })()
      : rhsKind === 'indicator'
        ? buildDefaultRhsIndicator(lhs, indicatorByType)
        : undefined

    return {
      kind: 'condition',
      id: uid(),
      lhs,
      operator,
      rhsKind,
      rhsIndicator,
      rhsNumber: options.rhsNumber ?? '30',
      rhsLow: '30',
      rhsHigh: '70',
    }
  }

  function applyEntryPreset(preset: 'rsi' | 'ema' | 'price' | 'volume' | 'momentum') {
    const condition =
      preset === 'rsi'
        ? makeConditionFromPreset('RSI', 'crosses_above', { lhsParams: { period: 14, source: 'close' }, rhsNumber: '30' })
        : preset === 'ema'
          ? makeConditionFromPreset('PRICE', 'crosses_above', { lhsParams: { source: 'close' }, rhsKind: 'indicator', rhsIndicatorType: 'EMA', rhsIndicatorParams: { source: 'close', period: 20 } })
          : preset === 'price'
            ? makeConditionFromPreset('PRICE', 'greater_than', { lhsParams: { source: 'close' }, rhsKind: 'indicator', rhsIndicatorType: 'SMA', rhsIndicatorParams: { source: 'close', period: 20 } })
            : preset === 'volume'
              ? makeConditionFromPreset('VOLUME', 'greater_than', { rhsKind: 'indicator', rhsIndicatorType: 'SMA', rhsIndicatorParams: { source: 'volume', period: 20 } })
              : makeConditionFromPreset(indicatorByType.has('MACD') ? 'MACD' : 'RSI', 'greater_than', indicatorByType.has('MACD') ? { lhsOutput: 'histogram', rhsNumber: '0' } : { lhsParams: { period: 14, source: 'close' }, rhsNumber: '50' })
    if (!condition) return
    setEntryGroup(createConditionGroup('AND', [condition]))
    setBacktestEntryOpen(true)
  }

  const filteredEntryIndicators = useMemo(() => {
    const available = catalog?.indicators ?? []
    const query = entryIndicatorSearchQuery.trim().toLowerCase()
    if (!query) return available
    return available.filter((indicator) =>
      indicator.label.toLowerCase().includes(query) ||
      indicator.type.toLowerCase().includes(query) ||
      indicator.category.toLowerCase().includes(query),
    )
  }, [catalog, entryIndicatorSearchQuery])

  useEffect(() => {
    setEntryIndicatorSearchActiveIndex(0)
  }, [entryIndicatorSearchQuery])

  useEffect(() => {
    return () => {
      if (entryIndicatorSearchCloseTimerRef.current != null) {
        window.clearTimeout(entryIndicatorSearchCloseTimerRef.current)
      }
    }
  }, [])

  function applyEntryIndicatorType(indicatorType: string) {
    const condition = makeConditionForIndicatorType(indicatorType)
    if (!condition) return
    setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, prev.id, condition) : createConditionGroup('AND', [condition])))
    setBacktestEntryOpen(true)
    setEntryIndicatorSearchOpen(false)
    setEntryIndicatorSearchActiveIndex(0)
    setEntryIndicatorSearchQuery('')
  }

  function selectEntryIndicator(indicatorType: string) {
    if (entryIndicatorSearchCloseTimerRef.current != null) {
      window.clearTimeout(entryIndicatorSearchCloseTimerRef.current)
      entryIndicatorSearchCloseTimerRef.current = null
    }
    applyEntryIndicatorType(indicatorType)
  }

  function applyExitPreset(preset: 'rsi' | 'ema' | 'stop' | 'target' | 'condition') {
    if (preset === 'stop') {
      setExitMode('sl_tgt')
      setStopLossPct('2')
      setTargetPct('0')
      setBacktestExitOpen(true)
      return
    }
    if (preset === 'target') {
      setExitMode('sl_tgt')
      setStopLossPct('0')
      setTargetPct('4')
      setBacktestExitOpen(true)
      return
    }
    setExitMode('condition')
    const condition =
      preset === 'rsi'
        ? makeConditionFromPreset('RSI', 'crosses_below', { lhsParams: { period: 14, source: 'close' }, rhsNumber: '70' })
        : preset === 'ema'
          ? makeConditionFromPreset('PRICE', 'crosses_below', { lhsParams: { source: 'close' }, rhsKind: 'indicator', rhsIndicatorType: 'EMA', rhsIndicatorParams: { source: 'close', period: 20 } })
          : makeConditionFromPreset('RSI', 'less_than', { lhsParams: { period: 14, source: 'close' }, rhsNumber: '50' })
    if (!condition) return
    setExitGroup(createConditionGroup('OR', [condition]))
    setBacktestExitOpen(true)
  }

  function applyStrategyTemplate(template: 'rsi' | 'ema' | 'momentum' | 'breakout') {
    if (template === 'rsi') {
      applyEntryPreset('rsi')
      applyExitPreset('rsi')
      return
    }
    if (template === 'ema') {
      applyEntryPreset('ema')
      applyExitPreset('ema')
      return
    }
    if (template === 'momentum') {
      applyEntryPreset('momentum')
      applyExitPreset('condition')
      return
    }
    applyEntryPreset('price')
    applyExitPreset('ema')
  }

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
    if (!catalog || exitDefaultsSeeded || exitMode === 'sl_tgt' || exitGroup) return
    const group = makeSeedGroup('OR')
    if (group.items.length > 0) {
      setExitGroup(group)
      setExitDefaultsSeeded(true)
    }
  }, [catalog, exitDefaultsSeeded, exitGroup, exitMode, makeSeedGroup])

  const addEntryCondition = useCallback(
    (groupId: string) => {
      const cond = makeDefaultCondition('oscillator_bounded')
      if (!cond) return
      setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, groupId, cond) : createConditionGroup('AND', [cond])))
    },
    [makeDefaultCondition],
  )

  const addEntryRootCondition = useCallback(() => {
    const cond = makeDefaultCondition('oscillator_bounded')
    if (!cond) return
    setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, prev.id, cond) : createConditionGroup('AND', [cond])))
    setBacktestEntryOpen(true)
  }, [makeDefaultCondition])

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

  const addEntryRootGroup = useCallback(() => {
    const nested = createConditionGroup('AND', [])
    const cond = makeDefaultCondition('oscillator_bounded')
    if (cond) nested.items.push(cond)
    setEntryGroup((prev) => (prev ? appendNodeToGroup(prev, prev.id, nested) : createConditionGroup('AND', [nested])))
    setBacktestEntryOpen(true)
  }, [makeDefaultCondition])

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
    if (!parsedStartDate || !parsedEndDate) return 'Enter valid start and end dates in DD-MM-YYYY format.'
    if (exitMode !== 'condition') {
      const hasStop = Number(stopLossPct) > 0
      const hasTarget = Number(targetPct) > 0
      if (!hasStop && !hasTarget) return 'Enter a stop-loss or target percentage.'
    }
    if (parsedStartDate > parsedEndDate) return 'Start date must be on or before end date.'
    if (allocationMode !== 'custom' && capitalNumber <= 0) {
      return allocationMode === 'split_total' ? 'Enter a positive total capital.' : 'Enter a positive per-stock capital.'
    }
    if (allocationMode === 'custom') {
      if (instruments.some((symbol) => Number(customCapitalBySymbol[symbol] || 0) <= 0)) {
        return 'Enter a positive capital amount for each selected stock.'
      }
      if (customCapitalTotal <= 0) return 'Custom capital allocation must be positive.'
    }
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

  function parseAiIndicatorExpr(payload: unknown, label: string): IndicatorExprState {
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${label} must be an indicator object.`)
    }
    const record = payload as Record<string, unknown>
    const indicatorType = stringValue(record.type).trim().toUpperCase()
    if (!indicatorType) throw new Error(`${label}.type is required.`)
    const spec = indicatorByType.get(indicatorType)
    if (!spec) throw new Error(`${label}.type "${indicatorType}" is not supported in Nubra.`)
    const paramsPayload = record.params && typeof record.params === 'object'
      ? (record.params as Record<string, unknown>)
      : {}
    const params: Record<string, number | string> = {}
    for (const param of spec.params) {
      if (param.key === 'offset') continue
      const raw = paramsPayload[param.key]
      params[param.key] = raw == null ? param.default : raw as number | string
    }
    return {
      type: spec.type,
      params,
      output: spec.multi_output ? (typeof record.output === 'string' ? record.output : spec.default_output) : null,
      offset: typeof record.offset === 'number' ? record.offset : Number(record.offset ?? 0) || 0,
    }
  }

  function parseAiConditionNode(payload: unknown, path: string): StrategyNodeState {
    if (Array.isArray(payload)) {
      return createConditionGroup('AND', payload.map((item, index) => parseAiConditionNode(item, `${path}[${index}]`)))
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${path} must be a condition or group object.`)
    }
    const record = payload as Record<string, unknown>
    if ('logic' in record && 'items' in record) {
      const logic = String(record.logic || 'AND').toUpperCase()
      if (logic !== 'AND' && logic !== 'OR') throw new Error(`${path}.logic must be AND or OR.`)
      if (!Array.isArray(record.items) || record.items.length === 0) throw new Error(`${path}.items must contain at least one condition.`)
      return createConditionGroup(logic, record.items.map((item, index) => parseAiConditionNode(item, `${path}.items[${index}]`)))
    }

    const lhs = parseAiIndicatorExpr(record.lhs, `${path}.lhs`)
    const operator = String(record.op ?? record.operator ?? '').toLowerCase() as OperatorId
    if (!AI_OPERATOR_IDS.includes(operator)) throw new Error(`${path}.op "${operator}" is not supported.`)

    if (operator === 'within_range') {
      const rhs = record.rhs
      if (!rhs || typeof rhs !== 'object') throw new Error(`${path}.rhs must be { low, high } for within_range.`)
      const rhsRecord = rhs as Record<string, unknown>
      return {
        kind: 'condition',
        id: uid(),
        lhs,
        operator,
        rhsKind: 'range',
        rhsLow: numberLikeToString(rhsRecord.low, '0'),
        rhsHigh: numberLikeToString(rhsRecord.high, '0'),
      }
    }

    const rhsPayload = record.rhs
    if (rhsPayload && typeof rhsPayload === 'object' && 'type' in (rhsPayload as Record<string, unknown>)) {
      return {
        kind: 'condition',
        id: uid(),
        lhs,
        operator,
        rhsKind: 'indicator',
        rhsIndicator: parseAiIndicatorExpr(rhsPayload, `${path}.rhs`),
      }
    }

    return {
      kind: 'condition',
      id: uid(),
      lhs,
      operator,
      rhsKind: 'number',
      rhsNumber: numberLikeToString(rhsPayload, '0'),
    }
  }

  function buildAiPrompt(): string {
    const supportedIndicators = (catalog?.indicators ?? []).map((item) => item.type).join(', ')
    const chosenSymbols = instruments.length ? instruments.join(', ') : 'none selected yet'
    return [
      'You are generating a NubraOSS strategy JSON.',
      'Return valid JSON only. Do not include markdown fences, explanations, comments, or prose.',
      '',
      'Goal:',
      '- Convert the user strategy description into Nubra-compatible strategy JSON for entry and exit logic.',
      '- Keep the output strict and machine-parseable.',
      '',
      'Available context:',
      `- Selected symbols: ${chosenSymbols}`,
      `- Current interval: ${intervalValue}`,
      `- Entry side preference: ${entrySide}`,
      `- Supported indicators: ${supportedIndicators || 'use common indicators only if explicitly supported'}`,
      `- Supported operators: ${AI_OPERATOR_IDS.join(', ')}`,
      '',
      'Required output shape:',
      '{',
      '  "entry": {',
      '    "side": "BUY or SELL",',
      '    "conditions": { "logic": "AND or OR", "items": [ ...nested condition nodes... ] }',
      '  },',
      '  "exit": {',
      '    "mode": "condition | sl_tgt | both",',
      '    "conditions": { "logic": "AND or OR", "items": [ ... ] },',
      '    "stop_loss_pct": 2,',
      '    "target_pct": 4',
      '  }',
      '}',
      '',
      'Condition node shape:',
      '{',
      '  "lhs": { "type": "EMA", "params": { "source": "close", "period": 9 }, "output": null, "offset": 0 },',
      '  "op": "crosses_above",',
      '  "rhs": { "type": "EMA", "params": { "source": "close", "period": 21 }, "output": null, "offset": 0 }',
      '}',
      '',
      'Range example:',
      '{',
      '  "lhs": { "type": "RSI", "params": { "source": "close", "period": 14 }, "output": null, "offset": 0 },',
      '  "op": "within_range",',
      '  "rhs": { "low": 30, "high": 70 }',
      '}',
      '',
      'User brief:',
      `- Entry conditions: ${aiEntryBrief.trim() || 'not provided'}`,
      `- Exit conditions: ${aiExitBrief.trim() || 'not provided'}`,
      `- Risk / stop / target / notes: ${aiRiskBrief.trim() || 'not provided'}`,
    ].join('\n')
  }

  function buildAiRepairPrompt(): string {
    return [
      'Fix this NubraOSS strategy JSON so it becomes valid.',
      'Return JSON only. Do not add markdown or explanation.',
      '',
      `Validation error: ${aiAssistError || 'Unknown validation error.'}`,
      '',
      'Previous JSON:',
      aiImportedText.trim() || '{}',
    ].join('\n')
  }

  async function copyAiPromptToClipboard() {
    try {
      await navigator.clipboard.writeText(buildAiPrompt())
      setAiAssistStatus('AI prompt copied. Paste it into ChatGPT and bring the JSON back here.')
      setAiAssistError('')
    } catch {
      setAiAssistError('Unable to copy the AI prompt. You can still copy it manually from the prompt box.')
      setAiAssistStatus('')
    }
  }

  async function copyAiRepairPromptToClipboard() {
    try {
      await navigator.clipboard.writeText(buildAiRepairPrompt())
      setAiAssistStatus('Repair prompt copied. Paste it into ChatGPT along with the invalid JSON.')
      setAiAssistError('')
    } catch {
      setAiAssistStatus('')
      setAiAssistError('Unable to copy the repair prompt. You can still manually copy the error and JSON below.')
    }
  }

  function openChatGptWithPrompt() {
    const prompt = buildAiPrompt()
    window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener,noreferrer')
    setAiAssistStatus('ChatGPT opened in a new tab with the prepared Nubra prompt.')
    setAiAssistError('')
  }

  function importAiStrategy() {
    if (!catalog) {
      setAiAssistError('Indicator catalog is still loading. Try again in a moment.')
      setAiAssistStatus('')
      return
    }
    try {
      const candidate = extractJsonCandidate(aiImportedText)
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const strategy = parsed.strategy && typeof parsed.strategy === 'object'
        ? parsed.strategy as Record<string, unknown>
        : parsed

      const entry = strategy.entry
      if (!entry || typeof entry !== 'object') throw new Error('AI output must include an entry block.')
      const entryRecord = entry as Record<string, unknown>
      const nextEntrySide = String(entryRecord.side ?? entrySide).toUpperCase()
      if (nextEntrySide !== 'BUY' && nextEntrySide !== 'SELL') throw new Error('entry.side must be BUY or SELL.')
      const entryConditions = parseAiConditionNode(entryRecord.conditions, 'entry.conditions')
      if (!isConditionGroup(entryConditions)) throw new Error('entry.conditions must resolve to a group.')

      const exit = strategy.exit
      let nextExitMode: ExitMode = exitMode
      let nextExitGroup: ConditionGroupState | null = null
      let nextStopLoss = stopLossPct
      let nextTarget = targetPct
      if (exit && typeof exit === 'object') {
        const exitRecord = exit as Record<string, unknown>
        const modeRaw = String(exitRecord.mode ?? 'condition').toLowerCase()
        if (modeRaw === 'condition' || modeRaw === 'sl_tgt' || modeRaw === 'both') {
          nextExitMode = modeRaw
        } else {
          throw new Error('exit.mode must be condition, sl_tgt, or both.')
        }
        if (nextExitMode !== 'sl_tgt') {
          const parsedExit = parseAiConditionNode(exitRecord.conditions, 'exit.conditions')
          if (!isConditionGroup(parsedExit)) throw new Error('exit.conditions must resolve to a group.')
          nextExitGroup = parsedExit
        }
        if (exitRecord.stop_loss_pct != null) nextStopLoss = numberLikeToString(exitRecord.stop_loss_pct, stopLossPct)
        if (exitRecord.target_pct != null) nextTarget = numberLikeToString(exitRecord.target_pct, targetPct)
      }

      setEntrySide(nextEntrySide)
      setEntryGroup(entryConditions)
      setExitMode(nextExitMode)
      setExitGroup(nextExitGroup)
      setStopLossPct(nextStopLoss)
      setTargetPct(nextTarget)
      setBacktestEntryOpen(true)
      setBacktestExitOpen(true)
      setBacktestError('')
      setAiAssistError('')
      setAiAssistStatus('AI strategy imported. Review the generated Entry and Exit blocks, then run your backtest.')
    } catch (error) {
      setAiAssistStatus('')
      setAiAssistError(error instanceof Error ? error.message : 'Unable to import AI output.')
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
      initial_capital: effectiveTotalCapital,
      start_date: parsedStartDate ?? startDate,
      end_date: parsedEndDate ?? endDate,
      start_time: startTime,
      end_time: endTime,
      holding_type: holdingType,
      exchange,
      instrument_type: instrumentType,
      execution_style: executionStyle,
      stop_target_conflict: stopTargetConflict,
      capital_allocation: {
        mode: allocationMode,
        ...(allocationMode === 'per_stock' ? { per_stock_capital: capitalNumber } : {}),
        ...(allocationMode === 'custom' ? { custom_capital_map: Object.fromEntries(instruments.map((symbol) => [symbol, Number(customCapitalBySymbol[symbol] || 0)])) } : {}),
      },
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
          environment: dataEnvironment,
          strategy: buildStrategyPayload(),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Backtest failed.'))
      }
      const result = data as StrategyBacktestResponse
      if (result.portfolio.total_trades === 0) {
        const warningMessage =
          result.instruments.find((item) => item.warning?.trim())?.warning ??
          'Backtest produced zero trades in the requested range. Review the strategy rules, interval, and date window.'
        throw new Error(warningMessage)
      }
      setBacktestResult(result)
      setBacktestInstrument(result.instruments[0]?.symbol ?? '')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backtest failed.'
      if (dataEnvironment === 'UAT') {
        setBacktestError(`${msg}\n\n⚠️ Note: Backtesting in UAT environment may encounter database errors due to Nubra UAT limitations. Please switch to PROD environment for reliable backtesting.`)
      } else {
        setBacktestError(msg)
      }
    } finally {
      setBacktestRunning(false)
    }
  }

  async function _doDeployLive() {
    setLiveBusy(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/strategy/live/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: executionSessionToken,
          device_id: executionDeviceId,
          environment: executionEnvironment,
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

  function handleDeployLive() {
    setLiveError('')
    const validationError = validateStrategy()
    if (validationError) {
      setLiveError(validationError)
      return
    }
    if (!executionSessionToken || !executionDeviceId) {
      setLiveError(`Authenticate your ${executionEnvironment} execution session before deploying live.`)
      return
    }
    if (executionEnvironment === 'PROD') {
      setShowProdConfirm(true)
      return
    }
    void _doDeployLive()
  }

  function handleProdConfirm() {
    setShowProdConfirm(false)
    void _doDeployLive()
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
      <div className="subview-shell">
        {renderNav('Dashboard')}
        <main className="subview-main strategy-builder-subview-main">
          {renderPageHeader(pageSubtitle)}
          <section className="error-banner dashboard-error">{catalogError}</section>
          <PostLoginFooter />
        </main>
      </div>
    )
  }

  if (!catalog) {
    return (
      <div className="subview-shell">
        {renderNav('Dashboard')}
        <main className="subview-main strategy-builder-subview-main">
          {renderPageHeader('Loading indicator catalog...')}
          <PostLoginFooter />
        </main>
      </div>
    )
  }

  const selectedInstrumentResult = backtestResult?.instruments.find((item) => item.symbol === backtestInstrument)
  const entryConditionCount = countConditions(entryGroup)
  const exitConditionCount = countConditions(exitGroup)
  const entryDepth = groupDepth(entryGroup)
  const exitDepth = groupDepth(exitGroup)
  const isIntradayChart = !['1d', '1w', '1mt'].includes(intervalValue)
  const entryCrossTimingHint = groupNeedsCrossTimingHint(entryGroup)
  const exitCrossTimingHint = groupNeedsCrossTimingHint(exitGroup)

  function renderPageHeader(subtitle: string, actions?: ReactNode) {
    return (
      <section className="subview-page-head strategy-builder-page-head">
        <div className="subview-page-hero">
          <div className="subview-page-crumbs">
            <button type="button" className="ghost-inline" onClick={onBack}>
              Back to Dashboard
            </button>
            <span className="builder-crumb-sep">/</span>
            <span className="subview-page-crumb-label">{pageCrumb}</span>
          </div>
          <h1 className="hero-title subview-page-title">{pageTitle}</h1>
          <p className="hero-sub subview-page-subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="subview-page-pills">{actions}</div> : null}
      </section>
    )
  }

  if (showProdConfirm) {
    return (
      <div className="subview-shell">
        {renderNav('Dashboard')}
        <main className="subview-main strategy-builder-subview-main">
          {renderPageHeader('Build, backtest, and deploy rule-based strategies.')}
          <section className="dashboard-module-card strategy-card" style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center' }}>
            <header className="strategy-card-head" style={{ justifyContent: 'center' }}>
              <h2 style={{ color: 'var(--color-neg, #ef4444)' }}>Deploy to PROD?</h2>
            </header>
            <p style={{ margin: '1rem 0 0.5rem' }}>
              You are about to deploy this strategy live on <strong>Production</strong>.
            </p>
            <p style={{ margin: '0 0 1.5rem', fontSize: '0.85rem', opacity: 0.7 }}>
              Real orders will be placed on the exchange using your live account. This involves real financial risk. Confirm only if you have tested this strategy in UAT and are ready to trade live.
            </p>
            <div className="strategy-actions" style={{ justifyContent: 'center', gap: '1rem' }}>
              <button
                className="primary-button"
                type="button"
                style={{ background: 'var(--color-neg, #ef4444)', borderColor: 'var(--color-neg, #ef4444)' }}
                onClick={handleProdConfirm}
                disabled={liveBusy}
              >
                {liveBusy ? 'Deploying...' : 'Yes, Deploy to PROD'}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setShowProdConfirm(false)}
                disabled={liveBusy}
              >
                Cancel
              </button>
            </div>
          </section>
          <PostLoginFooter />
        </main>
      </div>
    )
  }

  if (isBacktestMode) {
    const portfolio = backtestResult?.portfolio
    const visibleTrades = selectedInstrumentResult
      ? showAllBacktestTrades ? selectedInstrumentResult.trades : selectedInstrumentResult.trades.slice(0, 20)
      : []
    const exitPrimaryCondition = exitGroup?.items.find((item): item is ConditionState => !isConditionGroup(item)) ?? null

    const updatePrimaryExitCondition = (next: ConditionState) => {
      if (exitPrimaryCondition) updateExitCondition(exitPrimaryCondition.id, next)
    }

    return (
      <div className="subview-shell">
        {renderNav('Dashboard')}
        <main className="subview-main backtest-workstation">
          <section className="backtest-workstation-head">
            <div className="backtest-title-zone">
              <div className="subview-page-crumbs">
                <button type="button" className="ghost-inline" onClick={onBack}>Back to Dashboard</button>
                <span className="builder-crumb-sep">/</span>
                <span className="subview-page-crumb-label">Backtest Lab</span>
              </div>
              <h1 className="hero-title subview-page-title">Backtest Lab</h1>
            </div>
            <div className="backtest-template-row" aria-label="Strategy templates">
              <span>Strategy Templates</span>
              <button type="button" onClick={() => applyStrategyTemplate('rsi')}>RSI Swing</button>
              <button type="button" onClick={() => applyStrategyTemplate('ema')}>EMA Trend</button>
              <button type="button" onClick={() => applyStrategyTemplate('breakout')}>Breakout</button>
              <button type="button" onClick={() => applyStrategyTemplate('momentum')}>Momentum</button>
              <button type="button" className="backtest-template-ai" onClick={() => setAiAssistOpen((open) => !open)}>
                {aiAssistOpen ? 'Close AI' : 'AI Assist'}
              </button>
            </div>
            <div className="backtest-head-actions">
              <details className="backtest-assumptions">
                <summary>Assumptions</summary>
                <div className="backtest-assumption-grid">
                  <label><span>Session</span><select value={holdingType} onChange={(event) => setHoldingType(event.target.value as 'intraday' | 'positional')}><option value="positional">Regular hours</option><option value="intraday">Intraday only</option></select></label>
                  <label><span>Exchange</span><select value={exchange} onChange={(event) => setExchange(event.target.value)}><option value="NSE">NSE</option><option value="BSE">BSE</option></select></label>
                  <label><span>Type</span><select value={instrumentType} onChange={(event) => setInstrumentType(event.target.value)}><option value="STOCK">STOCK</option><option value="INDEX">INDEX</option></select></label>
                  <label><span>Execution</span><select value={executionStyle} onChange={(event) => setExecutionStyle(event.target.value as 'same_bar_close' | 'next_bar_open')}><option value="same_bar_close">Same Bar Close</option><option value="next_bar_open">Next Bar Open</option></select></label>
                  <label className="backtest-assumption-check"><input type="checkbox" checked={brokerageEnabled} onChange={(event) => setBrokerageEnabled(event.target.checked)} /><span>Brokerage</span></label>
                </div>
              </details>
            </div>
          </section>

          {aiAssistOpen ? (
            <section className="backtest-ai-panel">
              <div className="backtest-ai-head">
                <div>
                  <span>Strategy AI Assist</span>
                  <strong>Describe the strategy, send the structured prompt to ChatGPT, then paste the returned JSON here.</strong>
                </div>
                <div className="backtest-ai-actions">
                  <button type="button" onClick={copyAiPromptToClipboard}>Copy Prompt</button>
                  <button type="button" onClick={openChatGptWithPrompt}>Open ChatGPT</button>
                </div>
              </div>
              <div className="backtest-ai-grid">
                <label className="backtest-ai-field">
                  <span>Entry Conditions</span>
                  <textarea
                    rows={3}
                    placeholder="Example: EMA 9 crosses above EMA 21 and RSI 14 is above 55."
                    value={aiEntryBrief}
                    onChange={(event) => setAiEntryBrief(event.target.value)}
                  />
                </label>
                <label className="backtest-ai-field">
                  <span>Exit Conditions</span>
                  <textarea
                    rows={3}
                    placeholder="Example: Exit when EMA 9 crosses below EMA 21 or RSI falls below 45."
                    value={aiExitBrief}
                    onChange={(event) => setAiExitBrief(event.target.value)}
                  />
                </label>
                <label className="backtest-ai-field">
                  <span>Risk / Notes</span>
                  <textarea
                    rows={3}
                    placeholder="Example: Buy side only, use 2% stop loss and 5% target."
                    value={aiRiskBrief}
                    onChange={(event) => setAiRiskBrief(event.target.value)}
                  />
                </label>
                <label className="backtest-ai-field backtest-ai-field-wide">
                  <span>Generated Prompt</span>
                  <textarea rows={12} value={buildAiPrompt()} readOnly />
                </label>
                <label className="backtest-ai-field backtest-ai-field-wide">
                  <span>Paste ChatGPT JSON Output</span>
                  <textarea
                    rows={10}
                    placeholder='Paste the JSON returned by ChatGPT here, for example: { "entry": { ... }, "exit": { ... } }'
                    value={aiImportedText}
                    onChange={(event) => setAiImportedText(event.target.value)}
                  />
                </label>
              </div>
              <div className="backtest-ai-footer">
                <button type="button" className="primary-button" onClick={importAiStrategy}>Import Into Builder</button>
                {aiAssistStatus ? <span className="backtest-ai-status">{aiAssistStatus}</span> : null}
              </div>
              {aiAssistError ? (
                <>
                  <section className="error-banner">{aiAssistError}</section>
                  <div className="backtest-ai-repair">
                    <button type="button" onClick={copyAiRepairPromptToClipboard}>Copy Repair Prompt</button>
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          <form id="backtest-lab-run-form" className="backtest-workstation-runbar" onSubmit={handleRunBacktest}>
            <div className="backtest-run-inline">
              <div className="backtest-run-symbol backtest-run-symbol-inline">
                <span>Stocks</span>
                <div className="backtest-run-symbol-input">
                  <input
                    placeholder="Search ticker"
                    value={instrumentQuery}
                    onChange={(event) => setInstrumentQuery(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addInstrument()
                      }
                    }}
                  />
                  {stockSuggestions.length > 0 ? (
                    <div className="backtest-symbol-suggestions">
                      {stockSuggestions.slice(0, 8).map((item) => (
                        <button
                          key={`${item.exchange}-${item.ref_id}`}
                          type="button"
                          onClick={() => selectInstrumentSuggestion(item)}
                        >
                          <strong>{item.instrument}</strong>
                          <span>{item.display_name} / {item.exchange}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {instruments.length ? (
                  <div className="backtest-run-selected-chips">
                    {instruments.map((symbol) => (
                      <span key={symbol} className="builder-chip builder-chip-ticker">
                        {symbol}
                        <button type="button" aria-label={`Remove ${symbol}`} onClick={() => removeInstrument(symbol)}>x</button>
                      </span>
                    ))}
                  </div>
                ) : <small>No symbol selected</small>}
              </div>
              <label className="backtest-run-field backtest-run-field-compact">
                <span>TF</span>
                <select value={intervalValue} onChange={(event) => setIntervalValue(event.target.value as Interval)}>
                  {INTERVAL_CHOICES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="backtest-run-field backtest-run-field-date">
                <span>Start</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD-MM-YYYY"
                  value={startDateInput}
                  onChange={(event) => setStartDateInput(event.target.value)}
                  onBlur={() => {
                    const nextIso = displayDateToIso(startDateInput)
                    if (nextIso) {
                      setStartDate(nextIso)
                      setStartDateInput(isoDateToDisplay(nextIso))
                    }
                  }}
                />
              </label>
              <label className="backtest-run-field backtest-run-field-date">
                <span>End</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD-MM-YYYY"
                  value={endDateInput}
                  onChange={(event) => setEndDateInput(event.target.value)}
                  onBlur={() => {
                    const nextIso = displayDateToIso(endDateInput)
                    if (nextIso) {
                      setEndDate(nextIso)
                      setEndDateInput(isoDateToDisplay(nextIso))
                    }
                  }}
                />
              </label>
              <label className="backtest-run-field backtest-run-field-allocation">
                <span>Allocation</span>
                <select value={allocationMode} onChange={(event) => setAllocationMode(event.target.value as AllocationMode)}>
                  <option value="split_total">Split Total</option>
                  <option value="per_stock">Per Stock</option>
                  <option value="custom">Stock Wise</option>
                </select>
              </label>
              {allocationMode !== 'custom' ? (
                <label className="backtest-run-field backtest-run-field-capital">
                  <span>{allocationMode === 'split_total' ? 'Total Capital' : 'Per Stock Capital'}</span>
                  <input
                    value={initialCapital}
                    onChange={(event) => setInitialCapital(event.target.value.replace(/[^0-9.]/g, ''))}
                  />
                </label>
              ) : (
                <div className="backtest-run-metric">
                  <span>Total Deployed</span>
                  <strong>{`\u20B9${formatCurrencyDisplay(customCapitalTotal)}`}</strong>
                </div>
              )}
              <div className="backtest-run-metric backtest-run-summary">
                <span>{allocationMode === 'per_stock' ? 'Portfolio Total' : 'Capital View'}</span>
                <strong>
                  {allocationMode === 'custom'
                    ? allocationSummary
                    : `\u20B9${formatCurrencyDisplay(
                      allocationMode === 'per_stock'
                        ? effectiveTotalCapital
                        : instruments.length > 0
                          ? effectiveTotalCapital / instruments.length
                          : 0,
                    )}`}
                </strong>
                <small>{allocationSummary}</small>
              </div>
            </div>
            {allocationMode === 'custom' ? (
              <div className="backtest-run-inline-expand">
                {instruments.length > 0 ? instruments.map((symbol) => (
                  <label key={symbol} className="backtest-run-field backtest-custom-allocation-field">
                    <span>{symbol}</span>
                    <input
                      value={customCapitalBySymbol[symbol] ?? ''}
                      onChange={(event) => setCustomCapitalBySymbol((prev) => ({ ...prev, [symbol]: event.target.value.replace(/[^0-9.]/g, '') }))}
                    />
                  </label>
                )) : (
                  <div className="backtest-custom-empty">Add stocks first to allocate custom capital.</div>
                )}
              </div>
            ) : null}
          </form>

          <section className="backtest-kpi-strip">
            <div><span>Net PnL</span><strong className={(portfolio?.net_pnl ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'}>{portfolio ? `${portfolio.net_pnl >= 0 ? '+' : ''}₹${portfolio.net_pnl.toFixed(2)}` : '--'}</strong></div>
            <div><span>Return</span><strong className={(portfolio?.return_pct ?? 0) >= 0 ? 'pnl-pos' : 'pnl-neg'}>{portfolio ? `${portfolio.return_pct >= 0 ? '+' : ''}${portfolio.return_pct.toFixed(2)}%` : '--'}</strong></div>
            <div><span>Trades</span><strong>{portfolio?.total_trades ?? '--'}</strong></div>
            <div><span>Win Rate</span><strong>{portfolio ? `${portfolio.win_rate_pct.toFixed(2)}%` : '--'}</strong></div>
            <div><span>Drawdown</span><strong className="pnl-neg">{portfolio ? `${portfolio.max_drawdown_pct.toFixed(2)}%` : '--'}</strong></div>
            <div><span>Profit Factor</span><strong>{portfolio?.profit_factor != null ? portfolio.profit_factor.toFixed(2) : '--'}</strong></div>
          </section>

          <section className="backtest-workstation-grid">
            <div className="backtest-left-stack">
              <article className="builder-paper backtest-compact-card">
                <div className="builder-paper-head">
                  <span className="builder-paper-num">1</span>
                  <div className="builder-paper-head-copy"><h2>Entry</h2><span>{entryConditionCount} rules - depth {entryDepth}</span></div>
                  <button type="button" className="backtest-card-toggle" onClick={() => setBacktestEntryOpen((open) => !open)}>{backtestEntryOpen ? 'Done' : 'Advanced'}</button>
                </div>
                <div className="backtest-card-controls">
                  <div className="backtest-preset-row" aria-label="Entry presets">
                    <div className="backtest-indicator-search">
                      <input
                        className="backtest-search-input"
                        placeholder="Search entry indicator"
                        value={entryIndicatorSearchQuery}
                        onChange={(event) => {
                          setEntryIndicatorSearchQuery(event.target.value)
                          setEntryIndicatorSearchOpen(true)
                        }}
                        onFocus={() => {
                          if (entryIndicatorSearchCloseTimerRef.current != null) {
                            window.clearTimeout(entryIndicatorSearchCloseTimerRef.current)
                            entryIndicatorSearchCloseTimerRef.current = null
                          }
                          setEntryIndicatorSearchOpen(true)
                        }}
                        onBlur={() => {
                          entryIndicatorSearchCloseTimerRef.current = window.setTimeout(() => {
                            setEntryIndicatorSearchOpen(false)
                          }, 120)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown' && filteredEntryIndicators.length > 0) {
                            event.preventDefault()
                            setEntryIndicatorSearchActiveIndex((current) => Math.min(current + 1, filteredEntryIndicators.length - 1))
                            return
                          }
                          if (event.key === 'ArrowUp' && filteredEntryIndicators.length > 0) {
                            event.preventDefault()
                            setEntryIndicatorSearchActiveIndex((current) => Math.max(current - 1, 0))
                            return
                          }
                          if (event.key === 'Escape') {
                            setEntryIndicatorSearchOpen(false)
                            return
                          }
                          if (event.key === 'Enter' && filteredEntryIndicators[entryIndicatorSearchActiveIndex]) {
                            event.preventDefault()
                            selectEntryIndicator(filteredEntryIndicators[entryIndicatorSearchActiveIndex].type)
                          }
                        }}
                      />
                      {entryIndicatorSearchOpen ? (
                        <div className="backtest-indicator-search-results">
                          {filteredEntryIndicators.slice(0, 10).map((indicator, index) => (
                            <button
                              key={indicator.type}
                              type="button"
                              className={index === entryIndicatorSearchActiveIndex ? 'backtest-indicator-search-result active' : 'backtest-indicator-search-result'}
                              onMouseDown={(event) => {
                                event.preventDefault()
                                selectEntryIndicator(indicator.type)
                              }}
                              onMouseEnter={() => setEntryIndicatorSearchActiveIndex(index)}
                            >
                              <strong>{indicator.label}</strong>
                              <span>{indicator.type} / {indicator.category.replace(/_/g, ' ')}</span>
                            </button>
                          ))}
                          {filteredEntryIndicators.length === 0 ? (
                            <div className="conditions-empty">No matching indicators.</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="backtest-rule-toolbar">
                    <span>Side</span>
                    <div className="builder-radio-row">
                      <button type="button" className={entrySide === 'BUY' ? 'builder-radio is-buy active' : 'builder-radio is-buy'} onClick={() => setEntrySide('BUY')}><span className="dot" />BUY</button>
                      <button type="button" className={entrySide === 'SELL' ? 'builder-radio is-sell active' : 'builder-radio is-sell'} onClick={() => setEntrySide('SELL')}><span className="dot" />SELL</button>
                    </div>
                  </div>
                </div>
                {!backtestEntryOpen ? (
                  <EntryConditionSummary catalog={catalog} indicatorByType={indicatorByType} group={entryGroup} />
                ) : null}
                {backtestEntryOpen && entryGroup ? (
                  <div className="backtest-advanced-editor">
                    <ConditionGroupEditor catalog={catalog} indicatorByType={indicatorByType} group={entryGroup} depth={0} allowRemove={false} onLogicChange={setEntryGroupLogic} onAddCondition={addEntryCondition} onAddGroup={addEntryGroup} onUpdateCondition={updateEntryCondition} onRemoveNode={removeEntryNode} />
                  </div>
                ) : null}
                {backtestEntryOpen && !entryGroup ? (
                  <div className="backtest-entry-empty-state">
                    <p>Start with a search above, or create your first rule block here.</p>
                    <div className="builder-add-row">
                      <button type="button" className="builder-outline-btn" onClick={addEntryRootCondition}>
                        + Add Condition
                      </button>
                      <button type="button" className="builder-outline-btn" onClick={addEntryRootGroup}>
                        + Add Nested Group
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>

              <article className="builder-paper backtest-compact-card">
                <div className="builder-paper-head">
                  <span className="builder-paper-num">2</span>
                  <div className="builder-paper-head-copy"><h2>Exit</h2><span>{exitMode === 'condition' ? `${exitConditionCount} rules - depth ${exitDepth}` : `${stopLossPct}% SL / ${targetPct}% target`}</span></div>
                  <button type="button" className="backtest-card-toggle" onClick={() => setBacktestExitOpen((open) => !open)}>{backtestExitOpen ? 'Done' : 'Advanced'}</button>
                </div>
                <div className="backtest-card-controls backtest-exit-controls">
                  <div className="backtest-preset-row" aria-label="Exit presets">
                    <button type="button" onClick={() => applyExitPreset('rsi')}>RSI Exit</button>
                    <button type="button" onClick={() => applyExitPreset('ema')}>EMA Exit</button>
                    <button type="button" onClick={() => applyExitPreset('stop')}>Stop Loss</button>
                    <button type="button" onClick={() => applyExitPreset('target')}>Target</button>
                    <button type="button" onClick={() => applyExitPreset('condition')}>Condition</button>
                  </div>
                  <div className="builder-mode-chips backtest-mode-strip">
                    {(['condition', 'sl_tgt', 'both'] as ExitMode[]).map((mode) => (
                      <button key={mode} type="button" className={exitMode === mode ? 'builder-chip builder-chip-mode active' : 'builder-chip builder-chip-mode'} onClick={() => setExitMode(mode)}>
                        {mode === 'condition' ? 'Condition' : mode === 'sl_tgt' ? 'SL / Target' : 'Both'}
                      </button>
                    ))}
                  </div>
                </div>
                {exitMode !== 'condition' ? (
                  <div className="backtest-risk-row">
                    <label><span>Stop Loss %</span><input value={stopLossPct} onChange={(event) => setStopLossPct(event.target.value.replace(/[^0-9.]/g, ''))} /></label>
                    <label><span>Target %</span><input value={targetPct} onChange={(event) => setTargetPct(event.target.value.replace(/[^0-9.]/g, ''))} /></label>
                  </div>
                ) : null}
                {!backtestExitOpen && exitMode !== 'sl_tgt' && exitPrimaryCondition ? (
                  <BacktestQuickConditionEditor catalog={catalog} indicatorByType={indicatorByType} condition={exitPrimaryCondition} onChange={updatePrimaryExitCondition} />
                ) : null}
                {backtestExitOpen && exitMode !== 'sl_tgt' && exitGroup ? (
                  <div className="backtest-advanced-editor">
                    <ConditionGroupEditor catalog={catalog} indicatorByType={indicatorByType} group={exitGroup} depth={0} allowRemove={false} onLogicChange={setExitGroupLogic} onAddCondition={addExitCondition} onAddGroup={addExitGroup} onUpdateCondition={updateExitCondition} onRemoveNode={removeExitNode} />
                  </div>
                ) : null}
              </article>
            </div>

            <div className="backtest-right-stack">
              <article className="builder-paper backtest-chart-card">
                <div className="builder-preview-head">
                  <div className="builder-preview-head-copy"><h3>{backtestResult ? 'Equity Curve' : 'Chart Preview'}</h3><span>{primaryInstrument ? `${exchange} / ${intervalValue}` : 'Select an instrument'}</span></div>
                  <div className="builder-preview-price">{backtestResult ? (portfolio ? `${portfolio.return_pct.toFixed(2)}%` : '--') : formatPrice(previewChart?.last_price)}</div>
                </div>
                <div className="builder-preview-frame backtest-chart-frame">
                  {backtestResult ? (
                    <EquityCurveChart points={backtestResult.portfolio.equity_curve} />
                  ) : !primaryInstrument ? (
                    <div className="builder-preview-state"><strong>No instrument selected</strong><span>Add a symbol to load historical candles.</span></div>
                  ) : previewLoading ? (
                    <div className="builder-preview-state"><strong>Loading preview...</strong><span>Fetching normalized candles for {primaryInstrument}.</span></div>
                  ) : previewError ? (
                    <div className="builder-preview-state builder-preview-state-error"><strong>Preview unavailable</strong><span>{previewError}</span></div>
                  ) : previewChart && previewChart.candles.length > 0 ? (
                    <StrategyPreviewChart candles={previewChart.candles} interval={previewChart.interval} />
                  ) : (
                    <div className="builder-preview-state"><strong>No candles available</strong><span>Try another instrument or timeframe.</span></div>
                  )}
                </div>
                {backtestError ? <section className="error-banner">{backtestError}</section> : null}
              </article>

              <article className="builder-paper backtest-results-card">
                <div className="backtest-results-nav">
                  {([
                    ['overview', 'Overview'],
                    ['trades', `Trades ${selectedInstrumentResult?.trades.length ?? 0}`],
                    ['signals', `Signals ${selectedInstrumentResult?.triggered_days.length ?? 0}`],
                  ] as const).map(([tab, label]) => (
                    <button key={tab} type="button" className={backtestResultsTab === tab ? 'active' : ''} onClick={() => setBacktestResultsTab(tab)}>{label}</button>
                  ))}
                </div>
                {!backtestResult ? (
                  <div className="builder-preview-state"><strong>No backtest yet</strong><span>Configure rules and run the backtest.</span></div>
                ) : backtestResultsTab === 'overview' ? (
                  <div className="metrics-grid metrics-grid-wide backtest-metrics-compact">
                    <div><span>Starting Capital</span><strong>₹{backtestResult.portfolio.starting_capital.toFixed(2)}</strong></div>
                    <div><span>Ending Capital</span><strong className={backtestResult.portfolio.ending_capital >= backtestResult.portfolio.starting_capital ? 'pnl-pos' : 'pnl-neg'}>₹{backtestResult.portfolio.ending_capital.toFixed(2)}</strong></div>
                    <div><span>Gross Profit</span><strong className="pnl-pos">₹{selectedInstrumentResult?.metrics.gross_profit.toFixed(2) ?? '--'}</strong></div>
                    <div><span>Gross Loss</span><strong className="pnl-neg">₹{selectedInstrumentResult?.metrics.gross_loss.toFixed(2) ?? '--'}</strong></div>
                    <div><span>Brokerage</span><strong>₹{backtestResult.portfolio.total_brokerage.toFixed(2)}</strong></div>
                    <div><span>Bars</span><strong>{selectedInstrumentResult?.bars_processed ?? '--'}</strong></div>
                  </div>
                ) : backtestResultsTab === 'trades' ? (
                  <>
                    <div className="trade-table backtest-bounded-table">
                      <div className="trade-row trade-head"><span>Entry</span><span>Exit</span><span>Side</span><span>Qty</span><span>Entry Px</span><span>Exit Px</span><span>PnL</span><span>PnL %</span><span>Reason</span></div>
                      {visibleTrades.length === 0 ? <div className="conditions-empty">No trades in this range.</div> : visibleTrades.map((trade, idx) => (
                        <div className="trade-row" key={`${trade.entry_timestamp}-${idx}`}><span>{trade.entry_timestamp}</span><span>{trade.exit_timestamp}</span><span>{trade.side}</span><span>{trade.quantity.toFixed(2)}</span><span>₹{trade.entry_price.toFixed(2)}</span><span>₹{trade.exit_price.toFixed(2)}</span><span className={trade.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}</span><span className={trade.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>{trade.pnl_pct.toFixed(2)}%</span><span>{trade.exit_reason.replace(/_/g, ' ')}</span></div>
                      ))}
                    </div>
                    {selectedInstrumentResult && selectedInstrumentResult.trades.length > 20 ? <button type="button" className="backtest-view-more" onClick={() => setShowAllBacktestTrades((show) => !show)}>{showAllBacktestTrades ? 'Show first 20' : `View all ${selectedInstrumentResult.trades.length}`}</button> : null}
                  </>
                ) : (
                  <div className="trade-table backtest-bounded-table">
                    <div className="trade-row trade-head trade-head-signal"><span>Timestamp</span><span>Close</span><span>Action</span><span>Entry?</span><span>Exit?</span><span>State</span><span>SL</span><span>TGT</span></div>
                    {!selectedInstrumentResult || selectedInstrumentResult.triggered_days.length === 0 ? <div className="conditions-empty">No signal executions in this range.</div> : selectedInstrumentResult.triggered_days.slice(-200).map((row, idx) => (
                      <div className="trade-row trade-row-triggered" key={`${row.timestamp}-${idx}`}><span>{row.timestamp}</span><span>₹{row.close.toFixed(2)}</span><span>{row.action.replace(/_/g, ' ')}</span><span>{row.entry_signal ? 'Yes' : '-'}</span><span>{row.exit_signal ? 'Yes' : '-'}</span><span>{row.position_state.replace(/_/g, ' ')}</span><span>{row.stop_loss_price != null ? `₹${row.stop_loss_price.toFixed(2)}` : '-'}</span><span>{row.target_price != null ? `₹${row.target_price.toFixed(2)}` : '-'}</span></div>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </section>
          <section className="backtest-run-footer">
            {backtestError ? <section className="error-banner">{backtestError}</section> : null}
            <button className="primary-button" type="submit" form="backtest-lab-run-form" disabled={backtestRunning}>{backtestRunning ? 'Running Backtest...' : 'Run Backtest'}</button>
          </section>

          {backtestResult && portfolio ? (
            <section id="backtest-results-section" className="backtest-results-section">
              <div className="backtest-results-head">
                <div>
                  <span className="subview-page-crumb-label">Generated Results</span>
                  <h2>Backtest Results</h2>
                </div>
                <button type="button" className="secondary-button" onClick={() => document.getElementById('backtest-lab-run-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Edit Inputs</button>
              </div>
              <section className="backtest-kpi-strip backtest-results-kpis">
                <div><span>Net PnL</span><strong className={portfolio.net_pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{portfolio.net_pnl >= 0 ? '+' : ''}₹{portfolio.net_pnl.toFixed(2)}</strong></div>
                <div><span>Return</span><strong className={portfolio.return_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>{portfolio.return_pct >= 0 ? '+' : ''}{portfolio.return_pct.toFixed(2)}%</strong></div>
                <div><span>Trades</span><strong>{portfolio.total_trades}</strong></div>
                <div><span>Win Rate</span><strong>{portfolio.win_rate_pct.toFixed(2)}%</strong></div>
                <div><span>Drawdown</span><strong className="pnl-neg">{portfolio.max_drawdown_pct.toFixed(2)}%</strong></div>
                <div><span>Profit Factor</span><strong>{portfolio.profit_factor != null ? portfolio.profit_factor.toFixed(2) : '--'}</strong></div>
              </section>
              <div className="backtest-results-nav backtest-results-tabs">
                {([
                  ['overview', 'Overview'],
                  ['trades', 'Trades'],
                  ['signals', 'Signals'],
                ] as const).map(([tab, label]) => (
                  <button key={tab} type="button" className={backtestResultsTab === tab ? 'active' : ''} onClick={() => setBacktestResultsTab(tab)}>{label}</button>
                ))}
              </div>
              <div className="backtest-instrument-stack">
                {backtestResult.instruments.map((instrumentResult) => {
                  const displayedTrades = showAllBacktestTrades ? instrumentResult.trades : instrumentResult.trades.slice(0, 20)
                  const displayedSignals = instrumentResult.triggered_days.slice(-40)
                  return (
                    <article className="builder-paper backtest-instrument-card" key={instrumentResult.symbol}>
                      <div className="backtest-instrument-head">
                        <div>
                          <span className="subview-page-crumb-label">{exchange} / {intervalValue}</span>
                          <h3>{instrumentResult.symbol}</h3>
                        </div>
                        <div className="backtest-instrument-mini">
                          <span>{instrumentResult.metrics.total_trades} trades</span>
                          <strong className={instrumentResult.metrics.return_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>{instrumentResult.metrics.return_pct >= 0 ? '+' : ''}{instrumentResult.metrics.return_pct.toFixed(2)}%</strong>
                        </div>
                      </div>
                      {instrumentResult.warning ? <div className="conditions-empty">{instrumentResult.warning}</div> : null}
                      {instrumentResult.equity_curve.length > 1 ? (
                        <div className="backtest-result-chart">
                          <EquityCurveChart points={instrumentResult.equity_curve} />
                        </div>
                      ) : null}
                      {backtestResultsTab === 'overview' ? (
                        <div className="metrics-grid metrics-grid-wide backtest-metrics-compact">
                          <div><span>Starting Capital</span><strong>₹{instrumentResult.metrics.starting_capital.toFixed(2)}</strong></div>
                          <div><span>Ending Capital</span><strong className={instrumentResult.metrics.ending_capital >= instrumentResult.metrics.starting_capital ? 'pnl-pos' : 'pnl-neg'}>₹{instrumentResult.metrics.ending_capital.toFixed(2)}</strong></div>
                          <div><span>Net PnL</span><strong className={instrumentResult.metrics.net_pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{instrumentResult.metrics.net_pnl >= 0 ? '+' : ''}₹{instrumentResult.metrics.net_pnl.toFixed(2)}</strong></div>
                          <div><span>Win Rate</span><strong>{instrumentResult.metrics.win_rate_pct.toFixed(2)}%</strong></div>
                          <div><span>Profit Factor</span><strong>{instrumentResult.metrics.profit_factor != null ? instrumentResult.metrics.profit_factor.toFixed(2) : '--'}</strong></div>
                          <div><span>Max Drawdown</span><strong className="pnl-neg">{instrumentResult.metrics.max_drawdown_pct.toFixed(2)}%</strong></div>
                          <div><span>Gross Profit</span><strong className="pnl-pos">₹{instrumentResult.metrics.gross_profit.toFixed(2)}</strong></div>
                          <div><span>Gross Loss</span><strong className="pnl-neg">₹{instrumentResult.metrics.gross_loss.toFixed(2)}</strong></div>
                          <div><span>Bars</span><strong>{instrumentResult.bars_processed}</strong></div>
                        </div>
                      ) : backtestResultsTab === 'trades' ? (
                        <>
                          <div className="trade-table backtest-bounded-table">
                            <div className="trade-row trade-head"><span>Entry</span><span>Exit</span><span>Side</span><span>Qty</span><span>Entry Px</span><span>Exit Px</span><span>PnL</span><span>PnL %</span><span>Reason</span></div>
                            {displayedTrades.length === 0 ? <div className="conditions-empty">No trades in this range.</div> : displayedTrades.map((trade, idx) => (
                              <div className="trade-row" key={`${instrumentResult.symbol}-${trade.entry_timestamp}-${idx}`}><span>{trade.entry_timestamp}</span><span>{trade.exit_timestamp}</span><span>{trade.side}</span><span>{trade.quantity.toFixed(2)}</span><span>₹{trade.entry_price.toFixed(2)}</span><span>₹{trade.exit_price.toFixed(2)}</span><span className={trade.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}>{trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}</span><span className={trade.pnl_pct >= 0 ? 'pnl-pos' : 'pnl-neg'}>{trade.pnl_pct.toFixed(2)}%</span><span>{trade.exit_reason.replace(/_/g, ' ')}</span></div>
                            ))}
                          </div>
                          {instrumentResult.trades.length > 20 ? <button type="button" className="backtest-view-more" onClick={() => setShowAllBacktestTrades((show) => !show)}>{showAllBacktestTrades ? 'Show first 20' : `View all ${instrumentResult.trades.length}`}</button> : null}
                        </>
                      ) : (
                        <div className="trade-table backtest-bounded-table">
                          <div className="trade-row trade-head trade-head-signal"><span>Timestamp</span><span>Close</span><span>Action</span><span>Entry?</span><span>Exit?</span><span>State</span><span>SL</span><span>TGT</span></div>
                          {displayedSignals.length === 0 ? <div className="conditions-empty">No signal executions in this range.</div> : displayedSignals.map((row, idx) => (
                            <div className="trade-row trade-row-triggered" key={`${instrumentResult.symbol}-${row.timestamp}-${idx}`}><span>{row.timestamp}</span><span>₹{row.close.toFixed(2)}</span><span>{row.action.replace(/_/g, ' ')}</span><span>{row.entry_signal ? 'Yes' : '-'}</span><span>{row.exit_signal ? 'Yes' : '-'}</span><span>{row.position_state.replace(/_/g, ' ')}</span><span>{row.stop_loss_price != null ? `₹${row.stop_loss_price.toFixed(2)}` : '-'}</span><span>{row.target_price != null ? `₹${row.target_price.toFixed(2)}` : '-'}</span></div>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    )
  }

  return (
    <div className="subview-shell">
      {renderNav('Dashboard')}
      <main className={`subview-main strategy-builder-subview-main strategy-builder-workspace${isBacktestMode ? ' backtest-lab-main' : ''}`}>
        {renderPageHeader(
          pageSubtitle,
          !isBacktestMode && liveStatus?.running ? (
            <button type="button" className="secondary-button" onClick={handleStopLive} disabled={liveBusy}>
              {liveBusy ? 'Stopping...' : 'Stop Live'}
            </button>
          ) : undefined,
        )}

        <form className={`strategy-builder strategy-wire-builder${isBacktestMode ? ' backtest-lab-form' : ''}`} onSubmit={handleRunBacktest}>
          {isBacktestMode ? (
            <section className="backtest-run-strip" aria-label="Quick backtest controls">
              <div className="backtest-run-symbol">
                <span>Symbol</span>
                <div className="backtest-run-symbol-input">
                  <input
                    list="strategy-stock-suggestions"
                    placeholder="Search ticker"
                    value={instrumentQuery}
                    onChange={(event) => setInstrumentQuery(event.target.value.toUpperCase())}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addInstrument()
                      }
                    }}
                  />
                  <button type="button" className="builder-outline-btn" onClick={addInstrument}>Add</button>
                </div>
                <small>{instruments.length ? instruments.join(', ') : 'No symbol added yet'}</small>
              </div>
              <label>
                <span>Timeframe</span>
                <select value={intervalValue} onChange={(event) => setIntervalValue(event.target.value as Interval)}>
                  {INTERVAL_CHOICES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>Start</span>
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label>
                <span>End</span>
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <label>
                <span>Capital</span>
                <input value={initialCapital} onChange={(event) => setInitialCapital(event.target.value.replace(/[^0-9.]/g, ''))} />
              </label>
              <button className="primary-button" type="submit" disabled={backtestRunning}>
                {backtestRunning ? 'Running...' : 'Run Backtest'}
              </button>
              <details className="backtest-assumptions">
                <summary>Assumptions</summary>
                <div className="backtest-assumption-grid">
                  <label>
                    <span>Session</span>
                    <select value={holdingType} onChange={(event) => setHoldingType(event.target.value as 'intraday' | 'positional')}>
                      <option value="positional">Regular hours</option>
                      <option value="intraday">Intraday only</option>
                    </select>
                  </label>
                  <label>
                    <span>Exchange</span>
                    <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
                      <option value="NSE">NSE</option>
                      <option value="BSE">BSE</option>
                    </select>
                  </label>
                  <label>
                    <span>Type</span>
                    <select value={instrumentType} onChange={(event) => setInstrumentType(event.target.value)}>
                      <option value="STOCK">STOCK</option>
                      <option value="INDEX">INDEX</option>
                    </select>
                  </label>
                  <label>
                    <span>Execution</span>
                    <select value={executionStyle} onChange={(event) => setExecutionStyle(event.target.value as 'same_bar_close' | 'next_bar_open')}>
                      <option value="same_bar_close">Same Bar Close</option>
                      <option value="next_bar_open">Next Bar Open</option>
                    </select>
                  </label>
                  <label className="backtest-assumption-check">
                    <input type="checkbox" checked={brokerageEnabled} onChange={(event) => setBrokerageEnabled(event.target.checked)} />
                    <span>Brokerage</span>
                  </label>
                </div>
              </details>
            </section>
          ) : null}

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

          <article className={`builder-paper${isBacktestMode ? ' backtest-rule-card' : ''}`}>
            <div className="builder-paper-head">
              <span className="builder-paper-num">2</span>
              <div className="builder-paper-head-copy">
                <h2>Entry Conditions</h2>
                <span>Define the setup that opens a position.</span>
              </div>
              {isBacktestMode ? (
                <button type="button" className="backtest-card-toggle" onClick={() => setBacktestEntryOpen((open) => !open)}>
                  {backtestEntryOpen ? 'Collapse' : 'Edit rules'}
                </button>
              ) : null}
            </div>

            {isBacktestMode && !backtestEntryOpen ? (
              <div className="backtest-rule-summary">
                <strong>{entrySide} setup</strong>
                <span>{entryConditionCount} rule{entryConditionCount === 1 ? '' : 's'} - depth {entryDepth}</span>
              </div>
            ) : (
              <>
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
              <>
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
                {entryCrossTimingHint ? (
                  <div className="builder-status-note">
                    <span>`crosses above/below` only fires on the crossover candle.</span>
                    <span>Inside an AND group, every cross still has to line up on that same candle. For filters like RSI already above 30, use `greater than` / `less than`.</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="conditions-empty">Loading entry builder...</div>
            )}
              </>
            )}
          </article>

          <article className={`builder-paper${isBacktestMode ? ' backtest-rule-card' : ''}`}>
            <div className="builder-paper-head">
              <span className="builder-paper-num">3</span>
              <div className="builder-paper-head-copy">
                <h2>Exit Conditions</h2>
                <span>Control how positions get closed.</span>
              </div>
              {isBacktestMode ? (
                <button type="button" className="backtest-card-toggle" onClick={() => setBacktestExitOpen((open) => !open)}>
                  {backtestExitOpen ? 'Collapse' : 'Edit exits'}
                </button>
              ) : null}
            </div>

            {isBacktestMode && !backtestExitOpen ? (
              <div className="backtest-rule-summary">
                <strong>{exitMode === 'condition' ? 'Condition exit' : exitMode === 'sl_tgt' ? 'SL / Target exit' : 'Condition + SL/TGT exit'}</strong>
                <span>{exitMode === 'sl_tgt' ? `${stopLossPct}% SL / ${targetPct}% target` : `${exitConditionCount} rule${exitConditionCount === 1 ? '' : 's'} - depth ${exitDepth}`}</span>
              </div>
            ) : (
              <>
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
                  <>
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
                    {exitCrossTimingHint ? (
                      <div className="builder-status-note">
                        <span>`crosses above/below` is evaluated as a one-candle event here too.</span>
                        <span>If you want an exit while a value stays above or below a level, switch that rule to `greater than` / `less than`.</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="conditions-empty">Loading exit builder...</div>
                )}
              </>
            ) : null}
              </>
            )}
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

            {!isBacktestMode ? (
              <div className="strategy-row">
                <div className="field-group field-group-wide">
                  <span>Live Execution Environment</span>
                  <div className="side-toggle" role="tablist" aria-label="Live execution environment">
                    <button
                      type="button"
                      className={executionEnvironment === 'PROD' ? 'side-chip active' : 'side-chip'}
                      onClick={() => onExecutionEnvironmentSelect('PROD')}
                    >
                      PROD
                    </button>
                    <button
                      type="button"
                      className={executionEnvironment === 'UAT' ? 'side-chip active' : 'side-chip'}
                      onClick={() => onExecutionEnvironmentSelect('UAT')}
                    >
                      UAT
                    </button>
                  </div>
                  <small className="strategy-inline-note">
                    Market data stays on PROD. Switching execution to UAT will prompt a separate UAT login the first time.
                  </small>
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
              {!isBacktestMode ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleDeployLive}
                  disabled={liveBusy || (liveStatus?.running ?? false)}
                >
                  {liveBusy ? 'Deploying...' : liveStatus?.running ? 'Live Running' : `Deploy Live${executionEnvironment === 'PROD' ? ' (PROD)' : ' (UAT)'}`}
                </button>
              ) : null}
            </div>
                {backtestError ? <section className="error-banner">{backtestError}</section> : null}
                {!isBacktestMode && liveError ? <section className="error-banner">{liveError}</section> : null}
              </article>
            </aside>
          </div>

          {/* ---- RESULTS ---- */}
          {backtestResult ? (
            <>
              {isBacktestMode ? (
                <section className="backtest-results-nav" aria-label="Backtest result sections">
                  {([
                    ['overview', 'Overview'],
                    ['trades', `Trades (${selectedInstrumentResult?.trades.length ?? 0})`],
                    ['signals', `Signals (${selectedInstrumentResult?.triggered_days.length ?? 0})`],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      className={backtestResultsTab === tab ? 'active' : ''}
                      onClick={() => setBacktestResultsTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </section>
              ) : null}

              {/* Portfolio summary */}
              {(!isBacktestMode || backtestResultsTab === 'overview') ? (
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
              ) : null}

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

                    {(!isBacktestMode || backtestResultsTab === 'overview') ? (
                    <>
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
                    </>
                    ) : null}

                    {/* Trades table */}
                    {(!isBacktestMode || backtestResultsTab === 'trades') ? (
                    <>
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
                        (isBacktestMode && !showAllBacktestTrades ? selectedInstrumentResult.trades.slice(0, 20) : selectedInstrumentResult.trades).map((trade, idx) => (
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
                    {isBacktestMode && selectedInstrumentResult.trades.length > 20 ? (
                      <button
                        type="button"
                        className="backtest-view-more"
                        onClick={() => setShowAllBacktestTrades((show) => !show)}
                      >
                        {showAllBacktestTrades ? 'Show first 20 trades' : `View all ${selectedInstrumentResult.trades.length} trades`}
                      </button>
                    ) : null}
                    </>
                    ) : null}

                    {/* Execution log — collapsible, hidden by default */}
                    {(!isBacktestMode || backtestResultsTab === 'signals') ? (
                    <>
                    <div
                      className="conditions-header"
                      style={{ marginTop: '1.25rem', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => setExecLogOpen((prev) => !prev)}
                    >
                      <span>
                        {execLogOpen ? '▾' : '▸'} Execution Log — {selectedInstrumentResult.triggered_days.length} triggered bars
                      </span>
                    </div>
                    {execLogOpen ? (
                      <div className="trade-table backtest-bounded-table">
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
                        {selectedInstrumentResult.triggered_days.length === 0 ? (
                          <div className="conditions-empty">No trade executions in this range.</div>
                        ) : (
                          selectedInstrumentResult.triggered_days
                            .slice(-200)
                            .map((row, idx) => (
                              <div className="trade-row trade-row-triggered" key={`${row.timestamp}-${idx}`}>
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
                    ) : null}
                  </>
                ) : null}
                  </>
                ) : null}
              </article>
            </>
          ) : null}

          {/* ---- LIVE RUNNER STATUS ---- */}
          {!isBacktestMode && liveStatus?.running ? (
            <article className="dashboard-module-card strategy-card">
              <header className="strategy-card-head">
                <h2>Live Runner</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {liveStatus.environment ? (
                    <span className={`strategy-badge${liveStatus.environment === 'PROD' ? ' env-prod-badge' : ' env-uat-badge'}`}>
                      {liveStatus.environment}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="primary-button"
                    style={{
                      background: 'var(--color-neg, #ef4444)',
                      borderColor: 'var(--color-neg, #ef4444)',
                      fontSize: '0.8rem',
                      padding: '0.4rem 1rem',
                    }}
                    onClick={handleStopLive}
                    disabled={liveBusy}
                  >
                    {liveBusy ? 'Stopping...' : '⏹ Stop Live Strategy'}
                  </button>
                </div>
              </header>
              <div className="status-list">
                <div><span>Status</span><strong style={{ color: 'var(--color-pos, #22c55e)' }}>● Running</strong></div>
                <div><span>Environment</span><strong className={liveStatus.environment === 'PROD' ? 'pnl-neg' : 'pnl-pos'}>{liveStatus.environment ?? '-'}</strong></div>
                <div><span>Market</span><strong>{liveStatus.market_status}</strong></div>
                <div><span>Instruments</span><strong>{liveStatus.instruments.join(', ')}</strong></div>
                <div><span>Interval</span><strong>{liveStatus.interval}</strong></div>
                <div><span>Entry Side</span><strong>{liveStatus.entry_side}</strong></div>
                <div><span>Last Run</span><strong>{liveStatus.last_run_ist ?? '-'}</strong></div>
                <div><span>Next Run</span><strong>{liveStatus.next_run_ist ?? '-'}</strong></div>
                <div><span>Last Signal</span><strong>{liveStatus.last_signal ?? '-'}</strong></div>
                {liveStatus.last_error ? (
                  <div><span>Last Error</span><strong className="pnl-neg">{liveStatus.last_error}</strong></div>
                ) : null}
              </div>

              {Object.keys(liveStatus.positions).length > 0 ? (
                <>
                  <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>Open Positions</h3>
                  <div className="trade-table">
                    <div className="trade-row trade-head">
                      <span>Instrument</span>
                      <span>Side</span>
                      <span>Qty</span>
                      <span>Entry Price</span>
                      <span>Entry Time</span>
                      <span>Order ID</span>
                    </div>
                    {Object.values(liveStatus.positions).map((pos) => (
                      <div className="trade-row" key={pos.instrument}>
                        <span>{pos.instrument}</span>
                        <span>{pos.entry_side}</span>
                        <span>{pos.quantity}</span>
                        <span>₹{pos.entry_price.toFixed(2)}</span>
                        <span>{pos.entry_time_ist}</span>
                        <span>{pos.entry_order_id ?? '-'}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>Alerts</h3>
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
                      <span>₹{alert.price.toFixed(2)}</span>
                      <span>{alert.candle_time_ist}</span>
                      <span>{alert.detail}</span>
                    </div>
                  ))
                )}
              </div>
            </article>
          ) : null}
        </form>
        {!isBacktestMode ? <PostLoginFooter /> : null}
      </main>
    </div>
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

interface BacktestQuickConditionEditorProps {
  catalog: Catalog
  indicatorByType: Map<string, CatalogIndicator>
  condition: ConditionState
  onChange: (next: ConditionState) => void
}

function summarizeCondition(
  condition: ConditionState,
  catalog: Catalog,
  indicatorByType: Map<string, CatalogIndicator>,
): string {
  const lhs = formatIndicatorExpr(condition.lhs, indicatorByType.get(condition.lhs.type))
  const operator = catalog.operators.find((op) => op.id === condition.operator)?.label ?? condition.operator
  if (condition.rhsKind === 'range') {
    return `${lhs} ${operator} ${condition.rhsLow ?? '-'} to ${condition.rhsHigh ?? '-'}`
  }
  if (condition.rhsKind === 'indicator' && condition.rhsIndicator) {
    const rhs = formatIndicatorExpr(condition.rhsIndicator, indicatorByType.get(condition.rhsIndicator.type))
    return `${lhs} ${operator} ${rhs}`
  }
  return `${lhs} ${operator} ${condition.rhsNumber ?? '-'}`
}

function EntryConditionSummary({
  catalog,
  indicatorByType,
  group,
}: {
  catalog: Catalog
  indicatorByType: Map<string, CatalogIndicator>
  group: ConditionGroupState | null
}) {
  if (!group || group.items.length === 0) {
    return <div className="conditions-empty">Search an entry indicator or open Advanced to build your first entry rule.</div>
  }

  const countNestedConditions = (node: ConditionGroupState): number =>
    node.items.reduce((total, item) => total + (isConditionGroup(item) ? countNestedConditions(item) : 1), 0)

  return (
    <div className="entry-summary-shell">
      <div className="entry-summary-head">
        <span>{group.logic} group</span>
      </div>
      <div className="entry-summary-list">
        {group.items.map((item) => (
          isConditionGroup(item) ? (
            <div key={item.id} className="entry-summary-group">
              <span className="entry-summary-group-label">{item.logic} nested group</span>
              {item.items.map((nestedItem) => (
                isConditionGroup(nestedItem) ? (
                  <div key={nestedItem.id} className="entry-summary-chip">
                    {nestedItem.logic} group with {countNestedConditions(nestedItem)} rules
                  </div>
                ) : (
                  <div key={nestedItem.id} className="entry-summary-chip">
                    {summarizeCondition(nestedItem, catalog, indicatorByType)}
                  </div>
                )
              ))}
            </div>
          ) : (
            <div key={item.id} className="entry-summary-chip">
              {summarizeCondition(item, catalog, indicatorByType)}
            </div>
          )
        ))}
      </div>
    </div>
  )
}

function BacktestQuickConditionEditor({ catalog, indicatorByType, condition, onChange }: BacktestQuickConditionEditorProps) {
  const lhsSpec = indicatorByType.get(condition.lhs.type)
  const rhsRule = rhsRuleForExpr(condition.lhs)
  const operatorChoices = catalog.operators
  const editableParams = lhsSpec?.params.filter((param) => param.key !== 'offset').slice(0, 2) ?? []

  const rhsIndicatorCandidate = condition.rhsIndicator ?? buildDefaultRhsIndicator(condition.lhs, indicatorByType)
  const rhsIndicatorSpec = condition.rhsIndicator ? indicatorByType.get(condition.rhsIndicator.type) : undefined

  function changeOperator(op: OperatorId) {
    let nextKind = condition.rhsKind
    if (catalog.delta_operators.includes(op)) nextKind = 'number'
    else if (catalog.range_operators.includes(op)) nextKind = 'range'
    else nextKind = rhsRule.defaultKind === 'indicator' ? 'indicator' : 'number'

    onChange({
      ...condition,
      operator: op,
      rhsKind: nextKind,
      rhsIndicator: nextKind === 'indicator' ? (condition.rhsIndicator ?? rhsIndicatorCandidate) : condition.rhsIndicator,
    })
  }

  function changeParam(param: CatalogParam, rawValue: string) {
    let value: number | string = rawValue
    if (param.kind === 'int') {
      const parsed = parseInt(rawValue, 10)
      value = Number.isFinite(parsed) ? parsed : rawValue
    } else if (param.kind === 'float') {
      const parsed = parseFloat(rawValue)
      value = Number.isFinite(parsed) ? parsed : rawValue
    }

    const nextLhs = { ...condition.lhs, params: { ...condition.lhs.params, [param.key]: value } }
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

  function setRhsNumber(value: string) {
    onChange({ ...condition, rhsNumber: value.replace(/[^0-9.\-]/g, '') })
  }

  if (!lhsSpec) return <div className="conditions-empty">Unknown condition.</div>

  return (
    <div className="backtest-quick-condition">
      <div className="backtest-quick-main">
        <span>When</span>
        <strong>{lhsSpec.label}</strong>
        <select value={condition.operator} onChange={(event) => changeOperator(event.target.value as OperatorId)}>
          {operatorChoices.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
        </select>
        {condition.rhsKind === 'range' ? (
          <div className="backtest-range-mini">
            <input value={condition.rhsLow ?? ''} onChange={(event) => onChange({ ...condition, rhsLow: event.target.value.replace(/[^0-9.\-]/g, '') })} placeholder="Low" />
            <input value={condition.rhsHigh ?? ''} onChange={(event) => onChange({ ...condition, rhsHigh: event.target.value.replace(/[^0-9.\-]/g, '') })} placeholder="High" />
          </div>
        ) : condition.rhsKind === 'indicator' && condition.rhsIndicator ? (
          <strong className="backtest-rhs-pill">{formatIndicatorExpr(condition.rhsIndicator, rhsIndicatorSpec)}</strong>
        ) : (
          <input value={condition.rhsNumber ?? ''} onChange={(event) => setRhsNumber(event.target.value)} placeholder="Value" />
        )}
      </div>
      <div className="backtest-param-strip">
        {editableParams.map((param) => {
          const value = condition.lhs.params[param.key] ?? param.default
          if (param.kind === 'source' || param.kind === 'enum') {
            return (
              <label key={param.key}>
                <span>{param.label}</span>
                <select value={String(value)} onChange={(event) => changeParam(param, event.target.value)}>
                  {param.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                </select>
              </label>
            )
          }
          return (
            <label key={param.key}>
              <span>{param.label}</span>
              <input value={String(value)} onChange={(event) => changeParam(param, event.target.value)} />
            </label>
          )
        })}
        <label>
          <span>Bars Back</span>
          <input
            value={condition.lhs.offset}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              onChange({ ...condition, lhs: { ...condition.lhs, offset: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 } })
            }}
          />
        </label>
      </div>
    </div>
  )
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
