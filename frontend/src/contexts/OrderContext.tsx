import { createContext, useContext, useState, ReactNode } from 'react'

interface OrderContextType {
  isPanelOpen: boolean
  togglePanel: () => void
  selectedSymbol: string | null
  selectSymbol: (symbol: string | null) => void
}

const OrderContext = createContext<OrderContextType | undefined>(undefined)

export function OrderProvider({ children }: { children: ReactNode }) {
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  return (
    <OrderContext.Provider
      value={{
        isPanelOpen,
        togglePanel: () => setIsPanelOpen(!isPanelOpen),
        selectedSymbol,
        selectSymbol: setSelectedSymbol,
      }}
    >
      {children}
    </OrderContext.Provider>
  )
}

export function useOrder() {
  const context = useContext(OrderContext)
  if (!context) throw new Error('useOrder must be used within OrderProvider')
  return context
}
