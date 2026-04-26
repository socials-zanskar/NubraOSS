import { createContext, useContext, useState, ReactNode } from 'react'

interface Position {
  symbol: string
  quantity: number
  avgEntryPrice: number
  currentPrice: number
  unrealizedPnL: number
}

interface PositionsContextType {
  positions: Position[]
  setPositions: (positions: Position[]) => void
}

const PositionsContext = createContext<PositionsContextType | undefined>(undefined)

export function PositionsProvider({ children }: { children: ReactNode }) {
  const [positions, setPositions] = useState<Position[]>([])

  return (
    <PositionsContext.Provider value={{ positions, setPositions }}>
      {children}
    </PositionsContext.Provider>
  )
}

export function usePositions() {
  const context = useContext(PositionsContext)
  if (!context) throw new Error('usePositions must be used within PositionsProvider')
  return context
}
