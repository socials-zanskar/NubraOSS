// ─── Custom Indicator Builder — State Management + Compute Engine ─────────────
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  SavedIndicator,
  IndicatorPreset,
  OhlcvCandle,
  IndicatorComputeResult,
  ComputedOverlay,
  ComputedSignals,
  ComputedLinePoint,
  EmaParams,
  RsiParams,
  SupertrendParams,
  VolumeMAParams,
} from '../types/indicators'

const STORAGE_KEY = 'nubraoss.indicators'

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadFromStorage(): SavedIndicator[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SavedIndicator[]
  } catch {
    return []
  }
}

function saveToStorage(indicators: SavedIndicator[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(indicators))
  } catch {
    // storage quota exceeded — silently ignore
  }
}

function uid(): string {
  return `ind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function calcEma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return result
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = ema
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

function calcSma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    result[i] = sum / period
  }
  return result
}

function calcVwap(candles: OhlcvCandle[]): (number | null)[] {
  // session-anchored VWAP — resets at IST day boundary.
  // candle.time is already in IST epoch seconds (UTC + 19800), so we just floor-divide by 86400
  // to get the IST calendar day — no additional offset needed.
  const result: (number | null)[] = new Array(candles.length).fill(null)
  let cumPV = 0
  let cumVol = 0
  let currentDay = -1

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const istDay = Math.floor(c.time / 86400)   // c.time already in IST seconds
    if (istDay !== currentDay) {
      cumPV = 0
      cumVol = 0
      currentDay = istDay
    }
    const typical = (c.high + c.low + c.close) / 3
    cumPV += typical * c.volume
    cumVol += c.volume
    result[i] = cumVol > 0 ? cumPV / cumVol : c.close
  }
  return result
}

function calcRsi(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return result

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss += Math.abs(diff)
  }
  avgGain /= period
  avgLoss /= period

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  result[period] = 100 - 100 / (1 + rs)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rsiRs = avgLoss === 0 ? 100 : avgGain / avgLoss
    result[i] = 100 - 100 / (1 + rsiRs)
  }
  return result
}

function calcAtr(candles: OhlcvCandle[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null)
  if (candles.length < 2) return result

  const tr: number[] = [candles[0].high - candles[0].low]
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    const prev = candles[i - 1]
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)))
  }

  // Wilder smoothing
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = atr
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period
    result[i] = atr
  }
  return result
}

function calcSupertrend(
  candles: OhlcvCandle[],
  atrPeriod: number,
  multiplier: number,
): { line: (number | null)[]; direction: (1 | -1 | null)[] } {
  const atrValues = calcAtr(candles, atrPeriod)
  const line: (number | null)[] = new Array(candles.length).fill(null)
  const direction: (1 | -1 | null)[] = new Array(candles.length).fill(null)

  let upperBand = 0
  let lowerBand = 0
  let prevUpperBand = 0
  let prevLowerBand = 0
  let prevSupertrend = 0
  let prevClose = 0

  for (let i = atrPeriod - 1; i < candles.length; i++) {
    const c = candles[i]
    const atr = atrValues[i]
    if (atr === null) continue

    const hl2 = (c.high + c.low) / 2
    const basicUpper = hl2 + multiplier * atr
    const basicLower = hl2 - multiplier * atr

    upperBand =
      basicUpper < prevUpperBand || prevClose > prevUpperBand ? basicUpper : prevUpperBand
    lowerBand =
      basicLower > prevLowerBand || prevClose < prevLowerBand ? basicLower : prevLowerBand

    let supertrend: number
    let dir: 1 | -1

    if (i === atrPeriod - 1) {
      supertrend = c.close > hl2 ? lowerBand : upperBand
      dir = c.close > hl2 ? 1 : -1
    } else {
      if (prevSupertrend === prevUpperBand) {
        dir = c.close > upperBand ? 1 : -1
      } else {
        dir = c.close < lowerBand ? -1 : 1
      }
      supertrend = dir === 1 ? lowerBand : upperBand
    }

    line[i] = supertrend
    direction[i] = dir

    prevUpperBand = upperBand
    prevLowerBand = lowerBand
    prevSupertrend = supertrend
    prevClose = c.close
  }

  return { line, direction }
}

// ─── Main compute function ────────────────────────────────────────────────────

export function computeIndicator(
  indicator: SavedIndicator,
  candles: OhlcvCandle[],
): IndicatorComputeResult {
  if (candles.length === 0) return { overlays: [], signals: [] }

  const overlays: ComputedOverlay[] = []
  const signals: ComputedSignals[] = []
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const times = candles.map((c) => c.time)

  function toPoints(values: (number | null)[]): ComputedLinePoint[] {
    return values
      .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
      .filter((p): p is ComputedLinePoint => p !== null)
  }

  const { params } = indicator

  switch (params.type) {
    case 'ema': {
      const { fastPeriod, slowPeriod } = params as EmaParams
      const fast = calcEma(closes, fastPeriod)
      const slow = calcEma(closes, slowPeriod)

      const fastLine = indicator.lines.find((l) => l.id === 'fast')
      const slowLine = indicator.lines.find((l) => l.id === 'slow')

      if (fastLine) {
        overlays.push({
          indicatorId: indicator.id,
          lineId: 'fast',
          overlayType: 'line',
          color: fastLine.color,
          thickness: fastLine.thickness,
          points: toPoints(fast),
        })
      }
      if (slowLine) {
        overlays.push({
          indicatorId: indicator.id,
          lineId: 'slow',
          overlayType: 'line',
          color: slowLine.color,
          thickness: slowLine.thickness,
          points: toPoints(slow),
        })
      }

      // Cross signals
      const buySignals: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      const sellSignals: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      for (let i = 1; i < candles.length; i++) {
        const f0 = fast[i - 1]; const f1 = fast[i]
        const s0 = slow[i - 1]; const s1 = slow[i]
        if (f0 !== null && f1 !== null && s0 !== null && s1 !== null) {
          const crossUp = f0 < s0 && f1 > s1
          const crossDown = f0 > s0 && f1 < s1
          if (indicator.signal.buyCondition === 'ema_cross_up' && crossUp) {
            buySignals.push({ time: times[i], price: closes[i], side: 'buy', label: 'EMA ↑' })
          }
          if (indicator.signal.sellCondition === 'ema_cross_down' && crossDown) {
            sellSignals.push({ time: times[i], price: closes[i], side: 'sell', label: 'EMA ↓' })
          }
        }
      }

      signals.push({
        indicatorId: indicator.id,
        signals: [...buySignals, ...sellSignals].sort((a, b) => a.time - b.time),
        buyMarkerColor: indicator.signal.buyMarkerColor,
        sellMarkerColor: indicator.signal.sellMarkerColor,
      })
      break
    }

    case 'sma': {
      const smaValues = calcSma(closes, (params as { period: number }).period)
      const line = indicator.lines.find((l) => l.id === 'sma')
      if (line) {
        overlays.push({
          indicatorId: indicator.id,
          lineId: 'sma',
          overlayType: 'line',
          color: line.color,
          thickness: line.thickness,
          points: toPoints(smaValues),
        })
      }
      signals.push({ indicatorId: indicator.id, signals: [], buyMarkerColor: indicator.signal.buyMarkerColor, sellMarkerColor: indicator.signal.sellMarkerColor })
      break
    }

    case 'vwap': {
      const vwapValues = calcVwap(candles)
      const line = indicator.lines.find((l) => l.id === 'vwap')
      if (line) {
        overlays.push({
          indicatorId: indicator.id,
          lineId: 'vwap',
          overlayType: 'line',
          color: line.color,
          thickness: line.thickness,
          points: toPoints(vwapValues),
        })
      }

      // VWAP breakout signals
      const sigs: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      for (let i = 1; i < candles.length; i++) {
        const v0 = vwapValues[i - 1]; const v1 = vwapValues[i]
        if (v0 !== null && v1 !== null) {
          if (indicator.signal.buyCondition === 'price_above_vwap' && closes[i - 1] < v0 && closes[i] > v1) {
            sigs.push({ time: times[i], price: closes[i], side: 'buy', label: 'VWAP ↑' })
          }
          if (indicator.signal.sellCondition === 'price_below_vwap' && closes[i - 1] > v0 && closes[i] < v1) {
            sigs.push({ time: times[i], price: closes[i], side: 'sell', label: 'VWAP ↓' })
          }
        }
      }
      signals.push({ indicatorId: indicator.id, signals: sigs, buyMarkerColor: indicator.signal.buyMarkerColor, sellMarkerColor: indicator.signal.sellMarkerColor })
      break
    }

    case 'rsi': {
      const { period, overboughtLevel, oversoldLevel } = params as RsiParams
      const rsiValues = calcRsi(closes, period)
      // RSI shown as overlay levels on price chart using horizontal reference lines
      // We emit the overbought/oversold thresholds as signals instead of sub-pane
      const sigs: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      for (let i = 1; i < candles.length; i++) {
        const r0 = rsiValues[i - 1]; const r1 = rsiValues[i]
        if (r0 !== null && r1 !== null) {
          if (indicator.signal.buyCondition === 'rsi_oversold' && r0 > oversoldLevel && r1 <= oversoldLevel) {
            sigs.push({ time: times[i], price: closes[i], side: 'buy', label: `RSI ${r1.toFixed(1)}` })
          }
          if (indicator.signal.sellCondition === 'rsi_overbought' && r0 < overboughtLevel && r1 >= overboughtLevel) {
            sigs.push({ time: times[i], price: closes[i], side: 'sell', label: `RSI ${r1.toFixed(1)}` })
          }
        }
      }
      signals.push({ indicatorId: indicator.id, signals: sigs, buyMarkerColor: indicator.signal.buyMarkerColor, sellMarkerColor: indicator.signal.sellMarkerColor })
      break
    }

    case 'supertrend': {
      const { atrPeriod, multiplier } = params as SupertrendParams
      const { line: stLine, direction } = calcSupertrend(candles, atrPeriod, multiplier)

      const stLineDef = indicator.lines.find((l) => l.id === 'supertrend')
      if (stLineDef) {
        // Split into bull (green) and bear (red) segments
        const bullPoints: ComputedLinePoint[] = []
        const bearPoints: ComputedLinePoint[] = []
        stLine.forEach((v, i) => {
          if (v === null) return
          if (direction[i] === 1) bullPoints.push({ time: times[i], value: v })
          else bearPoints.push({ time: times[i], value: v })
        })

        overlays.push({
          indicatorId: indicator.id,
          lineId: 'supertrend_bull',
          overlayType: 'line',
          color: '#22c55e',
          thickness: stLineDef.thickness,
          points: bullPoints,
        })
        overlays.push({
          indicatorId: indicator.id,
          lineId: 'supertrend_bear',
          overlayType: 'line',
          color: '#f43f5e',
          thickness: stLineDef.thickness,
          points: bearPoints,
        })
      }

      // Direction change signals
      const sigs: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      for (let i = 1; i < candles.length; i++) {
        const d0 = direction[i - 1]; const d1 = direction[i]
        if (d0 !== null && d1 !== null) {
          if (indicator.signal.buyCondition === 'supertrend_buy' && d0 === -1 && d1 === 1) {
            sigs.push({ time: times[i], price: closes[i], side: 'buy', label: 'ST ↑' })
          }
          if (indicator.signal.sellCondition === 'supertrend_sell' && d0 === 1 && d1 === -1) {
            sigs.push({ time: times[i], price: closes[i], side: 'sell', label: 'ST ↓' })
          }
        }
      }
      signals.push({ indicatorId: indicator.id, signals: sigs, buyMarkerColor: indicator.signal.buyMarkerColor, sellMarkerColor: indicator.signal.sellMarkerColor })
      break
    }

    case 'volume_ma': {
      const { period, spikeMultiplier } = params as VolumeMAParams
      const volMa = calcSma(volumes, period)
      const sigs: { time: number; price: number; side: 'buy' | 'sell'; label?: string }[] = []
      for (let i = 1; i < candles.length; i++) {
        const ma = volMa[i]
        if (ma === null) continue
        const isSpike = volumes[i] > ma * spikeMultiplier
        if (!isSpike) continue
        const c = candles[i]
        if (indicator.signal.buyCondition === 'volume_spike_up' && c.close > c.open) {
          sigs.push({ time: times[i], price: closes[i], side: 'buy', label: 'Vol ↑' })
        }
        if (indicator.signal.sellCondition === 'volume_spike_down' && c.close < c.open) {
          sigs.push({ time: times[i], price: closes[i], side: 'sell', label: 'Vol ↓' })
        }
      }
      signals.push({ indicatorId: indicator.id, signals: sigs, buyMarkerColor: indicator.signal.buyMarkerColor, sellMarkerColor: indicator.signal.sellMarkerColor })
      break
    }
  }

  return { overlays, signals }
}

// ─── Preset templates ─────────────────────────────────────────────────────────

export const INDICATOR_PRESETS: IndicatorPreset[] = [
  {
    key: 'ema_crossover',
    label: 'EMA Crossover',
    description: 'Fast 9 EMA vs Slow 21 EMA — signals on crossovers',
    factory: () => ({
      name: 'EMA Crossover (9/21)',
      params: { type: 'ema', fastPeriod: 9, slowPeriod: 21 },
      lines: [
        { id: 'fast', label: 'Fast EMA (9)', color: '#3d7dff', thickness: 1 as const, overlayType: 'line' as const },
        { id: 'slow', label: 'Slow EMA (21)', color: '#f59e0b', thickness: 1 as const, overlayType: 'line' as const },
      ],
      signal: { buyCondition: 'ema_cross_up', sellCondition: 'ema_cross_down', buyMarkerColor: '#22c55e', sellMarkerColor: '#f43f5e' },
      enabled: true,
    }),
  },
  {
    key: 'vwap_breakout',
    label: 'VWAP Breakout',
    description: 'Session-anchored VWAP with price cross signals',
    factory: () => ({
      name: 'VWAP + Breakout',
      params: { type: 'vwap' },
      lines: [
        { id: 'vwap', label: 'VWAP', color: '#a78bfa', thickness: 2 as const, overlayType: 'line' as const },
      ],
      signal: { buyCondition: 'price_above_vwap', sellCondition: 'price_below_vwap', buyMarkerColor: '#22c55e', sellMarkerColor: '#f43f5e' },
      enabled: true,
    }),
  },
  {
    key: 'rsi_levels',
    label: 'RSI Overbought / Oversold',
    description: 'RSI(14) — signals when crossing 30/70 levels',
    factory: () => ({
      name: 'RSI (14) Levels',
      params: { type: 'rsi', period: 14, overboughtLevel: 70, oversoldLevel: 30 },
      lines: [],
      signal: { buyCondition: 'rsi_oversold', sellCondition: 'rsi_overbought', buyMarkerColor: '#22c55e', sellMarkerColor: '#f43f5e' },
      enabled: true,
    }),
  },
  {
    key: 'supertrend',
    label: 'Supertrend',
    description: 'ATR(10) × 3.0 Supertrend — directional buy/sell signals',
    factory: () => ({
      name: 'Supertrend (10, 3)',
      params: { type: 'supertrend', atrPeriod: 10, multiplier: 3.0 },
      lines: [
        { id: 'supertrend', label: 'Supertrend', color: '#22c55e', thickness: 2 as const, overlayType: 'line' as const },
      ],
      signal: { buyCondition: 'supertrend_buy', sellCondition: 'supertrend_sell', buyMarkerColor: '#22c55e', sellMarkerColor: '#f43f5e' },
      enabled: true,
    }),
  },
  {
    key: 'volume_price_breakout',
    label: 'Volume + Price Breakout',
    description: 'Volume > 2× 20-bar average with directional price move',
    factory: () => ({
      name: 'Volume Spike Breakout',
      params: { type: 'volume_ma', period: 20, spikeMultiplier: 2.0 },
      lines: [],
      signal: { buyCondition: 'volume_spike_up', sellCondition: 'volume_spike_down', buyMarkerColor: '#38bdf8', sellMarkerColor: '#fb923c' },
      enabled: true,
    }),
  },
]

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseIndicatorsReturn {
  indicators: SavedIndicator[]
  presets: IndicatorPreset[]
  addFromPreset: (presetKey: string) => SavedIndicator | null
  addCustom: (partial: Omit<SavedIndicator, 'id' | 'createdAt' | 'updatedAt'>) => SavedIndicator
  update: (id: string, changes: Partial<Omit<SavedIndicator, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
  toggle: (id: string) => void
  rename: (id: string, newName: string) => void
  reorder: (fromIndex: number, toIndex: number) => void
  computeAll: (candles: OhlcvCandle[]) => IndicatorComputeResult
}

export function useIndicators(): UseIndicatorsReturn {
  const [indicators, setIndicators] = useState<SavedIndicator[]>(() => loadFromStorage())

  // Persist on every change
  useEffect(() => {
    saveToStorage(indicators)
  }, [indicators])

  const addFromPreset = useCallback((presetKey: string): SavedIndicator | null => {
    const preset = INDICATOR_PRESETS.find((p) => p.key === presetKey)
    if (!preset) return null
    const now = Date.now()
    const indicator: SavedIndicator = {
      ...preset.factory(),
      id: uid(),
      createdAt: now,
      updatedAt: now,
    }
    setIndicators((prev) => [...prev, indicator])
    return indicator
  }, [])

  const addCustom = useCallback(
    (partial: Omit<SavedIndicator, 'id' | 'createdAt' | 'updatedAt'>): SavedIndicator => {
      const now = Date.now()
      const indicator: SavedIndicator = { ...partial, id: uid(), createdAt: now, updatedAt: now }
      setIndicators((prev) => [...prev, indicator])
      return indicator
    },
    [],
  )

  const update = useCallback(
    (id: string, changes: Partial<Omit<SavedIndicator, 'id' | 'createdAt'>>) => {
      setIndicators((prev) =>
        prev.map((ind) =>
          ind.id === id ? { ...ind, ...changes, updatedAt: Date.now() } : ind,
        ),
      )
    },
    [],
  )

  const remove = useCallback((id: string) => {
    setIndicators((prev) => prev.filter((ind) => ind.id !== id))
  }, [])

  const toggle = useCallback((id: string) => {
    setIndicators((prev) =>
      prev.map((ind) =>
        ind.id === id ? { ...ind, enabled: !ind.enabled, updatedAt: Date.now() } : ind,
      ),
    )
  }, [])

  const rename = useCallback((id: string, newName: string) => {
    setIndicators((prev) =>
      prev.map((ind) =>
        ind.id === id ? { ...ind, name: newName.trim() || ind.name, updatedAt: Date.now() } : ind,
      ),
    )
  }, [])

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setIndicators((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }, [])

  const computeAll = useCallback(
    (candles: OhlcvCandle[]): IndicatorComputeResult => {
      const allOverlays: import('../types/indicators').ComputedOverlay[] = []
      const allSignals: import('../types/indicators').ComputedSignals[] = []
      for (const ind of indicators) {
        if (!ind.enabled) continue
        const result = computeIndicator(ind, candles)
        allOverlays.push(...result.overlays)
        allSignals.push(...result.signals)
      }
      return { overlays: allOverlays, signals: allSignals }
    },
    [indicators],
  )

  return { indicators, presets: INDICATOR_PRESETS, addFromPreset, addCustom, update, remove, toggle, rename, reorder, computeAll }
}
