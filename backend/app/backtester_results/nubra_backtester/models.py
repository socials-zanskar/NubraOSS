from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from datetime import date, datetime, time
from enum import Enum
from typing import Any, Literal, Mapping, Sequence

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .indicator_registry import (
    indicator_signature,
    normalize_indicator_type,
    normalize_output,
    operator_requires_previous_bar,
    validate_condition_contract,
)


# ---------------------------------------------------------------------------
# Low-level data-fetch request models (unchanged)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IndicatorRequest:
    type: str
    params: dict[str, Any] = field(default_factory=dict)
    name: str | None = None
    output: str | None = None
    offset: int = 0

    @classmethod
    def from_value(cls, value: "IndicatorRequest | Mapping[str, Any] | Any") -> "IndicatorRequest":
        if isinstance(value, cls):
            return value

        if hasattr(value, "type") and hasattr(value, "params"):
            params = dict(getattr(value, "params", {}) or {})
            raw_offset = getattr(value, "offset", params.pop("offset", 0))
            raw_output = getattr(value, "output", params.pop("output", None))
            raw_name = getattr(value, "name", None)
            indicator_type = getattr(value, "type", None)
            if not indicator_type:
                raise ValueError("Indicator requests must include a non-empty 'type'.")
            return cls(
                type=str(indicator_type),
                params=params,
                name=str(raw_name) if raw_name else None,
                output=str(raw_output) if raw_output else None,
                offset=int(raw_offset or 0),
            )

        if not isinstance(value, Mapping):
            raise TypeError("Indicator requests must be IndicatorRequest objects or mappings.")

        indicator_type = value.get("type")
        if not indicator_type:
            raise ValueError("Indicator requests must include a non-empty 'type'.")

        params = dict(value.get("params") or {})
        raw_output = value.get("output", params.pop("output", None))
        raw_offset = value.get("offset", params.pop("offset", 0))
        raw_name = value.get("name")
        return cls(
            type=str(indicator_type),
            params=params,
            name=str(raw_name) if raw_name else None,
            output=str(raw_output) if raw_output else None,
            offset=int(raw_offset or 0),
        )


@dataclass(frozen=True)
class HistoricalIndicatorRequest:
    symbol: str
    start: Any
    end: Any
    indicators: Sequence[IndicatorRequest | Mapping[str, Any]]
    exchange: str = "NSE"
    instrument_type: str = "STOCK"
    interval: str = "1d"
    real_time: bool = False
    intra_day: bool = False

    def normalized_indicators(self) -> list[IndicatorRequest]:
        return [IndicatorRequest.from_value(item) for item in self.indicators]


@dataclass
class IndicatorRunResult:
    data: pd.DataFrame
    requested_start: pd.Timestamp
    requested_end: pd.Timestamp
    fetched_start: pd.Timestamp
    fetched_end: pd.Timestamp
    warmup_bars_required: int
    warmup_rows_available: int
    fetch_attempts: int
    request_payload: dict[str, Any]


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class Side(str, Enum):
    """
    Direction of a trade. BUY/SELL are canonical; LONG/SHORT are accepted
    aliases (with a deprecation warning) for user-facing convenience.
    """
    BUY = "BUY"
    SELL = "SELL"

    @classmethod
    def _missing_(cls, value: object) -> Side | None:
        _ALIASES: dict[str, str] = {"LONG": "BUY", "SHORT": "SELL"}
        normalized = _ALIASES.get(str(value).upper())
        if normalized:
            warnings.warn(
                f"Side value {value!r} is deprecated; use {normalized!r} instead.",
                DeprecationWarning,
                stacklevel=3,
            )
            return cls(normalized)
        return None


class ExitMode(str, Enum):
    CONDITION = "condition"
    SL_TGT = "sl_tgt"
    BOTH = "both"


class HoldingType(str, Enum):
    INTRADAY = "intraday"
    POSITIONAL = "positional"


class ExecutionStyle(str, Enum):
    """
    Controls when a bar's signal becomes an actual fill.

    SAME_BAR_CLOSE (default): signal fires on bar N (close-based indicators)
        → fill at bar N's close price with bar N's timestamp. No lag.

    NEXT_BAR_OPEN: signal on bar N schedules a pending fill that executes at
        bar (N+1)'s open. The academically look-ahead-safe convention; matches
        end-of-day order placement for next-day execution.
    """
    SAME_BAR_CLOSE = "same_bar_close"
    NEXT_BAR_OPEN = "next_bar_open"


class ConflictResolution(str, Enum):
    """
    Determines the exit when both stop-loss and target are hit within the
    same bar (i.e. bar's low ≤ stop AND bar's high ≥ target simultaneously).
    Without tick data the sequence is ambiguous.

    STOP   (default) – conservative; assumes stop was touched first.
    TARGET           – optimistic;    assumes target was touched first.
    """
    STOP = "stop"
    TARGET = "target"


class Operator(str, Enum):
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    GREATER_EQUAL = "greater_equal"
    LESS_EQUAL = "less_equal"
    EQUAL = "equal"
    CROSSES_ABOVE = "crosses_above"
    CROSSES_BELOW = "crosses_below"
    UP_BY = "up_by"
    DOWN_BY = "down_by"
    WITHIN_RANGE = "within_range"


# ---------------------------------------------------------------------------
# Cost configuration
# ---------------------------------------------------------------------------

class CostConfig(BaseModel):
    """
    Brokerage cost model. Currently only brokerage fields are enforced;
    the tax/charge placeholders are wired in as zero until explicitly set.

    Delivery equity  – Zerodha: ₹0 brokerage (default)
    Intraday equity  – Zerodha: min(0.03% of turnover, ₹20) per order
    """
    model_config = ConfigDict(extra="forbid")

    # --- Brokerage (active) ---
    delivery_brokerage_pct: float = 0.0    # % of turnover per order
    delivery_brokerage_flat: float = 0.0   # ₹ cap per order (0 = no cap)

    intraday_brokerage_pct: float = 0.03   # % of turnover per order
    intraday_brokerage_flat: float = 20.0  # ₹ cap per order

    # --- Placeholders for future wiring (currently zero) ---
    # STT: 0.025% intraday sell-side, 0.1% delivery sell-side
    stt_intraday_sell_pct: float = 0.0
    stt_delivery_sell_pct: float = 0.0
    # Exchange + SEBI charges (~0.00345% combined)
    exchange_charges_pct: float = 0.0
    # GST on brokerage + exchange charges (18%)
    gst_on_charges_pct: float = 0.0
    # SEBI turnover fees (₹10 per crore ≈ 0.000001%)
    sebi_charges_pct: float = 0.0


# ---------------------------------------------------------------------------
# Condition building blocks
# ---------------------------------------------------------------------------

class NumberRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    low: float
    high: float

    @model_validator(mode="after")
    def validate_order(self) -> "NumberRange":
        if self.high < self.low:
            raise ValueError("Range high must be greater than or equal to low.")
        return self


class IndicatorExpr(BaseModel):
    """
    A single indicator expression used on one side of a Condition.

    Context override fields (symbol, interval, exchange, instrument_type):
      - When None, the strategy's chart symbol/interval and execute exchange/
        instrument_type are used.
      - Set these to reference a different instrument or timeframe in a
        condition (e.g. symbol="NIFTY" for a NIFTY cross-signal, or
        interval="1d" when the strategy chart is "5m").
      - Cross-timeframe values are aligned to the chart using the last
        completed bar (merge_asof backward) — no lookahead.
    """
    model_config = ConfigDict(extra="forbid")

    type: str
    params: dict[str, Any] = Field(default_factory=dict)
    output: str | None = None
    offset: int = 0

    # Optional context overrides for cross-symbol / cross-timeframe conditions
    symbol: str | None = None           # e.g. "NIFTY"  — None = chart symbol
    interval: str | None = None         # e.g. "1d"     — None = chart interval
    exchange: str | None = None         # e.g. "NSE"    — None = execute.exchange
    instrument_type: str | None = None  # e.g. "INDEX"  — None = execute.instrument_type

    @model_validator(mode="before")
    @classmethod
    def merge_legacy_fields(cls, value: Any) -> Any:
        if not isinstance(value, Mapping):
            return value
        payload = dict(value)
        params = dict(payload.get("params") or {})
        if "output" not in payload and "output" in params:
            payload["output"] = params.pop("output")
        if "offset" not in payload and "offset" in params:
            payload["offset"] = params.pop("offset")
        payload["params"] = params
        return payload

    @field_validator("type")
    @classmethod
    def normalize_type_field(cls, value: str) -> str:
        return normalize_indicator_type(value)

    @field_validator("offset")
    @classmethod
    def validate_offset(cls, value: int) -> int:
        if value < 0:
            raise ValueError("offset must be greater than or equal to 0.")
        return value

    @field_validator("symbol", mode="before")
    @classmethod
    def normalize_symbol(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().upper() or None

    @field_validator("interval", mode="before")
    @classmethod
    def normalize_interval(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().lower() or None

    @field_validator("exchange", mode="before")
    @classmethod
    def normalize_exchange(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().upper() or None

    @field_validator("instrument_type", mode="before")
    @classmethod
    def normalize_instrument_type(cls, value: Any) -> Any:
        if value is None:
            return None
        return str(value).strip().upper() or None

    @model_validator(mode="after")
    def normalize_output_field(self) -> "IndicatorExpr":
        self.output = normalize_output(self.type, self.output)
        return self

    def signature(self) -> str:
        """
        Unique string key for this expression. Includes symbol/interval prefix
        when a context override is present so same-indicator expressions on
        different symbols/timeframes get distinct column names.
        """
        base = indicator_signature(
            indicator_type=self.type,
            params=self.params,
            output=self.output,
            offset=self.offset,
        )
        prefix_parts: list[str] = []
        if self.symbol:
            prefix_parts.append(f"sym:{self.symbol}")
        if self.interval:
            prefix_parts.append(f"int:{self.interval}")
        if prefix_parts:
            return "|".join(prefix_parts) + "|" + base
        return base

    def to_indicator_request(self, *, name: str | None = None) -> IndicatorRequest:
        return IndicatorRequest(
            type=self.type,
            params=dict(self.params),
            name=name,
            output=self.output,
            offset=self.offset,
        )


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lhs: IndicatorExpr
    op: Operator
    rhs: IndicatorExpr | NumberRange | float

    @model_validator(mode="after")
    def validate_contract(self) -> "Condition":
        validate_condition_contract(
            lhs_type=self.lhs.type,
            lhs_output=self.lhs.output,
            operator=self.op.value,
            rhs=self.rhs,
        )
        return self

    def requires_previous_bar(self) -> bool:
        return operator_requires_previous_bar(self.op.value)


class ConditionGroup(BaseModel):
    """
    A logical group of conditions evaluated as AND or OR.

    items may contain any mix of individual Condition objects and nested
    ConditionGroup objects, to unlimited depth.

    Backward compatibility: EntrySpec and ExitSpec both accept a flat
    list[Condition] and automatically wrap it in a ConditionGroup(logic="AND").

    Example (no-code schema):
        {
            "logic": "OR",
            "items": [
                {"lhs": {...}, "op": "crosses_above", "rhs": 30},
                {
                    "logic": "AND",
                    "items": [
                        {"lhs": {...}, "op": "less_than", "rhs": 40},
                        {"lhs": {...}, "op": "greater_than", "rhs": {...}}
                    ]
                }
            ]
        }
    """
    model_config = ConfigDict(extra="forbid")

    logic: Literal["AND", "OR"] = "AND"
    items: list[Condition | ConditionGroup]


# Pydantic v2 requires an explicit rebuild call for self-referential models
ConditionGroup.model_rebuild()


# ---------------------------------------------------------------------------
# Strategy spec models
# ---------------------------------------------------------------------------

class EntrySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Side
    conditions: ConditionGroup

    @model_validator(mode="before")
    @classmethod
    def _coerce_conditions(cls, values: Any) -> Any:
        """
        Accept a flat list[Condition] for backward compatibility.
        Wraps it in a top-level AND group automatically.
        """
        if isinstance(values, dict):
            raw = values.get("conditions")
            if isinstance(raw, list):
                values = dict(values)
                values["conditions"] = {"logic": "AND", "items": raw}
        return values

    @model_validator(mode="after")
    def _validate_nonempty(self) -> "EntrySpec":
        if not self.conditions.items:
            raise ValueError("entry.conditions must contain at least one condition or group.")
        return self


class ExitSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: ExitMode = ExitMode.CONDITION
    conditions: ConditionGroup | None = None
    stop_loss_pct: float | None = None
    target_pct: float | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_conditions(cls, values: Any) -> Any:
        """
        Accept a flat list[Condition] for backward compatibility.
        An empty list maps to None (no conditions).
        """
        if isinstance(values, dict):
            raw = values.get("conditions")
            if isinstance(raw, list) and raw:
                values = dict(values)
                values["conditions"] = {"logic": "AND", "items": raw}
            elif isinstance(raw, list) and not raw:
                values = dict(values)
                values["conditions"] = None
        return values

    @model_validator(mode="after")
    def validate_mode(self) -> "ExitSpec":
        has_conditions = self.conditions is not None and bool(self.conditions.items)
        if self.mode in {ExitMode.CONDITION, ExitMode.BOTH} and not has_conditions:
            raise ValueError("Exit conditions are required when exit.mode is 'condition' or 'both'.")

        if self.mode in {ExitMode.SL_TGT, ExitMode.BOTH}:
            if self.stop_loss_pct is None and self.target_pct is None:
                raise ValueError("Provide stop_loss_pct and/or target_pct when exit.mode is 'sl_tgt' or 'both'.")
            if self.stop_loss_pct is not None and self.stop_loss_pct <= 0:
                raise ValueError("stop_loss_pct must be greater than 0.")
            if self.target_pct is not None and self.target_pct <= 0:
                raise ValueError("target_pct must be greater than 0.")

        return self


class ChartSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "Candlestick"
    interval: str

    @field_validator("type")
    @classmethod
    def validate_chart_type(cls, value: str) -> str:
        if str(value).strip().lower() != "candlestick":
            raise ValueError("Only chart.type='Candlestick' is currently supported.")
        return "Candlestick"

    @field_validator("interval")
    @classmethod
    def normalize_interval(cls, value: str) -> str:
        interval = str(value).strip().lower()
        if not interval:
            raise ValueError("chart.interval is required.")
        return interval


class ExecuteSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    initial_capital: float
    start_date: date | str
    end_date: date | str
    start_time: time | str | None = None
    end_time: time | str | None = None
    holding_type: HoldingType = HoldingType.POSITIONAL
    exchange: str = "NSE"
    instrument_type: str = "STOCK"
    real_time: bool = False
    execution_style: ExecutionStyle = ExecutionStyle.SAME_BAR_CLOSE
    # Optional brokerage model. When None, all fills are frictionless.
    cost_config: CostConfig | None = None
    # How to resolve a bar where both stop-loss and target are hit.
    stop_target_conflict: ConflictResolution = ConflictResolution.STOP

    @field_validator("initial_capital")
    @classmethod
    def validate_capital(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("initial_capital must be greater than 0.")
        return float(value)

    @field_validator("exchange", "instrument_type")
    @classmethod
    def normalize_identity(cls, value: str) -> str:
        cleaned = str(value).strip().upper()
        if not cleaned:
            raise ValueError("exchange and instrument_type must be non-empty strings.")
        return cleaned

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def parse_time_value(cls, value: Any) -> Any:
        if value is None or value == "":
            return None
        if isinstance(value, time):
            return value
        parsed = pd.Timestamp(str(value))
        return parsed.time()

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def parse_date_value(cls, value: Any) -> Any:
        if isinstance(value, date):
            return value
        parsed = pd.Timestamp(value)
        return parsed.date()

    @model_validator(mode="after")
    def validate_dates(self) -> "ExecuteSpec":
        if self.end_date < self.start_date:
            raise ValueError("execute.end_date must be on or after execute.start_date.")
        if (
            self.start_time is not None
            and self.end_time is not None
            and self.start_date == self.end_date
            and self.end_time <= self.start_time
        ):
            raise ValueError("execute.end_time must be after execute.start_time when start_date == end_date.")
        return self


class Strategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instruments: list[str] = Field(min_length=1)
    chart: ChartSpec
    entry: EntrySpec
    exit: ExitSpec
    execute: ExecuteSpec

    @field_validator("instruments")
    @classmethod
    def normalize_instruments(cls, value: list[str]) -> list[str]:
        normalized = []
        seen: set[str] = set()
        for item in value:
            symbol = str(item).strip().upper()
            if not symbol:
                raise ValueError("Instrument symbols must be non-empty.")
            if symbol not in seen:
                seen.add(symbol)
                normalized.append(symbol)
        return normalized

    @model_validator(mode="after")
    def validate_strategy_shape(self) -> "Strategy":
        if self.execute.holding_type == HoldingType.INTRADAY:
            if not self.chart.interval.endswith(("s", "m", "h")):
                raise ValueError("holding_type='intraday' requires an intraday chart interval like 5m or 1h.")
            # Auto-fill NSE session defaults rather than hard-failing when times
            # are omitted. Users who omit start_time/end_time get the standard
            # NSE cash-market window (09:15 – 15:30) applied silently.
            if self.execute.start_time is None:
                self.execute.start_time = time(9, 15)
            if self.execute.end_time is None:
                self.execute.end_time = time(15, 30)
        return self

    def all_conditions(self) -> list[Condition]:
        """
        Flatten all leaf Condition objects from entry and exit ConditionGroups.
        Recursively descends through nested ConditionGroup items.
        """
        result: list[Condition] = []

        def _collect(group: ConditionGroup) -> None:
            for item in group.items:
                if isinstance(item, ConditionGroup):
                    _collect(item)
                else:
                    result.append(item)

        _collect(self.entry.conditions)
        if self.exit.conditions is not None:
            _collect(self.exit.conditions)
        return result

    def unique_indicator_expressions(self) -> list[IndicatorExpr]:
        unique: dict[str, IndicatorExpr] = {}
        for condition in self.all_conditions():
            lhs_signature = condition.lhs.signature()
            unique[lhs_signature] = condition.lhs
            if isinstance(condition.rhs, IndicatorExpr):
                rhs_signature = condition.rhs.signature()
                unique[rhs_signature] = condition.rhs
        return list(unique.values())

    def needs_previous_bar(self) -> bool:
        return any(condition.requires_previous_bar() for condition in self.all_conditions())


# ---------------------------------------------------------------------------
# Result / output models
# ---------------------------------------------------------------------------

class ConditionEvaluation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lhs: IndicatorExpr
    op: Operator
    rhs: IndicatorExpr | NumberRange | float
    matched: bool
    lhs_value: float | None = None
    rhs_value: float | dict[str, float] | None = None
    lhs_previous: float | None = None
    rhs_previous: float | None = None
    message: str | None = None


class DailySignalLogRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
    indicator_values: dict[str, float | None]
    entry_signal: bool
    exit_signal: bool
    entry_conditions: list[ConditionEvaluation]
    exit_conditions: list[ConditionEvaluation]
    action: str
    position_state: str
    stop_loss_price: float | None = None
    target_price: float | None = None


class EquityPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp: datetime
    equity: float


class Trade(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    side: Side
    entry_timestamp: datetime
    exit_timestamp: datetime
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float           # net pnl after brokerage
    pnl_pct: float       # net pnl as % of capital deployed
    bars_held: int       # 0 = same-bar entry+exit; no artificial floor
    exit_reason: str
    brokerage: float = 0.0  # total round-trip brokerage deducted from pnl


class InstrumentMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starting_capital: float
    ending_capital: float
    gross_profit: float
    gross_loss: float
    net_pnl: float
    return_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    avg_pnl: float
    avg_pnl_pct: float
    profit_factor: float | None = None
    max_drawdown_pct: float
    total_brokerage: float = 0.0  # sum of brokerage across all trades


class InstrumentBacktestResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    bars_processed: int
    fetched_start: datetime
    fetched_end: datetime
    requested_start: datetime
    requested_end: datetime
    warmup_bars_required: int
    warmup_rows_available: int
    fetch_attempts: int
    request_payload: dict[str, Any]
    final_indicator_values: dict[str, float | None]
    daily_signal_log: list[DailySignalLogRow]
    triggered_days: list[DailySignalLogRow]
    metrics: InstrumentMetrics
    trades: list[Trade]
    equity_curve: list[EquityPoint]


class PortfolioMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starting_capital: float
    ending_capital: float
    gross_profit: float
    gross_loss: float
    net_pnl: float
    return_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    profit_factor: float | None = None
    max_drawdown_pct: float
    capital_per_instrument: float
    equity_curve: list[EquityPoint]
    total_brokerage: float = 0.0


class StrategyBacktestResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = "backtest"
    strategy: Strategy
    instruments: list[InstrumentBacktestResult]
    portfolio: PortfolioMetrics


class LiveInstrumentResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    as_of: datetime
    fetched_start: datetime
    fetched_end: datetime
    request_payload: dict[str, Any]
    last_price: float
    final_indicator_values: dict[str, float | None]
    entry_signal: bool
    exit_signal: bool
    session_allows_entry: bool
    action_if_flat: str
    action_if_in_position: str
    suggested_stop_loss_price: float | None = None
    suggested_target_price: float | None = None
    entry_conditions: list[ConditionEvaluation]
    exit_conditions: list[ConditionEvaluation]


class StrategySignalResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = "realtime"
    strategy: Strategy
    instruments: list[LiveInstrumentResult]
