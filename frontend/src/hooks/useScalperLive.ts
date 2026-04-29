import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'

export type Panel = 'underlying' | 'call_option' | 'put_option'

export interface LiveCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface PanelData {
  instrument: string
  display_name: string
  exchange: string
  instrument_type: string
  interval: string
  last_price: number | null
  candles: LiveCandle[]
}

export interface OptionPair {
  underlying: string
  exchange: string
  expiry: string | null
  ce_strike_price: number
  pe_strike_price: number
  call_ref_id: number | null
  put_ref_id: number | null
  call_display_name: string
  put_display_name: string
  lot_size: number | null
  tick_size: number | null
}

export interface PanelSeries {
  candle: ISeriesApi<'Candlestick'>
  volume: ISeriesApi<'Histogram'>
  chart: IChartApi
}

export type PanelMeta = Omit<PanelData, 'candles'>

export interface UseScalperLiveParams {
  enabled: boolean
  session_token: string
  device_id: string
  environment: string
  underlying: string
  exchange: string
  interval: string
  ce_strike_price: number
  pe_strike_price: number
  expiry: string | null
  lookback_days?: number
  reconnect_nonce?: number
  seedSnapshot?: {
    option_pair: OptionPair
    panels: Record<Panel, PanelData>
  } | null
}

export interface UseScalperLiveReturn {
  status: string
  error: string
  connected: boolean
  optionPair: OptionPair | null
  panelMeta: Record<Panel, PanelMeta> | null
  registerPanel: (panel: Panel, series: PanelSeries) => void
  /** Monotonically increasing counter — increments on init, candle_update, and reconcile.
   *  Use as a useMemo/useEffect dependency to react to live candle changes. */
  liveVersion: number
  /** Direct ref to the live candle arrays. Read inside useMemo when liveVersion changes. */
  liveCandlesRef: React.MutableRefObject<Record<Panel, LiveCandle[]>>
}

const IST_OFFSET_S = 5.5 * 3600

function toChartTime(epochUtcS: number): UTCTimestamp {
  return (epochUtcS + IST_OFFSET_S) as UTCTimestamp
}

function candleColor(open: number, close: number, alpha = 0.5): string {
  return close >= open
    ? `rgba(34, 197, 94, ${alpha})`
    : `rgba(239, 68, 68, ${alpha})`
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/scalper`
}

function omitCandles(data: PanelData): PanelMeta {
  const { candles: _candles, ...rest } = data
  return rest
}

function normalizeStatusMessage(message: string): string {
  if (!message) return message
  if (message.includes('polling Nubra every 12s')) {
    return 'Live websocket updates are active for the current candle. REST is only used for periodic reconcile.'
  }
  return message
}

export function useScalperLive(params: UseScalperLiveParams): UseScalperLiveReturn {
  const seriesRef = useRef<Partial<Record<Panel, PanelSeries>>>({})
  const candlesRef = useRef<Record<Panel, LiveCandle[]>>({
    underlying: [],
    call_option: [],
    put_option: [],
  })
  const pendingInitRef = useRef<Record<Panel, PanelData> | null>(null)
  const initReceivedRef = useRef(false)
  const lastErrorRef = useRef('')

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [optionPair, setOptionPair] = useState<OptionPair | null>(null)
  const [panelMeta, setPanelMeta] = useState<Record<Panel, PanelMeta> | null>(null)
  const [liveVersion, setLiveVersion] = useState(0)

  const seedPanel = useCallback((panel: Panel, data: PanelData, series: PanelSeries) => {
    const candleData = data.candles.map((candle) => ({
      time: toChartTime(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
    const volumeData = data.candles.map((candle) => ({
      time: toChartTime(candle.time),
      value: candle.volume,
      color: candleColor(candle.open, candle.close, 0.45),
    }))

    series.candle.setData(candleData)
    series.volume.setData(volumeData)
    series.chart.timeScale().scrollToRealTime()
  }, [])

  const registerPanel = useCallback(
    (panel: Panel, series: PanelSeries) => {
      seriesRef.current[panel] = series
      const pending = pendingInitRef.current
      if (pending?.[panel]) {
        seedPanel(panel, pending[panel], series)
      }
    },
    [seedPanel],
  )

  useEffect(() => {
    if (!params.enabled) return

    let ws: WebSocket
    let closedByEffectCleanup = false

    try {
      ws = new WebSocket(wsUrl())
    } catch {
      setError('Failed to open WebSocket connection.')
      return
    }

    setError('')
    setStatus('Connecting...')
    initReceivedRef.current = false
    lastErrorRef.current = ''
    pendingInitRef.current = null
    candlesRef.current = { underlying: [], call_option: [], put_option: [] }
    setConnected(false)
    setOptionPair(null)
    setPanelMeta(null)

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          session_token: params.session_token,
          device_id: params.device_id,
          environment: params.environment,
          underlying: params.underlying,
          exchange: params.exchange,
          interval: params.interval,
          ce_strike_price: params.ce_strike_price,
          pe_strike_price: params.pe_strike_price,
          expiry: params.expiry,
          lookback_days: params.lookback_days ?? 5,
          seed_snapshot: params.seedSnapshot ?? undefined,
        }),
      )
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (closedByEffectCleanup) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      const msgType = String(msg.type ?? '')

      if (msgType === 'status') {
        const nextStatus = normalizeStatusMessage(String(msg.message ?? ''))
        setStatus(nextStatus)
        if (nextStatus.toLowerCase().includes('live websocket connected')) {
          setConnected(true)
        }
        return
      }

      if (msgType === 'error') {
        const nextError = String(msg.message ?? 'Unknown scalper websocket error.')
        lastErrorRef.current = nextError
        pendingInitRef.current = null
        candlesRef.current = { underlying: [], call_option: [], put_option: [] }
        setOptionPair(null)
        setPanelMeta(null)
        setError(nextError)
        setStatus('')
        setConnected(false)
        return
      }

      if (msgType === 'init') {
        initReceivedRef.current = true
        setConnected(true)
        const panels = msg.panels as Record<Panel, PanelData>
        pendingInitRef.current = panels
        candlesRef.current = {
          underlying: [...panels.underlying.candles],
          call_option: [...panels.call_option.candles],
          put_option: [...panels.put_option.candles],
        }
        setOptionPair(msg.option_pair as OptionPair)
        setPanelMeta({
          underlying: omitCandles(panels.underlying),
          call_option: omitCandles(panels.call_option),
          put_option: omitCandles(panels.put_option),
        })

        for (const [panel, series] of Object.entries(seriesRef.current) as [Panel, PanelSeries][]) {
          if (series && panels[panel]) {
            seedPanel(panel, panels[panel], series)
          }
        }

        setStatus(`${panels.underlying.candles.length} candles loaded. Live updates streaming.`)
        setLiveVersion((v) => v + 1)
        return
      }

      if (msgType === 'candle_update') {
        const panel = msg.panel as Panel
        const candle = msg.candle as LiveCandle
        const lastPrice = Number(msg.last_price ?? candle.close)

        setPanelMeta((prev) =>
          prev ? { ...prev, [panel]: { ...prev[panel], last_price: lastPrice } } : prev,
        )

        const panelCandles = candlesRef.current[panel]
        const last = panelCandles[panelCandles.length - 1]
        if (last && last.time === candle.time) {
          panelCandles[panelCandles.length - 1] = candle
        } else {
          panelCandles.push(candle)
        }

        const series = seriesRef.current[panel]
        if (series) {
          const chartTime = toChartTime(candle.time)
          series.candle.update({
            time: chartTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })
          series.volume.update({
            time: chartTime,
            value: candle.volume,
            color: candleColor(candle.open, candle.close, 0.45),
          })
        }
        setLiveVersion((v) => v + 1)
        return
      }

      if (msgType === 'reconcile') {
        const panel = msg.panel as Panel
        const newCandles = msg.candles as LiveCandle[]
        const panelCandles = candlesRef.current[panel]

        for (const nextCandle of newCandles) {
          const idx = panelCandles.findIndex((candle) => candle.time === nextCandle.time)
          if (idx >= 0) {
            panelCandles[idx] = nextCandle
          } else {
            panelCandles.push(nextCandle)
          }
        }
        panelCandles.sort((left, right) => left.time - right.time)

        const series = seriesRef.current[panel]
        if (series) {
          series.candle.setData(
            panelCandles.map((candle) => ({
              time: toChartTime(candle.time),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            })),
          )
          series.volume.setData(
            panelCandles.map((candle) => ({
              time: toChartTime(candle.time),
              value: candle.volume,
              color: candleColor(candle.open, candle.close, 0.45),
            })),
          )
        }
        setLiveVersion((v) => v + 1)
      }
    }

    ws.onerror = () => {
      if (closedByEffectCleanup) return
      const nextError =
        'WebSocket error. Check that the backend is running and that your Nubra session is still valid.'
      lastErrorRef.current = nextError
      setError(nextError)
      setConnected(false)
    }

    ws.onclose = () => {
      if (closedByEffectCleanup) return
      setConnected(false)
      if (!initReceivedRef.current && !lastErrorRef.current) {
        const nextError =
          'Live scalper feed closed before initialization. Your Nubra session may have expired. Please log in again and reconnect.'
        lastErrorRef.current = nextError
        setError(nextError)
      }
    }

    return () => {
      closedByEffectCleanup = true
      ws.close()
      pendingInitRef.current = null
      candlesRef.current = { underlying: [], call_option: [], put_option: [] }
      initReceivedRef.current = false
      lastErrorRef.current = ''
      setOptionPair(null)
      setPanelMeta(null)
      setConnected(false)
      setStatus('')
      setError('')
    }
  }, [
    params.device_id,
    params.ce_strike_price,
    params.enabled,
    params.environment,
    params.exchange,
    params.expiry,
    params.interval,
    params.lookback_days,
    params.pe_strike_price,
    params.reconnect_nonce,
    params.session_token,
    params.underlying,
    seedPanel,
  ])

  return { status, error, connected, optionPair, panelMeta, registerPanel, liveVersion, liveCandlesRef: candlesRef }
}
