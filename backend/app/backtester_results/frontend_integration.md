# Nubra Strategy Engine — Frontend Integration Reference

## Architecture

The engine is cleanly separated into 3 layers. The frontend only touches the top layer via JSON.

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND  (React, Vue, mobile, CLI, Streamlit, …)      │
│  sends:  Strategy JSON                                  │
│  gets:   StrategyBacktestResult JSON  or                │
│          StrategySignalResult JSON                      │
└────────────────────┬────────────────────────────────────┘
                     │  pure JSON in / pure JSON out
┌────────────────────▼────────────────────────────────────┐
│  STRATEGY ENGINE  (nubra_backtester Python package)     │
│  engine.backtest_json(strategy_dict)        → dict      │
│  engine.evaluate_realtime_json(strat, as_of) → dict     │
└────────────────────┬────────────────────────────────────┘
                     │  internal
┌────────────────────▼────────────────────────────────────┐
│  MARKET DATA SDK  (nubra_python_sdk)                    │
│  fetches OHLCV candles + computes indicators            │
└─────────────────────────────────────────────────────────┘
```

---

## INPUT — Strategy JSON

### Top-level shape

```json
{
  "instruments": ["HDFCBANK", "INFY"],
  "chart":   { ... },
  "entry":   { ... },
  "exit":    { ... },
  "execute": { ... }
}
```

---

### `chart`

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | Always `"Candlestick"` (only supported value) |
| `interval` | string | yes | See interval table below |

**Valid intervals**

| Category | Values |
|---|---|
| Daily / swing | `"1d"` `"1w"` `"1mt"` |
| Intraday hours | `"1h"` `"4h"` |
| Intraday minutes | `"1m"` `"3m"` `"5m"` `"10m"` `"15m"` `"30m"` |
| Intraday seconds | any `"Xs"` format |

---

### `entry`

```json
{
  "side": "BUY",
  "conditions": { ... }
}
```

| Field | Type | Values |
|---|---|---|
| `side` | string | `"BUY"` or `"SELL"` |
| `conditions` | ConditionGroup | See [ConditionGroup](#conditiongroup) below |

---

### `exit`

```json
{
  "mode": "sl_tgt",
  "stop_loss_pct": 3.0,
  "target_pct": 6.0
}
```

| `mode` | Required fields | Meaning |
|---|---|---|
| `"sl_tgt"` | `stop_loss_pct` and/or `target_pct` | Pure SL / target — no condition |
| `"condition"` | `conditions` (ConditionGroup) | Exit only when condition fires |
| `"both"` | `conditions` **and** `stop_loss_pct`/`target_pct` | Whichever triggers first |

---

### ConditionGroup

Recursive — used in both `entry.conditions` and `exit.conditions`. Nesting is unlimited.

```json
{
  "logic": "AND",
  "items": [
    { "lhs": { ... }, "op": "crosses_above", "rhs": 30 },
    {
      "logic": "OR",
      "items": [
        { "lhs": { ... }, "op": "greater_than", "rhs": { ... } },
        { "lhs": { ... }, "op": "less_than",    "rhs": 50 }
      ]
    }
  ]
}
```

| Field | Type | Values |
|---|---|---|
| `logic` | string | `"AND"` or `"OR"` |
| `items` | array | Any mix of **Condition** objects and nested **ConditionGroup** objects |

> **Backward compat:** a flat `list[Condition]` (no `logic`/`items` wrapper) is accepted and auto-wrapped as an AND group.

---

### Condition

```json
{
  "lhs": { "type": "RSI", "params": { "length": 14 } },
  "op":  "crosses_above",
  "rhs": 30
}
```

| Field | Type | Notes |
|---|---|---|
| `lhs` | IndicatorExpr | Left-hand side |
| `op` | Operator string | See [Operators](#operators) table |
| `rhs` | `IndicatorExpr` **or** `number` **or** `{ "low": N, "high": N }` | Type depends on operator — see table |

**RHS type rules by operator**

| Operator | Allowed RHS |
|---|---|
| `greater_than`, `less_than`, `greater_equal`, `less_equal`, `equal`, `crosses_above`, `crosses_below` | number **or** IndicatorExpr |
| `up_by`, `down_by` | number only (absolute delta) |
| `within_range` | `{ "low": N, "high": N }` only |

---

### Operators

| Value | Meaning |
|---|---|
| `crosses_above` | LHS crosses from below to above RHS (requires previous bar) |
| `crosses_below` | LHS crosses from above to below RHS (requires previous bar) |
| `greater_than` | LHS > RHS |
| `less_than` | LHS < RHS |
| `greater_equal` | LHS ≥ RHS |
| `less_equal` | LHS ≤ RHS |
| `equal` | LHS = RHS |
| `up_by` | LHS has risen by at least N from previous bar |
| `down_by` | LHS has fallen by at least N from previous bar |
| `within_range` | `low ≤ LHS ≤ high` |

---

### IndicatorExpr

```json
{
  "type":            "EMA",
  "params":          { "period": 50, "source": "close" },
  "output":          null,
  "offset":          0,
  "symbol":          null,
  "interval":        "1d",
  "exchange":        null,
  "instrument_type": null
}
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | Indicator type string — see table below |
| `params` | yes | Indicator-specific parameters — see table below |
| `output` | no | Selects one output for multi-output indicators (MACD, BB, STOCH, ADX) |
| `offset` | no | Shift N bars into the past. `0` = current bar |
| `symbol` | no | Override to a different instrument (cross-symbol condition) |
| `interval` | no | Override to a different timeframe (cross-timeframe condition) |
| `exchange` | no | Override exchange for the cross-symbol instrument |
| `instrument_type` | no | Override instrument type for the cross-symbol instrument |

> Cross-timeframe values are aligned to the chart using the **last completed bar** (`merge_asof` backward) — no lookahead bias.

**`source` valid values:** `"close"` `"open"` `"high"` `"low"` `"hl2"` `"hlc3"` `"ohlc4"`

---

### Supported indicators

| `type` | `params` | `output` options | Default output |
|---|---|---|---|
| `PRICE` | `source` | — | — |
| `VOLUME` | — | — | — |
| `RSI` | `length`, `source` | — | — |
| `EMA` | `period`, `source` | — | — |
| `SMA` | `period`, `source` | — | — |
| `WMA` | `period`, `source` | — | — |
| `MACD` | `fast_length`, `slow_length`, `signal_length`, `source` | `macd_line`, `signal_line`, `histogram` | `macd_line` |
| `BB` | `length`, `std_dev_up`, `std_dev_down`, `source` | `upper_band`, `middle_band`, `lower_band` | `middle_band` |
| `STOCH` | `k_length`, `smooth_k`, `d_length` | `k_line`, `d_line` | `k_line` |
| `VWAP` | `source`, `anchor` | — | — |
| `CCI` | `length` | — | — |
| `ADX` | `length` | `adx_value`, `plus_di`, `minus_di` | `adx_value` |
| `ATR` | `length` | — | — |
| `OBV` | — | — | — |
| `PSAR` | `start`, `increment`, `max_value` | — | — |

**`VWAP` anchor values:** `"session"` `"week"` `"month"`

---

### `execute`

```json
{
  "initial_capital":      100000,
  "start_date":           "2026-01-01",
  "end_date":             "2026-03-31",
  "start_time":           "09:15",
  "end_time":             "15:30",
  "holding_type":         "positional",
  "exchange":             "NSE",
  "instrument_type":      "STOCK",
  "execution_style":      "same_bar_close",
  "stop_target_conflict": "stop",
  "cost_config":          { ... }
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `initial_capital` | float | yes | — | Total capital; split equally across instruments |
| `start_date` | `"YYYY-MM-DD"` | yes | — | Backtest window start |
| `end_date` | `"YYYY-MM-DD"` | yes | — | Backtest window end |
| `start_time` | `"HH:MM"` | no | `"09:15"` | Intraday session open. Auto-filled for intraday strategies |
| `end_time` | `"HH:MM"` | no | `"15:30"` | Intraday session close. Auto-filled for intraday strategies |
| `holding_type` | string | no | `"positional"` | `"positional"` or `"intraday"` |
| `exchange` | string | no | `"NSE"` | `"NSE"`, `"BSE"`, etc. |
| `instrument_type` | string | no | `"STOCK"` | `"STOCK"`, `"INDEX"`, etc. |
| `execution_style` | string | no | `"same_bar_close"` | `"same_bar_close"` or `"next_bar_open"` |
| `stop_target_conflict` | string | no | `"stop"` | `"stop"` or `"target"` |
| `cost_config` | object or null | no | `null` (frictionless) | See below |

**`execution_style`**

| Value | Behaviour |
|---|---|
| `same_bar_close` | Signal fires on bar N → fill at bar N's close. No lag. |
| `next_bar_open` | Signal fires on bar N → fill at bar N+1's open. Academically conservative; prevents lookahead. |

**`stop_target_conflict`** — resolves the ambiguous case where both SL and target are hit within the same bar (no tick data):

| Value | Behaviour |
|---|---|
| `stop` | Assume stop was touched first (conservative) |
| `target` | Assume target was touched first (optimistic) |

**`cost_config`**

```json
{
  "intraday_brokerage_pct":   0.03,
  "intraday_brokerage_flat":  20.0,
  "delivery_brokerage_pct":   0.0,
  "delivery_brokerage_flat":  0.0
}
```

Per order: `brokerage = min(trade_value × pct / 100, flat_cap)`. Round-trip = 2 orders (entry + exit). Omit `cost_config` entirely for frictionless simulation.

---

## OUTPUT — Backtest Result

Returned by `engine.backtest_json(strategy_dict)`.

```
StrategyBacktestResult
│
├── mode: "backtest"
├── strategy: Strategy          ← echo of validated + normalised input
│
├── portfolio: PortfolioMetrics
│   ├── starting_capital
│   ├── ending_capital
│   ├── gross_profit
│   ├── gross_loss
│   ├── net_pnl
│   ├── return_pct
│   ├── total_trades
│   ├── winning_trades
│   ├── losing_trades
│   ├── win_rate_pct
│   ├── profit_factor           ← null if no winning trades
│   ├── max_drawdown_pct
│   ├── capital_per_instrument
│   ├── total_brokerage
│   └── equity_curve: [ { timestamp, equity }, … ]
│
└── instruments: [ InstrumentBacktestResult, … ]
    │
    ├── symbol
    ├── bars_processed
    ├── fetched_start / fetched_end        ← actual data window returned by API
    ├── requested_start / requested_end    ← strategy window from execute spec
    ├── warmup_bars_required               ← bars needed before start for indicator warmup
    ├── warmup_rows_available              ← bars actually available before start
    ├── fetch_attempts                     ← number of API retries needed
    ├── request_payload                    ← raw API request sent (debug)
    ├── final_indicator_values: { name: value }   ← snapshot at last bar
    │
    ├── metrics: InstrumentMetrics
    │   ├── starting_capital, ending_capital
    │   ├── gross_profit, gross_loss
    │   ├── net_pnl, return_pct
    │   ├── total_trades, winning_trades, losing_trades
    │   ├── win_rate_pct, avg_pnl, avg_pnl_pct
    │   ├── profit_factor
    │   ├── max_drawdown_pct
    │   └── total_brokerage
    │
    ├── trades: [ Trade, … ]
    │   ├── symbol
    │   ├── side                  "BUY" | "SELL"
    │   ├── entry_timestamp
    │   ├── exit_timestamp
    │   ├── entry_price
    │   ├── exit_price
    │   ├── quantity
    │   ├── pnl                   net after brokerage
    │   ├── pnl_pct               % of capital deployed
    │   ├── brokerage             total round-trip brokerage deducted
    │   ├── bars_held             0 = same-bar entry+exit
    │   └── exit_reason           "stop_loss" | "target" | "condition" | "session_end" | …
    │
    ├── equity_curve: [ { timestamp, equity }, … ]
    │
    ├── triggered_days: [ DailySignalLogRow, … ]
    │   └── (only bars where action ≠ "hold" — useful for a trade diary view)
    │
    └── daily_signal_log: [ DailySignalLogRow, … ]
        └── (every bar — use for full signal replay / export)
```

**DailySignalLogRow** (used in both `triggered_days` and `daily_signal_log`):

```
DailySignalLogRow
├── timestamp
├── open, high, low, close, volume
├── indicator_values: { "EMA(50)": 1234.5, "RSI(14)": 62.3, … }
├── entry_signal: bool
├── exit_signal:  bool
├── action:         "enter_long" | "exit_long" | "enter_short" | "exit_short" | "hold" | …
├── position_state: "flat" | "long" | "short"
├── stop_loss_price    ← null when flat
├── target_price       ← null when flat
├── entry_conditions: [ ConditionEvaluation, … ]
└── exit_conditions:  [ ConditionEvaluation, … ]
```

**ConditionEvaluation** (short-circuit — only evaluated conditions are included):

```json
{
  "lhs":          { "type": "RSI", "params": { "length": 14 } },
  "op":           "crosses_above",
  "rhs":          30,
  "matched":      true,
  "lhs_value":    31.4,
  "rhs_value":    30.0,
  "lhs_previous": 28.7,
  "rhs_previous": 30.0,
  "message":      null
}
```

> For AND groups, evaluation stops at the first `false`. For OR groups, it stops at the first `true`. Only conditions actually evaluated appear in this list.

---

## OUTPUT — Realtime Signal

Returned by `engine.evaluate_realtime_json(strategy_dict, as_of="2026-04-20T14:30:00")`.

```
StrategySignalResult
│
├── mode: "realtime"
├── strategy: Strategy
│
└── instruments: [ LiveInstrumentResult, … ]
    ├── symbol
    ├── as_of                      ← effective evaluation timestamp
    ├── fetched_start / fetched_end
    ├── last_price
    ├── final_indicator_values: { name: value }
    ├── entry_signal: bool
    ├── exit_signal:  bool
    ├── session_allows_entry: bool ← false outside start_time / end_time window
    ├── action_if_flat:         "enter_long" | "enter_short" | "do_nothing"
    ├── action_if_in_position:  "exit_long"  | "exit_short"  | "hold"
    ├── suggested_stop_loss_price  ← null if no SL configured
    ├── suggested_target_price     ← null if no target configured
    ├── entry_conditions: [ ConditionEvaluation, … ]
    └── exit_conditions:  [ ConditionEvaluation, … ]
```

---

## Frontend UI Checklist

Everything the strategy builder form needs to expose:

```
Strategy Builder
│
├── Instruments        text / multi-select  →  instruments[]
├── Chart interval     dropdown             →  chart.interval
│
├── Entry side         toggle BUY / SELL    →  entry.side
├── Entry logic        toggle AND / OR      →  entry.conditions.logic
├── Entry conditions   recursive builder    →  entry.conditions.items
│
├── Exit mode          radio                →  exit.mode
│   ├── [sl_tgt]    SL % + Target %         →  stop_loss_pct, target_pct
│   ├── [condition] condition builder       →  exit.conditions
│   └── [both]      both panels visible
│
└── Execute settings
    ├── Capital                             →  initial_capital
    ├── Date range                          →  start_date / end_date
    ├── Holding type  positional/intraday   →  holding_type
    ├── [intraday] session window           →  start_time / end_time
    ├── Exchange, instrument type           →  exchange, instrument_type
    ├── Execution style radio               →  execution_style
    ├── Conflict resolution radio           →  stop_target_conflict
    └── Brokerage toggle + config           →  cost_config

Condition card  (one per Condition)
├── LHS indicator  selectbox               →  lhs.type
│   └── param inputs (per-indicator)       →  lhs.params
│       └── [MACD / BB / STOCH / ADX]
│           output selector                →  lhs.output
│       └── ⚙ Advanced expander
│           ├── offset  number input       →  lhs.offset
│           └── interval override          →  lhs.interval
│
├── Operator           selectbox           →  op
│
└── RHS
    ├── [within_range]  low + high inputs  →  rhs.low, rhs.high
    ├── [up_by/down_by] single number      →  rhs (number)
    └── [other]  radio: number | indicator
        ├── [number]    number input       →  rhs (number)
        └── [indicator] full indicator     →  rhs (IndicatorExpr)
```

---

## Validation Errors

All errors are returned as structured Pydantic `ValidationError` or plain `ValueError` with a human-readable message. Common ones the frontend should surface clearly:

| Error message | Likely cause |
|---|---|
| `execute.end_date must be on or after start_date` | Date range is reversed |
| `holding_type='intraday' requires an intraday chart interval like 5m or 1h` | Daily chart selected with intraday holding type |
| `Exit conditions required when exit.mode is 'condition' or 'both'` | Conditions array is empty |
| `Provide stop_loss_pct and/or target_pct when exit.mode is 'sl_tgt' or 'both'` | SL/target fields omitted |
| `stop_loss_pct must be greater than 0` | Zero or negative stop |
| `Range high must be >= low` | `within_range` bounds inverted |
| `entry.conditions must contain at least one condition or group` | Empty entry condition list |
| `Unable to fetch enough warmup candles. Required N rows, got M` | Data unavailable that far back for the chosen interval and indicator period |
| `No rows available for {symbol} between {start} and {end}` | Symbol not found or date range out of data bounds |

---

## Example Strategies

### 1 — Simple RSI + EMA (positional daily)

```json
{
  "instruments": ["HDFCBANK"],
  "chart": { "type": "Candlestick", "interval": "1d" },
  "entry": {
    "side": "BUY",
    "conditions": [
      {
        "lhs": { "type": "RSI", "params": { "length": 14, "source": "close" } },
        "op": "crosses_above",
        "rhs": 30
      },
      {
        "lhs": { "type": "PRICE", "params": { "source": "close" } },
        "op": "greater_than",
        "rhs": { "type": "EMA", "params": { "period": 50, "source": "close" } }
      }
    ]
  },
  "exit": { "mode": "sl_tgt", "stop_loss_pct": 3.0, "target_pct": 6.0 },
  "execute": {
    "initial_capital": 100000,
    "start_date": "2026-01-01",
    "end_date": "2026-03-31",
    "holding_type": "positional",
    "exchange": "NSE",
    "instrument_type": "STOCK"
  }
}
```

### 2 — Nested OR entry: OR(RSI cross, AND(price > EMA + MACD cross))

```json
{
  "instruments": ["RELIANCE"],
  "chart": { "type": "Candlestick", "interval": "1d" },
  "entry": {
    "side": "BUY",
    "conditions": {
      "logic": "OR",
      "items": [
        {
          "lhs": { "type": "RSI", "params": { "length": 14 } },
          "op": "crosses_above",
          "rhs": 30
        },
        {
          "logic": "AND",
          "items": [
            {
              "lhs": { "type": "PRICE" },
              "op": "greater_than",
              "rhs": { "type": "EMA", "params": { "period": 50 } }
            },
            {
              "lhs": { "type": "MACD", "params": { "fast_length": 12, "slow_length": 26, "signal_length": 9 }, "output": "macd_line" },
              "op": "crosses_above",
              "rhs": { "type": "MACD", "params": { "fast_length": 12, "slow_length": 26, "signal_length": 9 }, "output": "signal_line" }
            }
          ]
        }
      ]
    }
  },
  "exit": {
    "mode": "both",
    "conditions": [
      {
        "lhs": { "type": "RSI", "params": { "length": 14 } },
        "op": "crosses_above",
        "rhs": 70
      }
    ],
    "stop_loss_pct": 4.0,
    "target_pct": 8.0
  },
  "execute": {
    "initial_capital": 100000,
    "start_date": "2026-01-01",
    "end_date": "2026-03-31",
    "holding_type": "positional",
    "exchange": "NSE",
    "instrument_type": "STOCK"
  }
}
```

### 3 — Cross-timeframe: 15m chart with daily EMA filter + brokerage

```json
{
  "instruments": ["HDFCBANK"],
  "chart": { "type": "Candlestick", "interval": "15m" },
  "entry": {
    "side": "BUY",
    "conditions": [
      {
        "lhs": { "type": "RSI", "params": { "length": 14 } },
        "op": "crosses_above",
        "rhs": 40
      },
      {
        "lhs": { "type": "PRICE" },
        "op": "greater_than",
        "rhs": { "type": "EMA", "params": { "period": 50 }, "interval": "1d" }
      }
    ]
  },
  "exit": { "mode": "sl_tgt", "stop_loss_pct": 0.5, "target_pct": 1.0 },
  "execute": {
    "initial_capital": 200000,
    "start_date": "2026-02-01",
    "end_date": "2026-03-31",
    "holding_type": "intraday",
    "exchange": "NSE",
    "instrument_type": "STOCK",
    "execution_style": "same_bar_close",
    "cost_config": {
      "intraday_brokerage_pct": 0.03,
      "intraday_brokerage_flat": 20.0
    }
  }
}
```
