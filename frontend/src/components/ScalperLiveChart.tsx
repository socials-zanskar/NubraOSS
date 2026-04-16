import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Panel, PanelSeries } from '../hooks/useScalperLive'

// ─────────────────────────────────────────────────────────────────────────────
const STANDARD_MARKET = {
  up: '#22c55e',
  down: '#f43f5e',
  upVolume: 'rgba(34, 197, 94, 0.35)',
  downVolume: 'rgba(244, 63, 94, 0.35)',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ScalperLiveChartProps {
  panel: Panel
  accent: 'blue' | 'green' | 'red'
  title: string
  /** Instrument display name — shown in chart header. */
  displayName: string | null
  /** Latest close price for the header badge. */
  lastPrice: number | null
  interval: string | null
  exchange: string | null
  /** Chart container height in px. */
  height?: number
  /** Called once after the chart + series are created. */
  onSeriesReady: (panel: Panel, series: PanelSeries) => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '--'
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ScalperLiveChart({
  panel,
  accent,
  title,
  displayName,
  lastPrice,
  interval,
  exchange,
  height = 340,
  onSeriesReady,
}: ScalperLiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  // Stable ref for the callback so we don't recreate the chart if it changes
  const onSeriesReadyRef = useRef(onSeriesReady)
  onSeriesReadyRef.current = onSeriesReady

  // ── Create chart once on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: '#0a0f1a' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'Inter', 'ui-sans-serif', system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#151f2e', style: 0 },
        horzLines: { color: '#151f2e', style: 0 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#334155',
          width: 1,
          style: 1,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: '#334155',
          width: 1,
          style: 1,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        textColor: '#64748b',
        scaleMargins: { top: 0.08, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: { vertTouchDrag: false },
      // IST offset is baked into the time values (+19800 s).
      // The chart thinks it's displaying UTC but it's actually IST.
      localization: {
        timeFormatter: (t: UTCTimestamp) => {
          // t already has the IST offset added — format as HH:MM
          const d = new Date(t * 1000)
          return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
        },
      },
    })

    // Candlestick series
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

    // Volume histogram — pinned to the bottom 18 % of the pane
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: STANDARD_MARKET.upVolume,
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candleSeries
    volumeRef.current = volSeries

    onSeriesReadyRef.current(panel, {
      candle: candleSeries,
      volume: volSeries,
      chart,
    })

    // Responsive resize
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — chart is created once per mount

  // ── Update height if prop changes ─────────────────────────────────────────
  useEffect(() => {
    chartRef.current?.applyOptions({ height })
  }, [height])

  // ── Derive CSS class from accent ─────────────────────────────────────────
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
            {displayName ?? 'Connecting…'}
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

      {/* lightweight-charts renders into this div */}
      <div
        ref={containerRef}
        className="scalper-chart-canvas"
        style={{ height, width: '100%', minWidth: 0 }}
      />
    </article>
  )
}
