# `nubra_backtester` — Complete Deep Dive

## 1. Module Architecture (Is It Modular?)

**Yes, very modular.** Six files with strict single responsibilities:

| File | Role |
|---|---|
| `models.py` | Pydantic/dataclass schema definitions — input AND output |
| `indicator_registry.py` | Indicator catalog, resolution, validation, signature hashing |
| `indicators.py` | TA-Lib bridge — computes indicators from a DataFrame |
| `engine.py` | `NubraIndicatorEngine` — data fetching, warmup, OHLCV preprocessing |
| `strategy_engine.py` | `NubraStrategyEngine` — backtest loop, live eval, metrics, trade execution |
| `strategy_presets.py` | 10 built-in example strategy dicts, used by the Streamlit playground |

**Inheritance chain:**
```
NubraIndicatorEngine
    └── NubraStrategyEngine   (inherits: fetch, warmup, data utilities)
```

You can use `NubraIndicatorEngine` standalone to just compute indicators on market data — no strategy needed.

---

## 2. Full Input Schema — `Strategy`

The single top-level input object is `Strategy`. It is a strict Pydantic model (`extra="forbid"` — no unknown keys allowed).

```python
Strategy(
    instruments: list[str],   # min_length=1, e.g. ["HDFCBANK", "INFY"]
    chart: ChartSpec,
    entry: EntrySpec,
    exit: ExitSpec,
    execute: ExecuteSpec,
)
```

### 2.1 `instruments`

- **Type:** `list[str]`, minimum 1 item.
- Auto-normalized to **uppercase**, de-duplicated (order preserved, first occurrence wins).
- Capital is **split equally** across all instruments: `capital_per_instrument = initial_capital / len(instruments)`.

---

### 2.2 `ChartSpec`

```python
ChartSpec(
    type: str = "Candlestick",   # ONLY "Candlestick" supported
    interval: str,               # required, e.g. "1d", "15m", "1h"
)
```

**Supported interval formats:**

| Format | Examples | Notes |
|---|---|---|
| Seconds | `30s`, `15s` | Intraday |
| Minutes | `1m`, `5m`, `15m` | Intraday |
| Hours | `1h`, `4h` | Intraday |
| Daily | `1d` | Positional |
| Weekly | `1w` | Positional |
| Monthly | `1mt` | Positional |

- `type` is case-insensitive, normalized to `"Candlestick"`.
- `interval` is lowercased and must be non-empty.

---

### 2.3 `EntrySpec`

```python
EntrySpec(
    side: Side,                     # "BUY" or "SELL" (LONG/SHORT accepted with deprecation warning)
    conditions: ConditionGroup,     # or flat list[Condition] for backward compat
)
```

- **Rules:**
  - `conditions` must have at least one item.
  - Passing a flat `list[Condition]` is auto-wrapped as `ConditionGroup(logic="AND", items=[...])`.
  - `side = "LONG"` is accepted but deprecated → maps to `"BUY"`.
  - `side = "SHORT"` is accepted but deprecated → maps to `"SELL"`.

---

### 2.4 `ExitSpec`

```python
ExitSpec(
    mode: ExitMode = "condition",   # "condition" | "sl_tgt" | "both"
    conditions: ConditionGroup | None = None,
    stop_loss_pct: float | None = None,
    target_pct: float | None = None,
)
```

**Mode rules (strictly enforced):**

| `mode` | `conditions` | `stop_loss_pct` / `target_pct` |
|---|---|---|
| `"condition"` | **Required** (non-empty) | Ignored |
| `"sl_tgt"` | Not needed | **At least one of SL or TGT required** |
| `"both"` | **Required** (non-empty) | **At least one of SL or TGT required** |

- `stop_loss_pct` and `target_pct` must be **> 0** when provided.
- In `"both"` mode, whichever fires first exits the trade — condition signal at bar close, or SL/TGT within the bar's OHLC range.

---

### 2.5 `ExecuteSpec`

```python
ExecuteSpec(
    initial_capital: float,                           # > 0, required
    start_date: date | str,                           # e.g. "2026-01-01"
    end_date: date | str,                             # >= start_date
    start_time: time | str | None = None,             # session window start
    end_time: time | str | None = None,               # session window end
    holding_type: HoldingType = "positional",         # "positional" | "intraday"
    exchange: str = "NSE",                            # auto-uppercased
    instrument_type: str = "STOCK",                   # auto-uppercased
    real_time: bool = False,
    execution_style: ExecutionStyle = "same_bar_close",  # "same_bar_close" | "next_bar_open"
    cost_config: CostConfig | None = None,            # brokerage model
    stop_target_conflict: ConflictResolution = "stop",   # "stop" | "target"
)
```

**Key rules:**
- `end_date` must be >= `start_date`.
- `holding_type = "intraday"` requires a chart interval ending in `s`, `m`, or `h`.
- When `holding_type = "intraday"` and `start_time`/`end_time` are omitted, they default to NSE session: **09:15–15:30**.
- `start_time`/`end_time` accept `time` objects or string timestamps (time part is extracted).

---

### 2.6 `CostConfig` (optional brokerage model)

```python
CostConfig(
    # Delivery
    delivery_brokerage_pct: float = 0.0,   # % of trade value per order leg
    delivery_brokerage_flat: float = 0.0,  # ₹ cap (0 = no cap)

    # Intraday (Zerodha defaults match real pricing)
    intraday_brokerage_pct: float = 0.03,
    intraday_brokerage_flat: float = 20.0,

    # Placeholders (wired to 0.0, not yet implemented)
    stt_intraday_sell_pct,
    stt_delivery_sell_pct,
    exchange_charges_pct,
    gst_on_charges_pct,
    sebi_charges_pct,
)
```

- Brokerage per order = `min(value × pct/100, flat_cap)` — if `flat_cap = 0`, no cap is applied.
- **Round-trip brokerage** = entry leg + exit leg (both computed and summed).
- When `None`, all fills are frictionless.

---

### 2.7 `ConditionGroup` and `Condition` — The Condition System

#### `ConditionGroup`

```python
ConditionGroup(
    logic: "AND" | "OR",
    items: list[Condition | ConditionGroup],   # infinitely nestable
)
```

- Supports **unlimited nesting depth**: `AND(OR, OR)`, `OR(AND, AND(OR(...)))`, etc.
- Evaluation uses **short-circuit logic**: AND stops on first False, OR stops on first True.

#### `Condition`

```python
Condition(
    lhs: IndicatorExpr,
    op: Operator,
    rhs: IndicatorExpr | NumberRange | float,
)
```

#### `IndicatorExpr` — one side of a condition

```python
IndicatorExpr(
    type: str,              # indicator type, e.g. "RSI", "EMA", "MACD"
    params: dict = {},      # indicator parameters
    output: str | None,     # for multi-output indicators (e.g. "macd_line")
    offset: int = 0,        # bar shift, 0 = current bar, 1 = previous bar

    # Cross-timeframe / cross-symbol overrides
    symbol: str | None,
    interval: str | None,   # e.g. "1d" while chart is "15m"
    exchange: str | None,
    instrument_type: str | None,
)
```

> [!IMPORTANT]
> Cross-timeframe works by fetching the external symbol/interval data separately, computing indicators on it, and aligning to the chart timestamps using **`merge_asof(direction="backward")`** — the last completed bar only, no lookahead.

#### `Operator` — all supported operators

| Operator | Needs Previous Bar? | RHS Type | Description |
|---|---|---|---|
| `greater_than` | No | number / indicator | lhs > rhs |
| `less_than` | No | number / indicator | lhs < rhs |
| `greater_equal` | No | number / indicator | lhs >= rhs |
| `less_equal` | No | number / indicator | lhs <= rhs |
| `equal` | No | number / indicator | lhs ≈ rhs (rel_tol=1e-9) |
| `crosses_above` | **Yes** | number / indicator | prev < rhs AND curr > rhs |
| `crosses_below` | **Yes** | number / indicator | prev > rhs AND curr < rhs |
| `up_by` | **Yes** | number only | (curr − prev) >= threshold |
| `down_by` | **Yes** | number only | (prev − curr) >= threshold |
| `within_range` | No | `NumberRange` only | low <= lhs <= high |

#### `NumberRange` (for `within_range`)

```python
NumberRange(low: float, high: float)   # high must be >= low
```

---

## 3. Supported Indicators

All indicators are defined in `INDICATOR_PARAMETER_CATALOG`. The `type` field is **case-insensitive** (normalized to uppercase).

| Type | Params | Outputs | Notes |
|---|---|---|---|
| `PRICE` | `source` (default: `close`), `offset` | — | Raw price series |
| `VOLUME` | `offset` | — | Raw volume series |
| `RSI` | `length` (default: 14), `source` (default: `close`), `offset` | — | Bounded 0–100 |
| `SMA` | `source`, `period` (default: 9), `offset` | — | |
| `EMA` | `source`, `period` (default: 9), `offset` | — | |
| `WMA` | `source`, `period` (default: 9), `offset` | — | |
| `VWAP` | `source` (default: `hlc3`), `anchor` (default: `session`), `offset` | — | Anchors: `session`, `week`, `month` |
| `BB` | `source`, `length` (default: 20), `std_dev_up/down` (default: 2.0), `ma_type`, `output` | `upper_band`, `middle_band`, `lower_band` | Default output: `middle_band` |
| `PSAR` | `start` (0.02), `increment` (0.02), `max_value` (0.2), `offset` | — | Uses TA-Lib SAREXT |
| `MACD` | `source`, `fast_length` (12), `slow_length` (26), `signal_length` (9), `output` | `macd_line`, `signal_line`, `histogram` | Default output: `macd_line` |
| `STOCH` | `k_length` (14), `smooth_k` (3), `d_length` (3), `k_ma_type`, `d_ma_type`, `output` | `k_line`, `d_line` | Bounded 0–100 |
| `CCI` | `length` (default: 20), `offset` | — | Source always `hlc3` |
| `ADX` | `length` (default: 14), `output` | `adx_value`, `plus_di`, `minus_di` | |
| `ATR` | `length` (default: 14), `offset` | — | |
| `OBV` | `offset` | — | |

**Source options:**
- Price sources: `open`, `high`, `low`, `close`, `hl2`, `hlc3`, `ohlc4`
- Plus `volume` for SMA, EMA, WMA, BB

**MA types (for BB, STOCH):** `SMA`, `EMA`, `WMA`, `DEMA`, `TEMA`, `TRIMA`, `KAMA`, `MAMA`, `T3`

### Condition contract rules (what can compare against what)

| LHS Indicator | Can compare against |
|---|---|
| `PRICE`, `SMA`, `EMA`, `WMA`, `VWAP`, `PSAR`, `BB` | Another price-level indicator, or a number |
| `VOLUME`, `OBV` | Another volume-level indicator, or a number |
| `RSI`, `STOCH` (bounded 0–100) | Number only (must be within 0–100 if numeric), or same family |
| `MACD` | Another `MACD` output, or number |
| `ADX` (`plus_di`/`minus_di`) | Another ADX output, or number |
| `CCI`, `ATR` | Number only |
| Any | `within_range` requires `NumberRange`; `up_by`/`down_by` require a plain number |

---

## 4. Execution Styles

### `same_bar_close` (default)
- Signal fires on bar N → fill at bar N's **close price**, bar N's timestamp.
- Zero lag — if RSI crosses above 30 on today's close, you're filled at today's close.
- This is the **look-ahead risk** mode (realistic for EOD strategies where close is known at signal time).

### `next_bar_open`
- Signal fires on bar N → fill at bar N+1's **open price**, bar N+1's timestamp.
- Academically safer — simulates placing a market order at EOD for next-day execution.
- Stop-loss/target checks still use each bar's full OHLC range.

---

## 5. Backtest Loop — Step-by-Step Internals

The loop runs `_backtest_symbol()` for each instrument sequentially.

```
For each bar (idx) in the filtered DataFrame:

  Phase A: Settle pending fills (NEXT_BAR_OPEN only)
    - If pending_exit exists → close position at current open
    - If pending_entry exists → open position at current open

  Phase B: Stop-loss / Target check (runs for ALL open positions, BOTH styles)
    - Gap-through check: if open <= stop (BUY) → exit at open
    - Intrabar check: if low <= stop → exit at stop
    - Gap-through check: if open >= target (BUY) → exit at open  
    - Intrabar check: if high >= target → exit at target
    - Conflict (both hit same bar): use stop_target_conflict setting

  Phase C: Signal-driven actions
    SAME_BAR_CLOSE:
      1. If in position + exit_signal → close at close price
      2. If in position + session_must_close → close at close price
      3. If flat + entry_signal + session_allows_entry → open at close price

    NEXT_BAR_OPEN:
      1. If in position + session_must_close → close at close price (immediate)
      2. If flat + entry_signal → schedule pending_entry for next bar
      3. If in position + exit_signal → schedule pending_exit for next bar

  Equity point appended:
    - Flat: equity = current capital
    - In position: equity = capital + unrealized PnL at close price

End of backtest:
  - Any open position is force-closed at the last bar's close price
  - exit_reason = "end_of_backtest"
```

**Session enforcement (intraday only):**
- `session_allows_entry`: `start_time <= current_time < end_time`
- `session_must_close`: `current_time >= end_time` OR next bar is a different day

---

## 6. Capital & Position Sizing

- Capital is split **equally per instrument** at strategy start: `capital_per_instrument = initial_capital / N`.
- Position size (quantity): `quantity = current_capital / entry_price` (full capital deployment, no fractional sizing controls exposed).
- Capital compounds within each instrument — after each closed trade, the new capital is `old_capital + trade.pnl`.
- Instruments don't share capital — they're completely independent sub-portfolios.

---

## 7. SL/TGT Price Calculation

```
BUY side:
  stop_loss_price  = entry_price × (1 - stop_loss_pct / 100)
  target_price     = entry_price × (1 + target_pct / 100)

SELL side:
  stop_loss_price  = entry_price × (1 + stop_loss_pct / 100)
  target_price     = entry_price × (1 - target_pct / 100)
```

---

## 8. Data Fetching & Warmup

The engine handles warmup automatically:

1. Computes `warmup_bars_required` = max lookback among all indicators (via TA-Lib `.lookback`) + `offset`.
2. Adds `warmup_buffer_bars` (default 300) extra bars as safety margin.
3. Fetches from `_estimate_fetch_start(requested_start, interval, warmup_bars)` — session-aware math per interval type.
4. If actual warmup rows fetched < required, **re-fetches** up to `max_refetch_attempts` (default 4) times, expanding the window.
5. After indicators are applied, trims data to `[requested_start, requested_end]`.

**OHLCV preprocessing:**
- Timezone conversion to `Asia/Kolkata` (configurable).
- Paise→Rupee conversion via a heuristic (`close.mean() > 10000`).
- Intraday volume: cumulative volume from API is converted to **per-bar volume** via `diff()`, with session-reset detection.
- Weekend rows and NaN OHLC rows are **dropped with warnings** before the loop.

---

## 9. Output Schema

### `StrategyBacktestResult` (top-level return from `.backtest()`)

```python
StrategyBacktestResult(
    mode: str = "backtest",
    strategy: Strategy,                          # the validated input strategy
    instruments: list[InstrumentBacktestResult],
    portfolio: PortfolioMetrics,
)
```

### `InstrumentBacktestResult` (per symbol)

```python
InstrumentBacktestResult(
    symbol: str,
    bars_processed: int,
    fetched_start: datetime,
    fetched_end: datetime,
    requested_start: datetime,
    requested_end: datetime,
    warmup_bars_required: int,
    warmup_rows_available: int,
    fetch_attempts: int,
    request_payload: dict,              # raw API call payload
    final_indicator_values: dict[str, float | None],
    daily_signal_log: list[DailySignalLogRow],
    triggered_days: list[DailySignalLogRow],  # subset: only bars with a signal/action
    metrics: InstrumentMetrics,
    trades: list[Trade],
    equity_curve: list[EquityPoint],
)
```

### `Trade`

```python
Trade(
    symbol: str,
    side: Side,                  # "BUY" or "SELL"
    entry_timestamp: datetime,
    exit_timestamp: datetime,
    entry_price: float,
    exit_price: float,
    quantity: float,
    pnl: float,                  # net PnL after brokerage
    pnl_pct: float,              # net PnL % of capital deployed
    bars_held: int,              # 0 = same-bar entry+exit
    exit_reason: str,            # "stop_loss" | "target" | "exit_condition" | "session_end" | "end_of_backtest"
    brokerage: float,            # round-trip brokerage in ₹
)
```

### `InstrumentMetrics`

```python
InstrumentMetrics(
    starting_capital: float,
    ending_capital: float,
    gross_profit: float,
    gross_loss: float,
    net_pnl: float,
    return_pct: float,
    total_trades: int,
    winning_trades: int,
    losing_trades: int,
    win_rate_pct: float,
    avg_pnl: float,
    avg_pnl_pct: float,
    profit_factor: float | None,    # None if no losing trades
    max_drawdown_pct: float,
    total_brokerage: float,
)
```

### `PortfolioMetrics`

```python
PortfolioMetrics(
    starting_capital: float,
    ending_capital: float,
    gross_profit: float,
    gross_loss: float,
    net_pnl: float,
    return_pct: float,
    total_trades: int,
    winning_trades: int,
    losing_trades: int,
    win_rate_pct: float,
    profit_factor: float | None,
    max_drawdown_pct: float,
    capital_per_instrument: float,
    equity_curve: list[EquityPoint],   # merged across all instruments via ffill
    total_brokerage: float,
)
```

**Portfolio equity curve merging:** Per-instrument equity curves are aligned on timestamp, forward-filled, and summed — so the portfolio curve represents the total account equity at each point in time.

### `DailySignalLogRow` (one per bar)

```python
DailySignalLogRow(
    timestamp: datetime,
    open, high, low, close: float,
    volume: float | None,
    indicator_values: dict[str, float | None],  # all indicator values on this bar
    entry_signal: bool,
    exit_signal: bool,
    entry_conditions: list[ConditionEvaluation],
    exit_conditions: list[ConditionEvaluation],
    action: str,          # e.g. "enter_buy", "exit_stop_loss", "hold", pipe-delimited if multiple
    position_state: str,  # "flat" | "open_buy" | "open_sell"
    stop_loss_price: float | None,
    target_price: float | None,
)
```

### `ConditionEvaluation` (per condition in the log)

```python
ConditionEvaluation(
    lhs: IndicatorExpr,
    op: Operator,
    rhs: IndicatorExpr | NumberRange | float,
    matched: bool,
    lhs_value: float | None,
    rhs_value: float | dict[str, float] | None,
    lhs_previous: float | None,   # for cross/delta operators
    rhs_previous: float | None,
    message: str | None,          # set when evaluation fails (e.g. insufficient data)
)
```

### `StrategySignalResult` (live/real-time mode)

```python
StrategySignalResult(
    mode: str = "realtime",
    strategy: Strategy,
    instruments: list[LiveInstrumentResult],
)

LiveInstrumentResult(
    symbol: str,
    as_of: datetime,
    last_price: float,
    final_indicator_values: dict[str, float | None],
    entry_signal: bool,
    exit_signal: bool,
    session_allows_entry: bool,
    action_if_flat: str,           # e.g. "enter_buy" or "hold"
    action_if_in_position: str,    # "exit" or "hold"
    suggested_stop_loss_price: float | None,
    suggested_target_price: float | None,
    entry_conditions: list[ConditionEvaluation],
    exit_conditions: list[ConditionEvaluation],
    ...fetch metadata fields...
)
```

---

## 10. Public API

```python
engine = NubraStrategyEngine.from_sdk(env="PROD")

# Backtest
result: StrategyBacktestResult = engine.backtest(strategy_dict)
result_json: dict = engine.backtest_json(strategy_dict)

# Live signal
signal: StrategySignalResult = engine.evaluate_realtime(strategy_dict, as_of=None)
signal_json: dict = engine.evaluate_realtime_json(strategy_dict)

# Indicator introspection
catalog: list[dict] = engine.indicator_catalog()
caps: dict = engine.condition_capabilities("RSI")

# Standalone indicator calculation (no strategy)
result: IndicatorRunResult = engine.calculate(
    symbol="HDFCBANK",
    start="2026-01-01",
    end="2026-03-31",
    indicators=[{"type": "RSI", "params": {"length": 14}}],
    interval="1d",
)
```

---

## 11. Key Design Notes / Gotchas

1. **`extra="forbid"` everywhere** — passing any unknown key raises a validation error immediately. No silent field ignoring.
2. **Indicator signatures are SHA1-hashed** into short column names (`ind_<12hex>`) to avoid DataFrame column conflicts.
3. **SL/TGT is checked at the START of each bar** (using the full OHLC range of that bar), before condition-based exits are checked. Gap-through at open is handled correctly.
4. **`bars_held = 0`** is valid and means entry and exit happened on the same bar.
5. **Cross-timeframe** indicators are grouped by `(symbol, interval, exchange, instrument_type)` and fetched in separate API calls, then `merge_asof(backward)` aligned to the chart.
6. **Portfolio capital is NOT shared intraday** — each instrument trades independently with its own capital slice, so two instruments can both be in positions simultaneously.
7. **Warmup buffer of 300 extra bars** is added by default to avoid edge cases where TA-Lib needs more history than the exact lookback suggests.
8. **`real_time=False`** is hardcoded in `_prepare_symbol_data` for strategy runs — real-time mode is a standalone flag on the engine.
