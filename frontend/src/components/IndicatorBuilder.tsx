// ─── Custom Indicator Builder Panel ───────────────────────────────────────────
import { useState } from 'react'
import { INDICATOR_PRESETS } from '../hooks/useIndicators'
import type {
  SavedIndicator,
  IndicatorPreset,
  IndicatorLine,
  IndicatorSignalRule,
  IndicatorParams,
  EmaParams,
  SmaParams,
  RsiParams,
  SupertrendParams,
  VolumeMAParams,
  SignalCondition,
} from '../types/indicators'

// ─── Props ────────────────────────────────────────────────────────────────────

interface IndicatorBuilderProps {
  indicators: SavedIndicator[]
  presets: IndicatorPreset[]
  onAddFromPreset: (presetKey: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, newName: string) => void
  onUpdate: (id: string, changes: Partial<Omit<SavedIndicator, 'id' | 'createdAt'>>) => void
  theme?: 'light' | 'dark'
}

// ─── Signal condition options per type ───────────────────────────────────────

type SignalOptions = {
  buyOptions: { value: SignalCondition; label: string }[]
  sellOptions: { value: SignalCondition; label: string }[]
}

function getSignalOptions(type: IndicatorParams['type']): SignalOptions {
  switch (type) {
    case 'ema':
      return {
        buyOptions: [{ value: 'ema_cross_up', label: 'EMA Cross Up' }],
        sellOptions: [{ value: 'ema_cross_down', label: 'EMA Cross Down' }],
      }
    case 'vwap':
      return {
        buyOptions: [{ value: 'price_above_vwap', label: 'Price Crosses Above VWAP' }],
        sellOptions: [{ value: 'price_below_vwap', label: 'Price Crosses Below VWAP' }],
      }
    case 'rsi':
      return {
        buyOptions: [{ value: 'rsi_oversold', label: 'RSI Oversold Cross' }],
        sellOptions: [{ value: 'rsi_overbought', label: 'RSI Overbought Cross' }],
      }
    case 'supertrend':
      return {
        buyOptions: [{ value: 'supertrend_buy', label: 'Supertrend Buy Signal' }],
        sellOptions: [{ value: 'supertrend_sell', label: 'Supertrend Sell Signal' }],
      }
    case 'volume_ma':
      return {
        buyOptions: [{ value: 'volume_spike_up', label: 'Volume Spike Up' }],
        sellOptions: [{ value: 'volume_spike_down', label: 'Volume Spike Down' }],
      }
    case 'sma':
      return { buyOptions: [], sellOptions: [] }
    default:
      return { buyOptions: [], sellOptions: [] }
  }
}

// ─── Type badge label ─────────────────────────────────────────────────────────

function typeBadgeLabel(type: IndicatorParams['type']): string {
  switch (type) {
    case 'ema': return 'EMA'
    case 'sma': return 'SMA'
    case 'vwap': return 'VWAP'
    case 'rsi': return 'RSI'
    case 'supertrend': return 'ST'
    case 'volume_ma': return 'VOL'
    default: return (type as string).toUpperCase()
  }
}

// ─── Type badge color ─────────────────────────────────────────────────────────

function typeBadgeColor(type: IndicatorParams['type']): string {
  switch (type) {
    case 'ema': return '#3d7dff'
    case 'sma': return '#f59e0b'
    case 'vwap': return '#a78bfa'
    case 'rsi': return '#22c55e'
    case 'supertrend': return '#f43f5e'
    case 'volume_ma': return '#38bdf8'
    default: return '#64748b'
  }
}

// ─── Preset dot color ─────────────────────────────────────────────────────────

function presetDotColor(key: string): string {
  switch (key) {
    case 'ema_crossover': return '#3d7dff'
    case 'vwap_breakout': return '#a78bfa'
    case 'rsi_levels': return '#22c55e'
    case 'supertrend': return '#f43f5e'
    case 'volume_price_breakout': return '#38bdf8'
    default: return '#64748b'
  }
}

// ─── Draft state shape for IndicatorParamsEditor ─────────────────────────────

interface DraftParams {
  params: IndicatorParams
  lines: IndicatorLine[]
  signal: IndicatorSignalRule
}

// ─── IndicatorParamsEditor ────────────────────────────────────────────────────

interface IndicatorParamsEditorProps {
  indicator: SavedIndicator
  onApply: (changes: Partial<Omit<SavedIndicator, 'id' | 'createdAt'>>) => void
}

function IndicatorParamsEditor({ indicator, onApply }: IndicatorParamsEditorProps) {
  const [draft, setDraft] = useState<DraftParams>({
    params: { ...indicator.params } as IndicatorParams,
    lines: indicator.lines.map((l) => ({ ...l })),
    signal: { ...indicator.signal },
  })

  // ── Generic number param update ────────────────────────────────────────────

  function updateParam<K extends keyof IndicatorParams>(key: K, value: number) {
    setDraft((prev) => ({
      ...prev,
      params: { ...prev.params, [key]: value } as IndicatorParams,
    }))
  }

  // ── Line update ────────────────────────────────────────────────────────────

  function updateLine(lineId: string, field: keyof IndicatorLine, value: string | number) {
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)),
    }))
  }

  // ── Signal update ──────────────────────────────────────────────────────────

  function updateSignal<K extends keyof IndicatorSignalRule>(key: K, value: IndicatorSignalRule[K]) {
    setDraft((prev) => ({
      ...prev,
      signal: { ...prev.signal, [key]: value },
    }))
  }

  // ── Apply ──────────────────────────────────────────────────────────────────

  function handleApply() {
    onApply({
      params: draft.params,
      lines: draft.lines,
      signal: draft.signal,
    })
  }

  const { params } = draft
  const signalOpts = getSignalOptions(params.type)
  const hasSignals = signalOpts.buyOptions.length > 0 || signalOpts.sellOptions.length > 0

  return (
    <div className="ind-params-panel">

      {/* ── Param fields per type ── */}
      <div className="ind-params-section">
        <div className="summary-label" style={{ marginBottom: 8 }}>Parameters</div>

        {params.type === 'ema' && (
          <>
            <div className="ind-field-row">
              <label className="summary-label">Fast Period</label>
              <input
                type="number"
                className="scalper-field"
                min={1}
                value={(params as EmaParams).fastPeriod}
                onChange={(e) => updateParam('fastPeriod' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
            <div className="ind-field-row">
              <label className="summary-label">Slow Period</label>
              <input
                type="number"
                className="scalper-field"
                min={1}
                value={(params as EmaParams).slowPeriod}
                onChange={(e) => updateParam('slowPeriod' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
          </>
        )}

        {params.type === 'sma' && (
          <div className="ind-field-row">
            <label className="summary-label">Period</label>
            <input
              type="number"
              className="scalper-field"
              min={1}
              value={(params as SmaParams).period}
              onChange={(e) => updateParam('period' as keyof IndicatorParams, Number(e.target.value))}
            />
          </div>
        )}

        {params.type === 'vwap' && (
          <div className="ind-field-row">
            <span className="summary-label" style={{ fontStyle: 'italic', opacity: 0.7 }}>
              Session-anchored VWAP resets at IST day start
            </span>
          </div>
        )}

        {params.type === 'rsi' && (
          <>
            <div className="ind-field-row">
              <label className="summary-label">Period</label>
              <input
                type="number"
                className="scalper-field"
                min={2}
                value={(params as RsiParams).period}
                onChange={(e) => updateParam('period' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
            <div className="ind-field-row">
              <label className="summary-label">Overbought Level</label>
              <input
                type="number"
                className="scalper-field"
                min={50}
                max={100}
                value={(params as RsiParams).overboughtLevel}
                onChange={(e) => updateParam('overboughtLevel' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
            <div className="ind-field-row">
              <label className="summary-label">Oversold Level</label>
              <input
                type="number"
                className="scalper-field"
                min={0}
                max={50}
                value={(params as RsiParams).oversoldLevel}
                onChange={(e) => updateParam('oversoldLevel' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
          </>
        )}

        {params.type === 'supertrend' && (
          <>
            <div className="ind-field-row">
              <label className="summary-label">ATR Period</label>
              <input
                type="number"
                className="scalper-field"
                min={1}
                value={(params as SupertrendParams).atrPeriod}
                onChange={(e) => updateParam('atrPeriod' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
            <div className="ind-field-row">
              <label className="summary-label">Multiplier</label>
              <input
                type="number"
                className="scalper-field"
                min={0.1}
                step={0.1}
                value={(params as SupertrendParams).multiplier}
                onChange={(e) => updateParam('multiplier' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
          </>
        )}

        {params.type === 'volume_ma' && (
          <>
            <div className="ind-field-row">
              <label className="summary-label">Period</label>
              <input
                type="number"
                className="scalper-field"
                min={1}
                value={(params as VolumeMAParams).period}
                onChange={(e) => updateParam('period' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
            <div className="ind-field-row">
              <label className="summary-label">Spike Multiplier</label>
              <input
                type="number"
                className="scalper-field"
                min={0.1}
                step={0.1}
                value={(params as VolumeMAParams).spikeMultiplier}
                onChange={(e) => updateParam('spikeMultiplier' as keyof IndicatorParams, Number(e.target.value))}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Line colors + thickness ── */}
      {draft.lines.length > 0 && (
        <div className="ind-params-section">
          <div className="summary-label" style={{ marginBottom: 8 }}>Line Style</div>
          {draft.lines.map((line) => (
            <div key={line.id} className="ind-line-row">
              <input
                type="color"
                className="ind-color-swatch"
                value={line.color}
                onChange={(e) => updateLine(line.id, 'color', e.target.value)}
                title="Line color"
              />
              <span className="ind-line-label summary-label">{line.label}</span>
              <div className="ind-thickness-group">
                {[1, 2, 3, 4].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`ind-thickness-btn${line.thickness === t ? ' is-active' : ''}`}
                    onClick={() => updateLine(line.id, 'thickness', t)}
                    title={`Thickness ${t}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Signal colors + conditions ── */}
      {hasSignals && (
        <div className="ind-params-section">
          <div className="summary-label" style={{ marginBottom: 8 }}>Signal Markers</div>

          <div className="ind-signal-row">
            <input
              type="color"
              className="ind-color-swatch"
              value={draft.signal.buyMarkerColor}
              onChange={(e) => updateSignal('buyMarkerColor', e.target.value)}
              title="Buy marker color"
            />
            <span className="summary-label">Buy color</span>

            <select
              className="scalper-field"
              value={draft.signal.buyCondition ?? ''}
              onChange={(e) => updateSignal('buyCondition', (e.target.value || null) as SignalCondition | null)}
            >
              <option value="">— None —</option>
              {signalOpts.buyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="ind-signal-row">
            <input
              type="color"
              className="ind-color-swatch"
              value={draft.signal.sellMarkerColor}
              onChange={(e) => updateSignal('sellMarkerColor', e.target.value)}
              title="Sell marker color"
            />
            <span className="summary-label">Sell color</span>

            <select
              className="scalper-field"
              value={draft.signal.sellCondition ?? ''}
              onChange={(e) => updateSignal('sellCondition', (e.target.value || null) as SignalCondition | null)}
            >
              <option value="">— None —</option>
              {signalOpts.sellOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ── Apply button ── */}
      <div className="ind-params-section ind-params-footer">
        <button
          type="button"
          className="ind-apply-btn primary-button"
          onClick={handleApply}
        >
          Apply Changes
        </button>
      </div>
    </div>
  )
}

// ─── Main IndicatorBuilder component ─────────────────────────────────────────

export default function IndicatorBuilder({
  indicators,
  presets,
  onAddFromPreset,
  onToggle,
  onRemove,
  onRename,
  onUpdate,
  theme = 'dark',
}: IndicatorBuilderProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // ── Rename helpers ─────────────────────────────────────────────────────────

  function startRename(indicator: SavedIndicator) {
    setRenamingId(indicator.id)
    setRenameValue(indicator.name)
  }

  function commitRename(id: string) {
    if (renameValue.trim()) {
      onRename(id, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      commitRename(id)
    } else if (e.key === 'Escape') {
      setRenamingId(null)
      setRenameValue('')
    }
  }

  // ── Toggle expand ──────────────────────────────────────────────────────────

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // ── Remove with confirm ────────────────────────────────────────────────────

  function handleRemove(id: string, name: string) {
    if (window.confirm(`Remove indicator "${name}"?`)) {
      onRemove(id)
      if (expandedId === id) setExpandedId(null)
    }
  }

  // ── Check if preset already added ─────────────────────────────────────────

  function isPresetAdded(preset: IndicatorPreset): boolean {
    const presetName = preset.factory().name
    return indicators.some((ind) => ind.name === presetName)
  }

  return (
    <div className={`ind-builder theme-${theme}`}>

      {/* ── Section 1: Preset Templates ── */}
      <div className="ind-presets-section">
        <div className="ind-section-header">
          <span className="ind-section-title">Indicator Presets</span>
          <span className="ind-section-subtitle summary-label">Click to add to your chart</span>
        </div>

        <div className="ind-preset-grid">
          {presets.map((preset) => {
            const added = isPresetAdded(preset)
            return (
              <div
                key={preset.key}
                className={`ind-preset-card${added ? ' is-added' : ''}`}
              >
                <div className="ind-preset-card-header">
                  <span
                    className="ind-preset-dot"
                    style={{ background: presetDotColor(preset.key) }}
                  />
                  <span className="ind-preset-label">{preset.label}</span>
                </div>
                <p className="ind-preset-desc summary-label">{preset.description}</p>
                <button
                  type="button"
                  className={`ind-preset-add-btn scalper-tool-button${added ? ' is-added' : ''}`}
                  onClick={() => !added && onAddFromPreset(preset.key)}
                  disabled={added}
                  title={added ? 'Already added' : `Add ${preset.label}`}
                >
                  {added ? 'Added ✓' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 2: Saved Indicators ── */}
      <div className="ind-saved-section">
        <div className="ind-section-header">
          <span className="ind-section-title">Your Indicators</span>
          {indicators.length > 0 && (
            <span className="ind-count-badge">{indicators.length}</span>
          )}
        </div>

        {indicators.length === 0 ? (
          <div className="ind-empty-state">
            <span className="summary-label">
              No indicators added yet. Add one from the presets above.
            </span>
          </div>
        ) : (
          <div className="ind-list">
            {indicators.map((indicator) => {
              const isExpanded = expandedId === indicator.id
              const isRenaming = renamingId === indicator.id
              const badgeColor = typeBadgeColor(indicator.params.type)

              return (
                <div
                  key={indicator.id}
                  className={`ind-item${isExpanded ? ' is-expanded' : ''}${!indicator.enabled ? ' is-disabled' : ''}`}
                >
                  {/* ── Item header row ── */}
                  <div className="ind-item-header">

                    {/* Toggle */}
                    <button
                      type="button"
                      className={`ind-toggle${indicator.enabled ? ' is-on' : ''}`}
                      onClick={() => onToggle(indicator.id)}
                      title={indicator.enabled ? 'Disable indicator' : 'Enable indicator'}
                      aria-label={indicator.enabled ? 'Disable' : 'Enable'}
                    >
                      <span className="ind-toggle-knob" />
                    </button>

                    {/* Name — inline editable */}
                    {isRenaming ? (
                      <input
                        type="text"
                        className="ind-rename-input scalper-field"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(indicator.id)}
                        onKeyDown={(e) => handleRenameKeyDown(e, indicator.id)}
                      />
                    ) : (
                      <span
                        className="ind-name"
                        onDoubleClick={() => startRename(indicator)}
                        title="Double-click to rename"
                      >
                        {indicator.name}
                      </span>
                    )}

                    {/* Rename button (pencil icon) */}
                    {!isRenaming && (
                      <button
                        type="button"
                        className="ind-edit-btn scalper-tool-button"
                        onClick={() => startRename(indicator)}
                        title="Rename"
                        aria-label="Rename indicator"
                      >
                        ✎
                      </button>
                    )}

                    {/* Type badge */}
                    <span
                      className="ind-type-badge"
                      style={{ background: badgeColor }}
                    >
                      {typeBadgeLabel(indicator.params.type)}
                    </span>

                    {/* Spacer */}
                    <span className="ind-item-spacer" />

                    {/* Expand chevron */}
                    <button
                      type="button"
                      className={`ind-expand-btn scalper-tool-button${isExpanded ? ' is-expanded' : ''}`}
                      onClick={() => toggleExpand(indicator.id)}
                      title={isExpanded ? 'Collapse' : 'Edit parameters'}
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      className="ind-delete-btn scalper-tool-button"
                      onClick={() => handleRemove(indicator.id, indicator.name)}
                      title="Remove indicator"
                      aria-label="Remove indicator"
                    >
                      ×
                    </button>
                  </div>

                  {/* ── Inline params editor ── */}
                  {isExpanded && (
                    <IndicatorParamsEditor
                      indicator={indicator}
                      onApply={(changes) => onUpdate(indicator.id, changes)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
