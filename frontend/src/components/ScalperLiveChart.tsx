import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
} from 'lightweight-charts'
import type { Panel, PanelSeries } from '../hooks/useScalperLive'
import type { ComputedOverlay, ComputedSignals } from '../types/indicators'

const STANDARD_MARKET = {
  up: '#22c55e',
  down: '#f43f5e',
  upVolume: 'rgba(34, 197, 94, 0.48)',
  downVolume: 'rgba(244, 63, 94, 0.48)',
} as const

const CHART_THEME = {
  dark: {
    bg: '#0a0f1a',
    text: '#94a3b8',
    grid: '#151f2e',
    crosshair: '#334155',
    crosshairLabel: '#1e293b',
    border: '#1e293b',
    scaleText: '#64748b',
  },
  light: {
    bg: '#ffffff',
    text: '#475569',
    grid: '#e8eef7',
    crosshair: '#94a3b8',
    crosshairLabel: '#f0f4fa',
    border: '#dce4f0',
    scaleText: '#64748b',
  },
} as const

interface ScalperLiveChartProps {
  panel: Panel
  accent: 'blue' | 'green' | 'red'
  title: string
  displayName: string | null
  lastPrice: number | null
  interval: string | null
  exchange: string | null
  fallbackCandles?: Array<{
    epoch_ms: number
    open: number
    high: number
    low: number
    close: number
    volume: number | null
  }>
  overlays?: ComputedOverlay[]
  signals?: ComputedSignals[]
  height?: number
  theme?: 'light' | 'dark'
  onSeriesReady: (panel: Panel, series: PanelSeries) => void
}

function fmt(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function toChartTime(epochMs: number): UTCTimestamp {
  return Math.floor(epochMs / 1000 + 19800) as UTCTimestamp
}

export default function ScalperLiveChart({
  panel,
  accent,
  title,
  displayName,
  lastPrice,
  interval,
  exchange,
  fallbackCandles,
  overlays = [],
  signals = [],
  height = 340,
  theme = 'dark',
  onSeriesReady,
}: ScalperLiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const onSeriesReadyRef = useRef(onSeriesReady)
  onSeriesReadyRef.current = onSeriesReady

  // Map of "indicatorId::lineId" → line series for overlay management
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const palette = CHART_THEME[theme]

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: palette.bg },
        textColor: palette.text,
        fontSize: 11,
        fontFamily: "'Inter', 'ui-sans-serif', system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: palette.grid, style: 0 },
        horzLines: { color: palette.grid, style: 0 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: palette.crosshair,
          width: 1,
          style: 1,
          labelBackgroundColor: palette.crosshairLabel,
        },
        horzLine: {
          color: palette.crosshair,
          width: 1,
          style: 1,
          labelBackgroundColor: palette.crosshairLabel,
        },
      },
      rightPriceScale: {
        borderColor: palette.border,
        textColor: palette.scaleText,
        scaleMargins: { top: 0.05, bottom: 0.28 },
      },
      timeScale: {
        borderColor: palette.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 9,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: { vertTouchDrag: false },
      localization: {
        timeFormatter: (time: UTCTimestamp) => {
          const d = new Date(time * 1000)
          return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
        },
      },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: STANDARD_MARKET.up,
      downColor: STANDARD_MARKET.down,
      borderUpColor: STANDARD_MARKET.up,
      borderDownColor: STANDARD_MARKET.down,
      wickUpColor: STANDARD_MARKET.up,
      wickDownColor: STANDARD_MARKET.down,
      priceLineVisible: true,
      lastValueVisible: true,
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: STANDARD_MARKET.upVolume,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: (
        original: () => { priceRange: { minValue: number; maxValue: number } } | null,
      ) => {
        const base = original()
        if (!base) return null
        const max = base.priceRange.maxValue
        return {
          priceRange: {
            minValue: 0,
            maxValue: max <= 0 ? 1 : max * 1.12,
          },
        }
      },
    })

    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.72, bottom: 0.02 },
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    volumeRef.current = volumeSeries
    overlaySeriesRef.current.clear()

    onSeriesReadyRef.current(panel, {
      candle: candleSeries,
      volume: volumeSeries,
      chart,
    })

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0) {
        chart.applyOptions({ width: container.clientWidth })
      }
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      overlaySeriesRef.current.clear()
    }
  }, [theme, height, panel])

  // ── Apply fallback historical candles ────────────────────────────────────────
  useEffect(() => {
    if (!fallbackCandles?.length || !candleRef.current || !volumeRef.current) return

    candleRef.current.setData(
      fallbackCandles.map((candle) => ({
        time: toChartTime(candle.epoch_ms),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    )

    volumeRef.current.setData(
      fallbackCandles.map((candle) => ({
        time: toChartTime(candle.epoch_ms),
        value: candle.volume ?? 0,
        color: candle.close >= candle.open ? STANDARD_MARKET.upVolume : STANDARD_MARKET.downVolume,
      })),
    )

    chartRef.current?.timeScale().scrollToRealTime()
  }, [fallbackCandles])

  // ── Apply indicator overlays (line series) ───────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleRef.current
    if (!chart) return

    const seriesMap = overlaySeriesRef.current
    const incomingKeys = new Set<string>()

    // Add or update line series for each overlay
    for (const overlay of overlays) {
      if (overlay.overlayType !== 'line') continue
      if (!overlay.points.length) continue

      const key = `${overlay.indicatorId}::${overlay.lineId}`
      incomingKeys.add(key)

      let series = seriesMap.get(key)
      if (!series) {
        series = chart.addLineSeries({
          color: overlay.color,
          lineWidth: overlay.thickness as 1 | 2 | 3 | 4,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        seriesMap.set(key, series)
      } else {
        series.applyOptions({
          color: overlay.color,
          lineWidth: overlay.thickness as 1 | 2 | 3 | 4,
        })
      }

      series.setData(
        overlay.points.map((pt) => ({
          time: pt.time as UTCTimestamp,
          value: pt.value,
        })),
      )
    }

    // Remove series for overlays that are no longer present
    for (const [key, series] of seriesMap.entries()) {
      if (!incomingKeys.has(key)) {
        try {
          chart.removeSeries(series)
        } catch {
          // series may already be gone if chart was recreated
        }
        seriesMap.delete(key)
      }
    }

    // Apply buy/sell markers on the candle series
    if (candleSeries) {
      const allMarkers: SeriesMarker<UTCTimestamp>[] = []

      for (const sig of signals) {
        for (const pt of sig.signals) {
          allMarkers.push({
            time: pt.time as UTCTimestamp,
            position: pt.side === 'buy' ? 'belowBar' : 'aboveBar',
            shape: pt.side === 'buy' ? 'arrowUp' : 'arrowDown',
            color: pt.side === 'buy' ? sig.buyMarkerColor : sig.sellMarkerColor,
            text: pt.label ?? (pt.side === 'buy' ? 'B' : 'S'),
            size: 1,
          })
        }
      }

      // Sort markers by time ascending (lightweight-charts requirement)
      allMarkers.sort((a, b) => (a.time as number) - (b.time as number))
      candleSeries.setMarkers(allMarkers)
    }
  }, [overlays, signals])

  const cardClass =
    accent === 'green'
      ? 'scalper-chart-card accent-green'
      : accent === 'red'
        ? 'scalper-chart-card accent-red'
        : 'scalper-chart-card accent-blue'

  const isLive = displayName !== null

  return (
    <article className={cardClass}>
      <div className="scalper-chart-head">
        <div>
          <span className="summary-label">{title}</span>
          <h3 style={{ margin: '2px 0 0', fontSize: '0.97rem', fontWeight: 600 }}>
            {displayName ?? 'Connecting...'}
          </h3>
        </div>
        <div className="scalper-chart-price">
          <strong style={{ fontSize: '1.05rem' }}>{fmt(lastPrice)}</strong>
          <small style={{ opacity: 0.7 }}>
            {exchange && interval ? `${exchange} · ${interval}` : ''}
            {isLive ? (
              <span
                style={{
                  marginLeft: 6,
                  color: '#22c55e',
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                  fontSize: '0.7rem',
                }}
              >
                ● LIVE
              </span>
            ) : null}
          </small>
        </div>
      </div>

      <div
        ref={containerRef}
        className="scalper-chart-canvas"
        style={{ height, width: '100%', minWidth: 0 }}
      />
    </article>
  )
}
