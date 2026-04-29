import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
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
    bg: '#060a0f',
    text: '#9ba6b0',
    grid: '#10161c',
    crosshair: '#1e3448',
    crosshairLabel: '#10161c',
    border: '#10161c',
    scaleText: '#4e5860',
  },
  light: {
    bg: '#f8fafc',
    text: '#4e5860',
    grid: '#dde8f4',
    crosshair: '#94a3b8',
    crosshairLabel: '#eff7ff',
    border: '#d0e2f0',
    scaleText: '#9ba6b0',
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
  hasData?: boolean
  emptyLabel?: string
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
  hasData,
  emptyLabel,
  onSeriesReady,
}: ScalperLiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const onSeriesReadyRef = useRef(onSeriesReady)
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  onSeriesReadyRef.current = onSeriesReady

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const palette = CHART_THEME[theme]

    const chart = createChart(container, {
      width: container.clientWidth || 1,
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
        scaleMargins: { top: 0.03, bottom: 0.08 },
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
          const date = new Date(time * 1000)
          return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
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
      scaleMargins: { top: 0.9, bottom: 0.01 },
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

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect
        if (width > 0) {
          chart.applyOptions({ width: Math.floor(width), height })
        }
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      overlaySeriesRef.current.clear()
    }
  }, [height, panel, theme])

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
  }, [fallbackCandles, theme])

  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleRef.current
    if (!chart) return

    const seriesMap = overlaySeriesRef.current
    const incomingKeys = new Set<string>()

    for (const overlay of overlays) {
      if (overlay.overlayType !== 'line' || !overlay.points.length) continue

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
        overlay.points.map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        })),
      )
    }

    for (const [key, series] of seriesMap.entries()) {
      if (!incomingKeys.has(key)) {
        try {
          chart.removeSeries(series)
        } catch {
          // Ignore stale series after chart recreation.
        }
        seriesMap.delete(key)
      }
    }

    if (candleSeries) {
      const allMarkers: SeriesMarker<UTCTimestamp>[] = []

      for (const signal of signals) {
        for (const point of signal.signals) {
          allMarkers.push({
            time: point.time as UTCTimestamp,
            position: point.side === 'buy' ? 'belowBar' : 'aboveBar',
            shape: point.side === 'buy' ? 'arrowUp' : 'arrowDown',
            color: point.side === 'buy' ? signal.buyMarkerColor : signal.sellMarkerColor,
            text: point.label ?? (point.side === 'buy' ? 'B' : 'S'),
            size: 1,
          })
        }
      }

      allMarkers.sort((left, right) => (left.time as number) - (right.time as number))
      candleSeries.setMarkers(allMarkers)
    }
  }, [overlays, signals, theme])

  const cardClass =
    accent === 'green'
      ? 'scalper-chart-card accent-green'
      : accent === 'red'
        ? 'scalper-chart-card accent-red'
        : 'scalper-chart-card accent-blue'

  const isLive = displayName !== null
  const hasAnyData = hasData ?? Boolean(fallbackCandles?.length)

  return (
    <article className={cardClass}>
      <div className="scalper-chart-head">
        <div>
          <span className="summary-label">{title}</span>
          <h3 style={{ margin: '1px 0 0', fontSize: '0.82rem', fontWeight: 600 }}>
            {displayName ?? 'Connecting...'}
          </h3>
        </div>
        <div className="scalper-chart-price">
          <strong style={{ fontSize: '0.9rem' }}>{fmt(lastPrice)}</strong>
          <small style={{ opacity: 0.7 }}>
            {exchange && interval ? `${exchange} · ${interval}` : ''}
            {isLive ? (
              <span
                style={{
                  marginLeft: 5,
                  color: '#22c55e',
                  fontWeight: 600,
                  letterSpacing: '0.03em',
                  fontSize: '0.62rem',
                }}
              >
                ● LIVE
              </span>
            ) : null}
          </small>
        </div>
      </div>

      <div className="scalper-chart-shell" style={{ height }}>
        <div
          ref={containerRef}
          className={hasAnyData ? 'scalper-chart-canvas' : 'scalper-chart-canvas is-empty'}
          style={{ height: '100%', width: '100%', minWidth: 0 }}
        />
        {!hasAnyData ? (
          <div className="scalper-chart-empty">
            <span>{emptyLabel ?? 'Loading candles...'}</span>
          </div>
        ) : null}
      </div>
    </article>
  )
}
