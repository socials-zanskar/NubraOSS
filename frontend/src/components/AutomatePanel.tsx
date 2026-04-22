// ─── AutomatePanel ────────────────────────────────────────────────────────────
// UI panel for the automation feature. Displays toggle, configuration controls,
// current position, trade count, and an activity log.

import type { AutomateConfig, AutomateDirection, AutomateLogEntry, AutomatePanel as AutomatePanelType } from '../hooks/useAutomation'

interface AutomatePanelProps {
  enabled: boolean
  onToggle: (next: boolean) => void

  config: AutomateConfig
  onConfigChange: (next: Partial<AutomateConfig>) => void

  /** Whether there are any indicators with signal rules enabled */
  hasSignals: boolean

  position: 'none' | 'long'
  tradeCount: number

  log: AutomateLogEntry[]
  onClearLog: () => void
  onResetPosition: () => void

  /** Disable all controls (demo session, no session, etc.) */
  disabled?: boolean
}

const PANEL_LABELS: Record<AutomatePanelType, string> = {
  call_option: 'Call (CE)',
  put_option: 'Put (PE)',
  underlying: 'Underlying',
}

const DIRECTION_LABELS: Record<AutomateDirection, string> = {
  both: 'Entry + Exit (both)',
  buy_only: 'Buy only (entry)',
  sell_only: 'Sell only (exit)',
}

const LOG_TYPE_STYLE: Record<AutomateLogEntry['type'], string> = {
  info: 'color: var(--text-secondary)',
  success: 'color: #22c55e',
  error: 'color: #ef4444',
  warn: 'color: #f59e0b',
}

export default function AutomatePanel({
  enabled,
  onToggle,
  config,
  onConfigChange,
  hasSignals,
  position,
  tradeCount,
  log,
  onClearLog,
  onResetPosition,
  disabled = false,
}: AutomatePanelProps) {
  const maxTrades = Math.max(1, Math.floor(Number(config.maxTrades) || 10))
  const lots = Math.max(1, Math.floor(Number(config.lots) || 1))

  return (
    <div className="automate-panel">
      {/* ── Header ── */}
      <div className="automate-panel-head">
        <div>
          <span className="summary-label">Automation</span>
          <h2 style={{ margin: '2px 0 0', fontSize: '0.97rem', fontWeight: 600 }}>
            Auto-trade from indicator signals
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            When enabled, buy/sell orders are placed automatically whenever the indicator signals
            a new entry or exit. Uses the same order API as the manual trade buttons.
          </p>
        </div>

        {/* Toggle */}
        <button
          type="button"
          className={enabled ? 'automate-toggle is-on' : 'automate-toggle'}
          disabled={disabled || (!enabled && !hasSignals)}
          onClick={() => onToggle(!enabled)}
          title={
            !hasSignals && !enabled
              ? 'Add at least one indicator with a signal rule before enabling automation.'
              : enabled
                ? 'Turn off automation'
                : 'Turn on automation'
          }
        >
          {enabled ? 'AUTOMATION ON' : 'AUTOMATION OFF'}
        </button>
      </div>

      {/* ── Warnings ── */}
      {disabled && (
        <div className="automate-warning">
          A live (non-demo) session is required to use automation.
        </div>
      )}
      {!hasSignals && !enabled && !disabled && (
        <div className="automate-warning">
          No indicator with a signal rule is active. Add a buy or sell signal condition in the
          Indicator Builder first.
        </div>
      )}
      {enabled && (
        <div className="automate-live-banner">
          Automation is LIVE — orders are being placed automatically. Monitor the log below.
        </div>
      )}

      {/* ── Config ── */}
      <div className={`automate-config ${enabled ? 'is-locked' : ''}`}>
        <div className="automate-config-row">
          <label className="scalper-field">
            <span>Trade on panel</span>
            <select
              value={config.panel}
              disabled={enabled || disabled}
              onChange={(e) => onConfigChange({ panel: e.target.value as AutomatePanelType })}
            >
              {(Object.keys(PANEL_LABELS) as AutomatePanelType[]).map((key) => (
                <option key={key} value={key}>
                  {PANEL_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className="scalper-field">
            <span>Signal direction</span>
            <select
              value={config.direction}
              disabled={enabled || disabled}
              onChange={(e) => onConfigChange({ direction: e.target.value as AutomateDirection })}
            >
              {(Object.keys(DIRECTION_LABELS) as AutomateDirection[]).map((key) => (
                <option key={key} value={key}>
                  {DIRECTION_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className="scalper-field">
            <span>Lots per order</span>
            <div className="scalper-step-input">
              <button
                type="button"
                disabled={enabled || disabled}
                onClick={() => onConfigChange({ lots: String(Math.max(1, lots - 1)) })}
              >
                -
              </button>
              <input
                value={config.lots}
                disabled={enabled || disabled}
                onChange={(e) => onConfigChange({ lots: e.target.value.replace(/[^\d]/g, '') })}
              />
              <button
                type="button"
                disabled={enabled || disabled}
                onClick={() => onConfigChange({ lots: String(lots + 1) })}
              >
                +
              </button>
            </div>
          </label>

          <label className="scalper-field">
            <span>Max trades (safety cap)</span>
            <div className="scalper-step-input">
              <button
                type="button"
                disabled={enabled || disabled}
                onClick={() => onConfigChange({ maxTrades: String(Math.max(1, maxTrades - 1)) })}
              >
                -
              </button>
              <input
                value={config.maxTrades}
                disabled={enabled || disabled}
                onChange={(e) => onConfigChange({ maxTrades: e.target.value.replace(/[^\d]/g, '') })}
              />
              <button
                type="button"
                disabled={enabled || disabled}
                onClick={() => onConfigChange({ maxTrades: String(maxTrades + 1) })}
              >
                +
              </button>
            </div>
          </label>
        </div>
      </div>

      {/* ── Status row ── */}
      <div className="automate-status-row">
        <div className="automate-stat">
          <span className="automate-stat-label">Position</span>
          <span
            className="automate-stat-value"
            style={{ color: position === 'long' ? '#22c55e' : '#94a3b8' }}
          >
            {position === 'long' ? 'LONG' : 'FLAT'}
          </span>
        </div>
        <div className="automate-stat">
          <span className="automate-stat-label">Trades placed</span>
          <span className="automate-stat-value">{tradeCount}</span>
        </div>
        <div className="automate-stat">
          <span className="automate-stat-label">Max trades</span>
          <span className="automate-stat-value" style={{ color: tradeCount >= maxTrades ? '#ef4444' : undefined }}>
            {maxTrades}
          </span>
        </div>
        <div className="automate-stat-actions">
          <button
            type="button"
            className="automate-action-btn"
            onClick={onResetPosition}
            title="Manually mark position as flat (does NOT place an order)"
          >
            Reset position
          </button>
        </div>
      </div>

      {/* ── Activity log ── */}
      <div className="automate-log-section">
        <div className="automate-log-head">
          <span style={{ fontWeight: 600, fontSize: '0.78rem' }}>Activity log</span>
          <button type="button" className="automate-action-btn" onClick={onClearLog}>
            Clear
          </button>
        </div>
        <div className="automate-log-body">
          {log.length === 0 ? (
            <div className="automate-log-empty">No activity yet. Enable automation to start.</div>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="automate-log-entry">
                <span className="automate-log-time">{entry.time}</span>
                <span style={{ cssText: LOG_TYPE_STYLE[entry.type] } as React.CSSProperties}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
