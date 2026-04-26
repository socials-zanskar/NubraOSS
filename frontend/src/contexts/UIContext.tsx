import { createContext, useContext, useState, ReactNode } from 'react'

type View = 'scanner' | 'watchlist' | 'orders' | 'positions' | 'alerts'

interface UIContextType {
  currentView: View
  setView: (view: View) => void
  isSidebarOpen: boolean
  toggleSidebar: () => void
  isDarkMode: boolean
  toggleTheme: () => void
}

const UIContext = createContext<UIContextType | undefined>(undefined)

export function UIProvider({ children }: { children: ReactNode }) {
  const [currentView, setCurrentView] = useState<View>('scanner')
  const [isSidebarOpen, setSidebarOpen] = useState(true)
  const [isDarkMode, setDarkMode] = useState(true)

  return (
    <UIContext.Provider
      value={{
        currentView,
        setView: setCurrentView,
        isSidebarOpen,
        toggleSidebar: () => setSidebarOpen(!isSidebarOpen),
        isDarkMode,
        toggleTheme: () => setDarkMode(!isDarkMode),
      }}
    >
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const context = useContext(UIContext)
  if (!context) throw new Error('useUI must be used within UIProvider')
  return context
}
