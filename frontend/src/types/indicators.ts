// ─── Custom Indicator Builder — Data Model ────────────────────────────────────
// Visual-only, no broker execution. All computation happens client-side over
// the same OHLCV candle arrays used by the scalper charts.

export type IndicatorType =
  | 'ema'
  | 'sma'
  | 'vwap'
  | 'rsi'
  | 'supertrend'
  | 'volume_ma'

export type SignalCondition =
  | 'ema_cross_up'       // fast EMA crosses above slow EMA
  | 'ema_cross_down'     // fast EMA crosses below slow EMA
  | 'price_above_vwap'
  | 'price_below_vwap'
  | 'rsi_overbought'     // RSI > threshold
  | 'rsi_oversold'       // RSI < threshold
  | 'supertrend_buy'
  | 'supertrend_sell'
  | 'volume_spike_up'    // volume > N × vol-MA AND price up
  | 'volume_spike_down'  // volume > N × vol-MA AND price down

export type OverlayType =
  | 'line'      // price-scale line series (MA, VWAP, Supertrend line)
  | 'band'      // upper + lower lines (e.g. Bollinger-style band — future)
  | 'histogram' // sub-pane (RSI values shown as histogram — future)
  | 'signal'    // buy/sell arrow markers on candles

// ─── Individual line/overlay within an indicator ─────────────────────────────

export interface IndicatorLine {
  id: string           // unique within the indicator (e.g. "fast", "slow", "signal")
  label: string        // display name
  color: string        // hex or rgba
  thickness: number    // 1–4
  overlayType: OverlayType
}

// ─── Typed parameter bags (discriminated union style) ────────────────────────

export interface EmaParams {
  type: 'ema'
  fastPeriod: number    // fast EMA period
  slowPeriod: number    // slow EMA period
}

export interface SmaParams {
  type: 'sma'
  period: number
}

export interface VwapParams {
  type: 'vwap'
  // no extra params — anchored from first candle of day
}

export interface RsiParams {
  type: 'rsi'
  period: number
  overboughtLevel: number   // default 70
  oversoldLevel: number     // default 30
}

export interface SupertrendParams {
  type: 'supertrend'
  atrPeriod: number         // default 10
  multiplier: number        // default 3.0
}

export interface VolumeMAParams {
  type: 'volume_ma'
  period: number
  spikeMultiplier: number   // threshold for spike signal (e.g. 2.0 = 2× avg vol)
}

export type IndicatorParams =
  | EmaParams
  | SmaParams
  | VwapParams
  | RsiParams
  | SupertrendParams
  | VolumeMAParams

// ─── Buy / Sell condition within an indicator ─────────────────────────────────

export interface IndicatorSignalRule {
  buyCondition: SignalCondition | null
  sellCondition: SignalCondition | null
  buyMarkerColor: string
  sellMarkerColor: string
}

// ─── The saved indicator definition ──────────────────────────────────────────

export interface SavedIndicator {
  id: string                    // UUID-style, generated on save
  name: string                  // user-defined label
  params: IndicatorParams
  lines: IndicatorLine[]        // which series/lines to draw
  signal: IndicatorSignalRule
  enabled: boolean              // toggle without deleting
  createdAt: number             // Date.now()
  updatedAt: number
}

// ─── Computed overlay data (result of running indicator on candles) ───────────

export interface ComputedLinePoint {
  time: number   // epoch seconds (same as chart time)
  value: number
}

export interface ComputedSignalPoint {
  time: number
  price: number
  side: 'buy' | 'sell'
  label?: string
}

export interface ComputedOverlay {
  indicatorId: string
  lineId: string
  overlayType: OverlayType
  color: string
  thickness: number
  points: ComputedLinePoint[]
}

export interface ComputedSignals {
  indicatorId: string
  signals: ComputedSignalPoint[]
  buyMarkerColor: string
  sellMarkerColor: string
}

export interface IndicatorComputeResult {
  overlays: ComputedOverlay[]
  signals: ComputedSignals[]
}

// ─── Candle shape expected by the compute engine ─────────────────────────────

export interface OhlcvCandle {
  time: number    // UTC epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// ─── Preset templates ─────────────────────────────────────────────────────────

export interface IndicatorPreset {
  key: string
  label: string
  description: string
  factory: () => Omit<SavedIndicator, 'id' | 'createdAt' | 'updatedAt'>
}
