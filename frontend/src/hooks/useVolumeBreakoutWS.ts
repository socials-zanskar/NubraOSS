import { useEffect, useRef, useState } from 'react'

export interface GapFillProgress {
  pct_complete?: number
  symbols_done?: number
  symbols_total?: number
  bars_written?: number
  phase?: string
  message?: string
  batch_index?: number
  total_batches?: number
  current_symbols?: string[]
}

export type WsState = 'disconnected' | 'connecting' | 'connected' | 'error'
export type VolumeWsDebugLogger = (event: string, detail?: Record<string, unknown>) => void

function logVolumeWs(event: string, detail?: Record<string, unknown>) {
  console.debug(`[volume-breakout][ws] ${event}`, detail ?? {})
}

export interface DebugLog {
  timestamp: string
  type: string
  message: string
  details?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

export function useVolumeBreakoutWS(
  enabled: boolean,
  initParams: Record<string, unknown> | null,
  onStatus: (payload: Record<string, unknown>) => void,
  onDebug?: VolumeWsDebugLogger,
  onDebugLog?: (log: DebugLog) => void,
) {
  const [wsState, setWsState] = useState<WsState>('disconnected')
  const [gapFill, setGapFill] = useState<GapFillProgress | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)

  const addLog = (type: string, message: string, details?: Record<string, unknown>) => {
    const now = new Date()
    const timestamp = `${now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}.${String(now.getMilliseconds()).padStart(3, '0')}`
    onDebugLog?.({
      timestamp,
      type,
      message,
      details,
    })
  }

  useEffect(() => {
    if (!enabled || !initParams) {
      logVolumeWs('skipped', { enabled, hasInitParams: Boolean(initParams) })
      onDebug?.('ws.skipped', { enabled, hasInitParams: Boolean(initParams) })
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      return
    }

    let shouldReconnect = true
    let wasCleanedUp = false
    setWsState('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    logVolumeWs('connecting', { protocol, host: window.location.host, initParams })
    onDebug?.('ws.connecting', {
      protocol,
      host: window.location.host,
      universe_slug: initParams.universe_slug,
      universe_mode: initParams.universe_mode,
    })
    addLog('ws:connecting', `${protocol}://${window.location.host}/ws/volume-breakout`, {
      universe_mode: initParams.universe_mode,
      interval: initParams.interval,
    })
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/volume-breakout`)
    wsRef.current = ws

    ws.onopen = () => {
      logVolumeWs('open')
      onDebug?.('ws.open')
      addLog('ws:open', 'WebSocket connected')
      ws.send(JSON.stringify(initParams))
      logVolumeWs('init_sent', { initParams })
      onDebug?.('ws.init_sent', {
        universe_slug: initParams.universe_slug,
        universe_mode: initParams.universe_mode,
        limit: initParams.universe_limit,
      })
      addLog('ws:init_sent', `Sent init params`, {
        universe_mode: initParams.universe_mode,
        interval: initParams.interval,
      })
    }

    ws.onmessage = (evt) => {
      let msg: { type: string; payload?: Record<string, unknown> }
      try {
        msg = JSON.parse(evt.data)
      } catch {
        return
      }

      if (msg.type === 'ping') {
        addLog('event:ping', 'Heartbeat received')
        return
      }

      if (msg.type === 'scan_ready') {
        const summary = asRecord(msg.payload?.summary)
        const sync = asRecord(msg.payload?.sync)
        setWsState('connected')
        logVolumeWs('scan_ready', {
          hasPayload: Boolean(msg.payload),
          summary,
          sync,
        })
        onDebug?.('ws.scan_ready', {
          summary,
          sync,
          last_error: msg.payload?.last_error,
        })
        addLog('event:scan_ready', `Snapshot ready - ${summary.tracked_stocks || 0} tracked stocks`, {
          cached: msg.payload?.is_cached_snapshot,
          active_breakouts: summary.active_breakouts,
          synced: sync.symbols_synced,
        })
        if (msg.payload) onStatus(msg.payload)
        return
      }

      if (msg.type === 'scan_update' && msg.payload) {
        const { gap_fill_progress, ...rest } = msg.payload as Record<string, unknown>
        const summary = asRecord(msg.payload.summary)
        const sync = asRecord(msg.payload.sync)
        const gapFillProgress = asRecord(gap_fill_progress)
        logVolumeWs('scan_update', {
          gap_fill_progress,
          summary,
          sync,
          last_error: msg.payload.last_error,
        })
        onDebug?.('ws.scan_update', {
          gap_fill_progress,
          summary,
          sync,
          last_error: msg.payload.last_error,
        })
        addLog(
          'event:scan_update',
          `Scan complete - ${(msg.payload.market_breakouts as Array<unknown>)?.length || 0} leaders`,
          {
            active_breakouts: summary.active_breakouts,
            fresh_breakouts: summary.fresh_breakouts,
            partial: msg.payload.is_partial_scan,
            gap_fill: gap_fill_progress ? `${gapFillProgress.pct_complete}%` : 'complete',
          },
        )
        if (gap_fill_progress) {
          setGapFill(gap_fill_progress as GapFillProgress)
        }
        onStatus(rest)
        return
      }

      if (msg.type === 'gap_fill_complete') {
        setGapFill(null)
        logVolumeWs('gap_fill_complete', msg.payload)
        onDebug?.('ws.gap_fill_complete', msg.payload)
        addLog('event:gap_fill_complete', `Gap-fill done - ${msg.payload?.total_bars_written || 0} bars written`, {
          duration_seconds: msg.payload?.duration_seconds,
        })
        return
      }

      if (msg.type === 'sync_progress') {
        logVolumeWs('sync_progress', msg.payload ?? {})
        onDebug?.('ws.sync_progress', msg.payload ?? {})
        const payload = msg.payload as Record<string, unknown>
        addLog('sync_progress', `Syncing batch ${payload.batch_index}/${payload.total_batches}`, {
          progress: `${payload.pct_complete}%`,
          symbols: payload.current_symbols,
          bars_written: payload.bars_written,
        })
        setGapFill(msg.payload as GapFillProgress)
        return
      }

      if (msg.type === 'error') {
        setWsState('error')
        logVolumeWs('error_message', msg.payload ?? {})
        onDebug?.('ws.error_message', msg.payload ?? {})
        addLog('error', `WebSocket error: ${msg.payload?.message || 'Unknown error'}`, msg.payload)
      }
    }

    ws.onerror = () => {
      if (wasCleanedUp) return
      setWsState('error')
      logVolumeWs('socket_error')
      onDebug?.('ws.socket_error')
      addLog('ws:error', 'WebSocket error occurred')
    }

    ws.onclose = () => {
      if (wasCleanedUp) return
      setWsState('disconnected')
      setGapFill(null)
      logVolumeWs('closed')
      onDebug?.('ws.closed')
      addLog('ws:close', 'WebSocket disconnected')
      if (shouldReconnect && reconnectTimerRef.current === null) {
        addLog('ws:reconnecting', 'Attempting to reconnect in 2.5s...')
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          setRetryNonce((value) => value + 1)
        }, 2500)
      }
    }

    return () => {
      shouldReconnect = false
      wasCleanedUp = true
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      logVolumeWs('cleanup')
      onDebug?.('ws.cleanup')
      addLog('ws:cleanup', 'WebSocket cleanup')
      ws.close()
      wsRef.current = null
    }
  }, [enabled, JSON.stringify(initParams), retryNonce])

  return { wsState, gapFill }
}
