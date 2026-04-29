// ─── Automation Hook ──────────────────────────────────────────────────────────
// Option B — Entry + Exit (position-aware)
//
// BUY  signal fires → only act if currentPosition === 'none'  → place BUY  → set 'long'
// SELL signal fires → only act if currentPosition === 'long'  → place SELL → set 'none'
//
// Fires against the *latest* candle's signals only. Deduplication via
// lastActedCandleTimeRef so the same candle never triggers twice.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputedSignals } from '../types/indicators'

export type AutomatePanel = 'call_option' | 'put_option' | 'underlying'
export type AutomateDirection = 'buy_only' | 'sell_only' | 'both'

export interface AutomationSession {
  session_token: string
  device_id: string
  environment: string
}

export interface AutomationOptionPair {
  call_ref_id: number | null
  put_ref_id: number | null
  call_display_name: string
  put_display_name: string
  lot_size: number | null
  tick_size: number | null
  exchange: string
}

export interface AutomateConfig {
  panel: AutomatePanel
  direction: AutomateDirection
  lots: string
  maxTrades: string
}

export interface AutomateLogEntry {
  id: number
  time: string
  type: 'info' | 'success' | 'error' | 'warn'
  message: string
}

export interface UseAutomationParams {
  enabled: boolean
  config: AutomateConfig
  session: AutomationSession | null
  optionPair: AutomationOptionPair | null
  panelSignals: ComputedSignals[]
  /** LTP prices for each panel */
  callLtp: number | null
  putLtp: number | null
  underlyingLtp: number | null
  /** Monotonically increasing — re-check on each increment */
  liveVersion: number
  apiBase: string
}

export interface UseAutomationReturn {
  position: 'none' | 'long'
  tradeCount: number
  log: AutomateLogEntry[]
  clearLog: () => void
  resetPosition: () => void
}

let logIdCounter = 0
function makeLog(type: AutomateLogEntry['type'], message: string): AutomateLogEntry {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  return { id: ++logIdCounter, time, type, message }
}

export function useAutomation(params: UseAutomationParams): UseAutomationReturn {
  const [position, setPosition] = useState<'none' | 'long'>('none')
  const [tradeCount, setTradeCount] = useState(0)
  const [log, setLog] = useState<AutomateLogEntry[]>([])

  // Refs so the effect closure always sees latest values without re-running
  const positionRef = useRef<'none' | 'long'>('none')
  const tradeCountRef = useRef(0)
  const lastActedCandleTimeRef = useRef<number | null>(null)
  const placingRef = useRef(false)

  const addLog = useCallback((entry: AutomateLogEntry) => {
    setLog((prev) => [entry, ...prev].slice(0, 200))
  }, [])

  const clearLog = useCallback(() => {
    setLog([])
  }, [])

  const resetPosition = useCallback(() => {
    positionRef.current = 'none'
    setPosition('none')
    addLog(makeLog('warn', 'Position manually reset to flat.'))
  }, [addLog])

  // Reset state whenever automation is toggled off
  useEffect(() => {
    if (!params.enabled) {
      positionRef.current = 'none'
      setPosition('none')
      tradeCountRef.current = 0
      setTradeCount(0)
      lastActedCandleTimeRef.current = null
      placingRef.current = false
    }
  }, [params.enabled])

  useEffect(() => {
    if (!params.enabled) return
    if (!params.session || !params.optionPair) return
    if (params.session.environment !== 'UAT') return
    if (params.panelSignals.length === 0) return

    const maxTrades = Math.max(1, Math.floor(Number(params.config.maxTrades ?? 10) || 10))
    if (tradeCountRef.current >= maxTrades) return

    // Gather all signal points from across all enabled indicators
    const allPoints = params.panelSignals.flatMap((sig) => sig.signals)
    if (allPoints.length === 0) return

    // Find the latest candle time that has a signal
    const latestTime = Math.max(...allPoints.map((pt) => pt.time))

    // Already acted on this candle — skip
    if (lastActedCandleTimeRef.current === latestTime) return

    // Filter to only the latest candle's signals
    const latestPoints = allPoints.filter((pt) => pt.time === latestTime)

    // Determine what action to take (buy takes precedence over sell when both hit same candle)
    const hasBuy = latestPoints.some((pt) => pt.side === 'buy')
    const hasSell = latestPoints.some((pt) => pt.side === 'sell')

    const { config, panel, direction } = { config: params.config, panel: params.config.panel, direction: params.config.direction }

    let actionSide: 'BUY' | 'SELL' | null = null

    if (
      hasBuy &&
      (direction === 'buy_only' || direction === 'both') &&
      positionRef.current === 'none'
    ) {
      actionSide = 'BUY'
    } else if (
      hasSell &&
      (direction === 'sell_only' || direction === 'both') &&
      positionRef.current === 'long'
    ) {
      actionSide = 'SELL'
    } else if (
      hasBuy &&
      direction === 'sell_only'
    ) {
      // buy signal but direction restricts to sell-only — skip
    } else if (
      hasSell &&
      direction === 'buy_only'
    ) {
      // sell signal but direction restricts to buy-only — skip
    }

    if (!actionSide) return
    if (placingRef.current) return

    // Mark this candle as acted-on immediately (before async)
    lastActedCandleTimeRef.current = latestTime
    placingRef.current = true

    // Resolve instrument
    const optionLeg: 'CE' | 'PE' | null =
      panel === 'call_option' ? 'CE' : panel === 'put_option' ? 'PE' : null

    if (!optionLeg) {
      placingRef.current = false
      addLog(makeLog('warn', `Automation on 'underlying' panel is not supported for order placement.`))
      return
    }

    const instrumentRefId =
      optionLeg === 'CE' ? params.optionPair.call_ref_id : params.optionPair.put_ref_id
    const instrumentDisplayName =
      optionLeg === 'CE' ? params.optionPair.call_display_name : params.optionPair.put_display_name

    if (!instrumentRefId) {
      placingRef.current = false
      addLog(makeLog('error', `Cannot resolve ${optionLeg} instrument ref ID. Order skipped.`))
      return
    }

    const ltpPrice =
      panel === 'call_option'
        ? params.callLtp
        : panel === 'put_option'
          ? params.putLtp
          : params.underlyingLtp

    const lots = Math.max(1, Math.floor(Number(params.config.lots) || 1))

    addLog(makeLog('info', `Signal:   () x  lots @ LTP `))

    void (async () => {
      try {
        const response = await fetch(`${params.apiBase}/api/scalper/order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_token: params.session!.session_token,
            device_id: params.session!.device_id,
            environment: params.session!.environment,
            instrument_ref_id: instrumentRefId,
            instrument_display_name: instrumentDisplayName,
            option_leg: optionLeg,
            order_side: actionSide === 'BUY' ? 'ORDER_SIDE_BUY' : 'ORDER_SIDE_SELL',
            lots,
            lot_size: params.optionPair!.lot_size ?? 1,
            tick_size: params.optionPair!.tick_size ?? 1,
            ltp_price: ltpPrice,
            order_delivery_type: 'ORDER_DELIVERY_TYPE_IDAY',
            exchange: params.optionPair!.exchange,
            tag: 'nubraoss_automate',
          }),
        })

        const data = (await response.json()) as {
          status?: string
          message?: string
          order_id?: number | null
          order_status?: string | null
          detail?: unknown
        }

        if (!response.ok) {
          const errMsg =
            typeof data.detail === 'string'
              ? data.detail
              : typeof data.message === 'string'
                ? data.message
                : `HTTP ${response.status}`
          throw new Error(errMsg)
        }

        // Update position
        const newPosition = actionSide === 'BUY' ? 'long' : 'none'
        positionRef.current = newPosition
        setPosition(newPosition)
        tradeCountRef.current += 1
        setTradeCount(tradeCountRef.current)

        const orderId = data.order_id ?? ''
        const orderStatus = data.order_status ?? ''
        addLog(
          makeLog(
            'success',
            `Order placed:   x  lots. ID  `.trim(),
          ),
        )
      } catch (err) {
        addLog(
          makeLog(
            'error',
            `Order failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          ),
        )
        // Don't block the next candle from acting — clear lastActedCandleTimeRef
        lastActedCandleTimeRef.current = null
      } finally {
        placingRef.current = false
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.liveVersion, params.enabled])

  return { position, tradeCount, log, clearLog, resetPosition }
}
