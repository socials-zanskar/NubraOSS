import { useEffect, useMemo, useRef, useState } from 'react'

export type VolumeQuoteWsState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface VolumeLiveQuote {
  symbol: string
  last_price: number
  volume?: number | null
  day_change_pct?: number | null
  updated_at_ist?: string | null
  source: 'scanner_cache' | 'websocket'
  stale?: boolean
}

export interface UseVolumeQuotesParams {
  enabled: boolean
  session_token: string
  device_id: string
  environment: string
  symbols: string[]
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/volume-quotes`
}

function normalizeQuote(value: unknown): VolumeLiveQuote | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const symbol = String(record.symbol ?? '').trim().toUpperCase()
  const lastPrice = Number(record.last_price)
  if (!symbol || !Number.isFinite(lastPrice) || lastPrice <= 0) return null
  return {
    symbol,
    last_price: lastPrice,
    volume: Number.isFinite(Number(record.volume)) ? Number(record.volume) : null,
    day_change_pct: Number.isFinite(Number(record.day_change_pct)) ? Number(record.day_change_pct) : null,
    updated_at_ist: typeof record.updated_at_ist === 'string' ? record.updated_at_ist : null,
    source: record.source === 'websocket' ? 'websocket' : 'scanner_cache',
    stale: Boolean(record.stale),
  }
}

export function useVolumeQuotesWS(params: UseVolumeQuotesParams) {
  const [state, setState] = useState<VolumeQuoteWsState>('disconnected')
  const [status, setStatus] = useState('')
  const [quotes, setQuotes] = useState<Record<string, VolumeLiveQuote>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const symbolsKey = useMemo(() => params.symbols.map((symbol) => symbol.toUpperCase()).join('|'), [params.symbols])

  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'set_symbols', symbols: params.symbols }))
  }, [symbolsKey])

  useEffect(() => {
    if (!params.enabled || params.symbols.length === 0) {
      setState('disconnected')
      setStatus('')
      return
    }

    let shouldReconnect = true
    let cleanedUp = false

    const openSocket = () => {
      setState('connecting')
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            session_token: params.session_token,
            device_id: params.device_id,
            environment: params.environment,
            symbols: params.symbols,
          }),
        )
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          return
        }

        const type = String(msg.type ?? '')
        if (type === 'status') {
          setStatus(String(msg.message ?? ''))
          return
        }
        if (type === 'connected') {
          setState('connected')
          setStatus(`Live quotes connected for ${(msg.symbols as unknown[])?.length ?? params.symbols.length} symbols.`)
          return
        }
        if (type === 'snapshot') {
          const nextQuotes = Array.isArray(msg.quotes) ? msg.quotes.map(normalizeQuote).filter(Boolean) as VolumeLiveQuote[] : []
          setQuotes((prev) => {
            const next = { ...prev }
            for (const quote of nextQuotes) next[quote.symbol] = quote
            return next
          })
          return
        }
        if (type === 'quote') {
          const quote = normalizeQuote(msg.quote)
          if (!quote) return
          setQuotes((prev) => ({ ...prev, [quote.symbol]: quote }))
          return
        }
        if (type === 'error') {
          setState('error')
          setStatus(String(msg.message ?? 'Live quote stream failed.'))
        }
      }

      ws.onerror = () => {
        if (cleanedUp) return
        setState('error')
        setStatus('Live quote socket error.')
      }

      ws.onclose = () => {
        if (cleanedUp) return
        setState('disconnected')
        if (shouldReconnect && reconnectTimerRef.current === null) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null
            openSocket()
          }, 2500)
        }
      }
    }

    openSocket()

    return () => {
      shouldReconnect = false
      cleanedUp = true
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      wsRef.current?.close()
      wsRef.current = null
      setState('disconnected')
    }
  }, [params.device_id, params.enabled, params.environment, params.session_token])

  return { state, status, quotes }
}
