import { useEffect, useRef, useState } from 'react'

export interface DebugLog {
  timestamp: string
  type: string
  message: string
  details?: Record<string, unknown>
}

interface DebugPanelProps {
  logs: DebugLog[]
  isOpen: boolean
  onToggle: () => void
}

export function DebugPanel({ logs, isOpen, onToggle }: DebugPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const getLogColor = (type: string) => {
    switch (type) {
      case 'ws:open':
        return '#10b981'
      case 'ws:close':
        return '#ef4444'
      case 'ws:error':
        return '#ef4444'
      case 'event:scan_ready':
        return '#3b82f6'
      case 'event:scan_update':
        return '#8b5cf6'
      case 'event:gap_fill_complete':
        return '#10b981'
      case 'event:ping':
        return '#6b7280'
      case 'sync_progress':
        return '#f59e0b'
      case 'error':
        return '#ef4444'
      default:
        return '#6b7280'
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: isOpen ? '500px' : '200px',
        maxHeight: isOpen ? '600px' : '40px',
        background: 'rgba(0, 0, 0, 0.9)',
        border: '1px solid #374151',
        borderRadius: '8px',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        transition: 'all 200ms ease',
      }}
    >
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          padding: '16px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
          borderBottom: isOpen ? '1px solid #374151' : 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 700,
          minHeight: '50px',
          alignContent: 'center',
        }}
      >
        <span style={{ fontSize: '1rem', color: '#10b981' }}>
          🔍 Debug ({logs.length})
        </span>
        <span style={{ color: '#9ca3af', fontSize: '1.2rem' }}>{isOpen ? '▼' : '▲'}</span>
      </div>

      {/* Logs Container */}
      {isOpen && (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '12px',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            lineHeight: '1.4',
            color: '#d1d5db',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px', textAlign: 'center' }}>
              Waiting for events...
            </div>
          ) : (
            logs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '8px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid #2d3748',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ color: '#9ca3af', minWidth: '100px' }}>{log.timestamp}</span>
                  <span
                    style={{
                      color: getLogColor(log.type),
                      fontWeight: 600,
                      minWidth: '140px',
                    }}
                  >
                    {log.type}
                  </span>
                </div>
                <div style={{ color: '#d1d5db', marginLeft: '8px' }}>{log.message}</div>
                {log.details && (
                  <div
                    style={{
                      color: '#9ca3af',
                      marginLeft: '8px',
                      marginTop: '4px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      maxHeight: '100px',
                      overflowY: 'auto',
                      wordBreak: 'break-all',
                    }}
                  >
                    {Object.entries(log.details).map(([key, value]) => (
                      <div key={key}>
                        {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer - Show Latest Event When Collapsed */}
      {!isOpen && logs.length > 0 && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: '0.7rem',
            color: '#9ca3af',
            borderTop: '1px solid #374151',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {logs[logs.length - 1].type}: {logs[logs.length - 1].message}
        </div>
      )}
    </div>
  )
}
