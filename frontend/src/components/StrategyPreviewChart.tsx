import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'

export interface StrategyPreviewCandlePoint {
  epoch_ms: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface StrategyPreviewChartProps {
  candles: StrategyPreviewCandlePoint[]
  interval: string
  height?: number
}

interface PreviewTheme {
  background: string
  text: string
  border: string
  grid: string
  up: string
  down: string
  accent: string
  panel: string
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function isDailyLike(interval: string): boolean {
  return ['1d', '1w', '1mt'].includes(interval)
}

function resolveTheme(): PreviewTheme {
  return {
    background: readCssVar('--bg-2', '#0f172a'),
    text: readCssVar('--fg-dim', '#94a3b8'),
    border: readCssVar('--hairline-2', '#334155'),
    grid: readCssVar('--hairline', '#1e293b'),
    up: readCssVar('--pos', '#22c55e'),
    down: readCssVar('--neg', '#ef4444'),
    accent: readCssVar('--accent', '#38bdf8'),
    panel: readCssVar('--panel-solid', '#111827'),
  }
}

function formatPreviewTime(value: UTCTimestamp, interval: string): string {
  const date = new Date(Number(value) * 1000)
  const timeOptions: Intl.DateTimeFormatOptions = isDailyLike(interval)
    ? { day: '2-digit', month: 'short', year: 'numeric' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...timeOptions,
  }).format(date)
}

export default function StrategyPreviewChart({
  candles,
  interval,
  height = 320,
}: StrategyPreviewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const intervalRef = useRef(interval)
  intervalRef.current = interval

  const applyTheme = () => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    if (!chart || !candleSeries) return

    const theme = resolveTheme()
    chart.applyOptions({
      layout: {
        background: { color: theme.background },
        textColor: theme.text,
        fontSize: 11,
        fontFamily: "'Inter', system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Solid },
        horzLines: { color: theme.grid, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: theme.border,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.panel,
        },
        horzLine: {
          color: theme.border,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.panel,
        },
      },
      rightPriceScale: {
        borderColor: theme.border,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: theme.border,
        timeVisible: !isDailyLike(intervalRef.current),
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 9,
      },
      localization: {
        timeFormatter: (value: UTCTimestamp) => formatPreviewTime(value, intervalRef.current),
      },
    })

    candleSeries.applyOptions({
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      priceLineColor: theme.accent,
      lastValueVisible: true,
      priceLineVisible: true,
    })
  }

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
    })
    const candleSeries = chart.addCandlestickSeries({})

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    applyTheme()

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height })
    })
    resizeObserver.observe(container)

    const themeObserver = new MutationObserver(() => {
      applyTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }
  }, [height])

  useEffect(() => {
    applyTheme()
  }, [interval])

  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = candleSeriesRef.current
    if (!chart || !candleSeries) return

    candleSeries.setData(
      candles.map((candle) => ({
        time: Math.floor(candle.epoch_ms / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    )
    chart.timeScale().fitContent()
  }, [candles])

  return <div ref={containerRef} className="strategy-preview-chart-canvas" />
}
