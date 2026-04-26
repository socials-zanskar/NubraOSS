import { createContext, useContext, useState, ReactNode, useCallback } from 'react'

type Interval = '1m' | '2m' | '3m' | '5m' | '15m' | '30m' | '1h'

interface ScannerFilters {
  interval: Interval
  minVolumeRatio: number
  universe: string
}

interface ScannerData {
  symbol: string
  displayName: string
  exchange: string
  sector?: string
  industry?: string
  candleTimeIst: string
  lastPrice: number
  currentVolume: number
  averageVolume: number
  volumeRatio: number
  dayChangePct?: number
  priceChangePercent?: number
  priceBreakoutPct?: number
  isGreen: boolean
  isPriceBreakout: boolean
  meetsBreakout: boolean
  baselineDays: number
  sparklinePrices: number[]
}

interface ScannerContextType {
  scannerData: ScannerData[]
  setScannerData: (data: ScannerData[]) => void
  updateScannerData: (payload: Record<string, unknown>) => void
  selectedSymbol: string | null
  setSelectedSymbol: (symbol: string | null) => void
  clearSelectedSymbol: () => void
  filters: ScannerFilters
  updateFilters: (filters: Partial<ScannerFilters>) => void
  searchFilter: string
  setSearchFilter: (filter: string) => void
  isCachedSnapshot: boolean
  setIsCachedSnapshot: (cached: boolean) => void
  lastUpdateTime: string | null
  setLastUpdateTime: (time: string | null) => void
  isPartialScan: boolean
  setIsPartialScan: (partial: boolean) => void
}

const ScannerContext = createContext<ScannerContextType | undefined>(undefined)

export function ScannerProvider({ children }: { children: ReactNode }) {
  const [scannerData, setScannerData] = useState<ScannerData[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [isCachedSnapshot, setIsCachedSnapshot] = useState(false)
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null)
  const [isPartialScan, setIsPartialScan] = useState(false)
  const [filters, setFilters] = useState<ScannerFilters>({
    interval: '5m',
    minVolumeRatio: 1.5,
    universe: 'nifty300',
  })

  const updateFilters = (newFilters: Partial<ScannerFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }

  const updateScannerData = useCallback((payload: Record<string, unknown>) => {
    const isCached = Boolean(payload.is_cached_snapshot)
    const lastRun = payload.last_run_ist ? String(payload.last_run_ist) : null
    const isPartial = Boolean(payload.is_partial_scan)

    setIsCachedSnapshot(isCached)
    setLastUpdateTime(lastRun)
    setIsPartialScan(isPartial)

    const rows = payload.market_breakouts as Array<Record<string, unknown>>
    if (!Array.isArray(rows)) return

    const mapped = rows.map((row: Record<string, unknown>) => ({
      symbol: String(row.symbol ?? ''),
      displayName: String(row.display_name ?? ''),
      exchange: String(row.exchange ?? ''),
      sector: row.sector ? String(row.sector) : undefined,
      industry: row.industry ? String(row.industry) : undefined,
      candleTimeIst: String(row.candle_time_ist ?? ''),
      lastPrice: Number(row.last_price ?? 0),
      currentVolume: Number(row.current_volume ?? 0),
      averageVolume: Number(row.average_volume ?? 0),
      volumeRatio: Number(row.volume_ratio ?? 0),
      dayChangePct: Number(row.day_change_pct ?? 0),
      priceChangePercent: Number(row.price_change_pct ?? 0),
      priceBreakoutPct: Number(row.price_breakout_pct ?? 0),
      isGreen: Boolean(row.is_green),
      isPriceBreakout: Boolean(row.is_price_breakout),
      meetsBreakout: Boolean(row.meets_breakout),
      baselineDays: Number(row.baseline_days ?? 0),
      sparklinePrices: Array.isArray(row.sparkline_prices)
        ? (row.sparkline_prices as number[])
        : [],
    }))

    setScannerData((prev) => {
      const map = new Map(prev.map((item) => [item.symbol, item]))
      mapped.forEach((item) => map.set(item.symbol, item))
      return Array.from(map.values())
    })
  }, [])

  const clearSelectedSymbol = useCallback(() => {
    setSelectedSymbol(null)
  }, [])

  return (
    <ScannerContext.Provider
      value={{
        scannerData,
        setScannerData,
        updateScannerData,
        selectedSymbol,
        setSelectedSymbol,
        clearSelectedSymbol,
        filters,
        updateFilters,
        searchFilter,
        setSearchFilter,
        isCachedSnapshot,
        setIsCachedSnapshot,
        lastUpdateTime,
        setLastUpdateTime,
        isPartialScan,
        setIsPartialScan,
      }}
    >
      {children}
    </ScannerContext.Provider>
  )
}

export function useScanner() {
  const context = useContext(ScannerContext)
  if (!context) throw new Error('useScanner must be used within ScannerProvider')
  return context
}
