"""
New backtester engine — implements the Strategy schema and backtest loop
described in backtester_results/backtester_deep_dive.md.

Architecture mirrors NubraStrategyEngine.backtest_json() output but runs
inside the existing FastAPI service using the existing data-fetch pipeline
(strategy_data.py) and indicator engine (nubra_talib / strategy_eval.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import time as dt_time
from typing import Any, Literal
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import HTTPException

from app.services.strategy_data import (
    IST_TZ,
    IndicatorExpr,
    fetch_with_warmup,
    inject_indicator_columns,
    interval_is_intraday,
    parse_user_timestamp,
    required_history_bars,
)
from app.services.strategy_eval import (
    Condition,
    ConditionGroup,
    ConditionNode,
    evaluate_node,
    iter_expressions_from_node,
    parse_condition_node,
)

IST = ZoneInfo(IST_TZ)

Side = Literal["BUY", "SELL"]
ExitMode = Literal["condition", "sl_tgt", "both"]
HoldingType = Literal["positional", "intraday"]
ExecutionStyle = Literal["same_bar_close", "next_bar_open"]
ConflictResolution = Literal["stop", "target"]


# ---------------------------------------------------------------------------
# Parsed strategy dataclass (internal)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CostConfig:
    intraday_brokerage_pct: float = 0.03
    intraday_brokerage_flat: float = 20.0
    delivery_brokerage_pct: float = 0.0
    delivery_brokerage_flat: float = 0.0


@dataclass(frozen=True)
class ParsedStrategy:
    instruments: list[str]
    interval: str
    entry_side: Side
    entry_conditions: ConditionNode
    exit_mode: ExitMode
    exit_conditions: ConditionNode | None
    stop_loss_pct: float | None
    target_pct: float | None
    initial_capital: float
    capital_per_instrument: float
    start_date: str
    end_date: str
    start_time: str
    end_time: str
    holding_type: HoldingType
    exchange: str
    instrument_type: str
    execution_style: ExecutionStyle
    stop_target_conflict: ConflictResolution
    cost_config: CostConfig | None


# ---------------------------------------------------------------------------
# Output dataclasses (mirrors StrategyBacktestResult schema from docs)
# ---------------------------------------------------------------------------


@dataclass
class Trade:
    symbol: str
    side: Side
    entry_timestamp: str
    exit_timestamp: str
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    pnl_pct: float
    bars_held: int
    exit_reason: str
    brokerage: float


@dataclass
class EquityPoint:
    timestamp: str
    equity: float


@dataclass
class InstrumentMetrics:
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
    profit_factor: float | None
    max_drawdown_pct: float
    total_brokerage: float


@dataclass
class DailySignalLogRow:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    entry_signal: bool
    exit_signal: bool
    action: str
    position_state: str
    stop_loss_price: float | None
    target_price: float | None


@dataclass
class InstrumentBacktestResult:
    symbol: str
    bars_processed: int
    metrics: InstrumentMetrics
    trades: list[Trade]
    equity_curve: list[EquityPoint]
    triggered_days: list[DailySignalLogRow]
    daily_signal_log: list[DailySignalLogRow]
    warning: str | None = None


@dataclass
class PortfolioMetrics:
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
    profit_factor: float | None
    max_drawdown_pct: float
    capital_per_instrument: float
    total_brokerage: float
    equity_curve: list[EquityPoint]


@dataclass
class StrategyBacktestResult:
    mode: str
    strategy_summary: dict[str, Any]
    instruments: list[InstrumentBacktestResult]
    portfolio: PortfolioMetrics


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _parse_condition_group_or_list(payload: Any, field_name: str) -> ConditionNode:
    """Parse entry.conditions or exit.conditions — accepts flat list or ConditionGroup object."""
    if payload is None or (isinstance(payload, list) and len(payload) == 0):
        raise HTTPException(status_code=400, detail=f"{field_name} must contain at least one condition or group.")
    try:
        node = parse_condition_node(payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {exc}") from exc

    # Validate non-empty group
    if isinstance(node, ConditionGroup) and len(node.items) == 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must contain at least one condition or group.")

    return node


def parse_strategy(payload: dict[str, Any]) -> ParsedStrategy:
    # ---- instruments ----
    instruments_raw = payload.get("instruments") or []
    if not isinstance(instruments_raw, list) or not instruments_raw:
        raise HTTPException(status_code=400, detail="At least one instrument is required.")
    seen: set[str] = set()
    instruments: list[str] = []
    for item in instruments_raw:
        sym = str(item).strip().upper()
        if sym and sym not in seen:
            instruments.append(sym)
            seen.add(sym)
    if not instruments:
        raise HTTPException(status_code=400, detail="At least one valid instrument is required.")

    # ---- chart ----
    chart_payload = payload.get("chart") or {}
    interval = str(chart_payload.get("interval") or payload.get("interval") or "1d").strip().lower()
    if not interval:
        raise HTTPException(status_code=400, detail="chart.interval is required.")

    # ---- entry ----
    entry_payload = payload.get("entry") or {}
    entry_side_raw = str(entry_payload.get("side") or "BUY").upper()
    # Accept LONG/SHORT as deprecated aliases
    entry_side_raw = {"LONG": "BUY", "SHORT": "SELL"}.get(entry_side_raw, entry_side_raw)
    if entry_side_raw not in {"BUY", "SELL"}:
        raise HTTPException(status_code=400, detail="Entry side must be BUY or SELL.")
    entry_side: Side = entry_side_raw  # type: ignore[assignment]

    raw_entry_conditions = entry_payload.get("conditions")
    if raw_entry_conditions is None:
        raise HTTPException(status_code=400, detail="entry.conditions is required.")
    entry_conditions = _parse_condition_group_or_list(raw_entry_conditions, "entry.conditions")

    # ---- exit ----
    exit_payload = payload.get("exit") or {}
    exit_mode_raw = str(exit_payload.get("mode") or "condition").lower()
    if exit_mode_raw not in {"condition", "sl_tgt", "both"}:
        raise HTTPException(status_code=400, detail="exit.mode must be one of: condition, sl_tgt, both.")
    exit_mode: ExitMode = exit_mode_raw  # type: ignore[assignment]

    exit_conditions: ConditionNode | None = None
    if exit_mode in {"condition", "both"}:
        raw_exit_conditions = exit_payload.get("conditions")
        if raw_exit_conditions is None:
            raise HTTPException(status_code=400, detail="Exit conditions required when exit.mode is 'condition' or 'both'.")
        exit_conditions = _parse_condition_group_or_list(raw_exit_conditions, "exit.conditions")

    stop_loss_raw = exit_payload.get("stop_loss_pct")
    target_raw = exit_payload.get("target_pct")
    stop_loss_pct = float(stop_loss_raw) if stop_loss_raw is not None else None
    target_pct = float(target_raw) if target_raw is not None else None

    if exit_mode in {"sl_tgt", "both"} and stop_loss_pct is None and target_pct is None:
        raise HTTPException(status_code=400, detail="Provide stop_loss_pct and/or target_pct when exit.mode is 'sl_tgt' or 'both'.")
    if stop_loss_pct is not None and stop_loss_pct <= 0:
        raise HTTPException(status_code=400, detail="stop_loss_pct must be greater than 0.")
    if target_pct is not None and target_pct <= 0:
        raise HTTPException(status_code=400, detail="target_pct must be greater than 0.")

    # ---- execute ----
    execute_payload = payload.get("execute") or {}

    try:
        initial_capital = float(execute_payload.get("initial_capital") or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="initial_capital must be numeric.") from exc
    if initial_capital <= 0:
        raise HTTPException(status_code=400, detail="initial_capital must be positive.")

    start_date = str(execute_payload.get("start_date") or "")
    end_date = str(execute_payload.get("end_date") or "")
    if not start_date or not end_date:
        raise HTTPException(status_code=400, detail="start_date and end_date are required.")

    start_time = str(execute_payload.get("start_time") or "09:15")
    end_time = str(execute_payload.get("end_time") or "15:30")

    # Support both old ("Intraday"/"Longterm") and new ("intraday"/"positional") values
    holding_raw = str(execute_payload.get("holding_type") or "positional").lower()
    _holding_map = {"longterm": "positional", "intraday": "intraday", "positional": "positional"}
    holding_type_str = _holding_map.get(holding_raw, "positional")
    holding_type: HoldingType = holding_type_str  # type: ignore[assignment]

    if holding_type == "intraday" and not interval_is_intraday(interval):
        raise HTTPException(
            status_code=400,
            detail=f"holding_type='intraday' requires an intraday chart interval like 5m or 1h, got '{interval}'.",
        )

    exchange = str(execute_payload.get("exchange") or "NSE").upper()
    instrument_type = str(execute_payload.get("instrument_type") or "STOCK").upper()

    execution_style_raw = str(execute_payload.get("execution_style") or "same_bar_close").lower()
    if execution_style_raw not in {"same_bar_close", "next_bar_open"}:
        raise HTTPException(status_code=400, detail="execution_style must be 'same_bar_close' or 'next_bar_open'.")
    execution_style: ExecutionStyle = execution_style_raw  # type: ignore[assignment]

    conflict_raw = str(execute_payload.get("stop_target_conflict") or "stop").lower()
    if conflict_raw not in {"stop", "target"}:
        raise HTTPException(status_code=400, detail="stop_target_conflict must be 'stop' or 'target'.")
    stop_target_conflict: ConflictResolution = conflict_raw  # type: ignore[assignment]

    cost_config: CostConfig | None = None
    cost_config_raw = execute_payload.get("cost_config")
    if isinstance(cost_config_raw, dict):
        cost_config = CostConfig(
            intraday_brokerage_pct=float(cost_config_raw.get("intraday_brokerage_pct", 0.03)),
            intraday_brokerage_flat=float(cost_config_raw.get("intraday_brokerage_flat", 20.0)),
            delivery_brokerage_pct=float(cost_config_raw.get("delivery_brokerage_pct", 0.0)),
            delivery_brokerage_flat=float(cost_config_raw.get("delivery_brokerage_flat", 0.0)),
        )

    capital_per_instrument = initial_capital / len(instruments)

    return ParsedStrategy(
        instruments=instruments,
        interval=interval,
        entry_side=entry_side,
        entry_conditions=entry_conditions,
        exit_mode=exit_mode,
        exit_conditions=exit_conditions,
        stop_loss_pct=stop_loss_pct,
        target_pct=target_pct,
        initial_capital=initial_capital,
        capital_per_instrument=capital_per_instrument,
        start_date=start_date,
        end_date=end_date,
        start_time=start_time,
        end_time=end_time,
        holding_type=holding_type,
        exchange=exchange,
        instrument_type=instrument_type,
        execution_style=execution_style,
        stop_target_conflict=stop_target_conflict,
        cost_config=cost_config,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_time_hhmm(value: str) -> dt_time:
    parts = value.strip().split(":")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail=f"Invalid time value '{value}'. Expected HH:MM.")
    return dt_time(hour=int(parts[0]), minute=int(parts[1]))


def _position_size(capital: float, entry_price: float) -> float:
    if entry_price <= 0:
        return 0.0
    return capital / entry_price


def _pnl_from(side: Side, entry_price: float, exit_price: float, qty: float) -> float:
    if side == "BUY":
        return (exit_price - entry_price) * qty
    return (entry_price - exit_price) * qty


def _calc_brokerage(trade_value: float, is_intraday: bool, cost_config: CostConfig | None) -> float:
    if cost_config is None:
        return 0.0
    if is_intraday:
        pct = cost_config.intraday_brokerage_pct
        flat = cost_config.intraday_brokerage_flat
    else:
        pct = cost_config.delivery_brokerage_pct
        flat = cost_config.delivery_brokerage_flat
    leg = trade_value * pct / 100.0
    if flat > 0:
        leg = min(leg, flat)
    return leg  # per leg; caller multiplies by 2 for round-trip


def _max_drawdown_pct(equity_points: list[float]) -> float:
    if not equity_points:
        return 0.0
    peak = equity_points[0]
    max_dd = 0.0
    for value in equity_points:
        if value > peak:
            peak = value
        if peak > 0:
            dd = (peak - value) / peak
            if dd > max_dd:
                max_dd = dd
    return round(max_dd * 100.0, 4)


def _ts_str(ts: Any) -> str:
    return str(ts)


def _all_expressions(strategy: ParsedStrategy) -> list[IndicatorExpr]:
    exprs = iter_expressions_from_node(strategy.entry_conditions)
    if strategy.exit_conditions is not None:
        exprs += iter_expressions_from_node(strategy.exit_conditions)
    return exprs


def _warmup_bars_for(expressions: list[IndicatorExpr], interval: str) -> int:
    if not expressions:
        return 0
    return max(required_history_bars(expr, interval) for expr in expressions)


# ---------------------------------------------------------------------------
# Backtest loop (per instrument)
# ---------------------------------------------------------------------------


def _run_instrument(
    strategy: ParsedStrategy,
    df: pd.DataFrame,
    symbol: str,
) -> InstrumentBacktestResult:
    requested_start = parse_user_timestamp(strategy.start_date, timezone=IST_TZ, is_end=False)
    requested_end = parse_user_timestamp(strategy.end_date, timezone=IST_TZ, is_end=True)

    # Trim to requested window
    executable = df[(df["timestamp"] >= requested_start) & (df["timestamp"] <= requested_end)].copy()
    if executable.empty:
        empty_metrics = _empty_metrics(strategy.capital_per_instrument)
        return InstrumentBacktestResult(
            symbol=symbol,
            bars_processed=0,
            metrics=empty_metrics,
            trades=[],
            equity_curve=[],
            triggered_days=[],
            daily_signal_log=[],
            warning=f"No rows available for {symbol} in requested range.",
        )

    is_intraday = interval_is_intraday(strategy.interval) or strategy.holding_type == "intraday"

    start_time = _parse_time_hhmm(strategy.start_time)
    end_time = _parse_time_hhmm(strategy.end_time)

    # We work on absolute indices into df (which contains warmup) to support offset indicators
    absolute_indices = executable.index.to_list()
    bars_processed = len(absolute_indices)

    trades: list[Trade] = []
    daily_log: list[DailySignalLogRow] = []
    equity_curve: list[EquityPoint] = [EquityPoint(timestamp=_ts_str(executable["timestamp"].iloc[0]), equity=strategy.capital_per_instrument)]

    capital = strategy.capital_per_instrument
    starting_capital = capital

    in_position = False
    entry_index_absolute: int | None = None  # absolute row in df
    entry_bar_local: int | None = None  # local index in executable
    entry_price = 0.0
    qty = 0.0
    entry_time_str = ""
    stop_loss_price: float | None = None
    target_price: float | None = None

    # next_bar_open pending slots
    pending_entry_price: float | None = None
    pending_entry_abs_index: int | None = None
    pending_exit = False

    def _compute_sl_tgt(price: float) -> tuple[float | None, float | None]:
        if strategy.entry_side == "BUY":
            sl = price * (1 - strategy.stop_loss_pct / 100.0) if strategy.stop_loss_pct else None
            tgt = price * (1 + strategy.target_pct / 100.0) if strategy.target_pct else None
        else:
            sl = price * (1 + strategy.stop_loss_pct / 100.0) if strategy.stop_loss_pct else None
            tgt = price * (1 - strategy.target_pct / 100.0) if strategy.target_pct else None
        return sl, tgt

    def _brokerage_for(price: float, quantity: float) -> float:
        trade_value = price * quantity
        leg = _calc_brokerage(trade_value, is_intraday, strategy.cost_config)
        return round(leg * 2, 4)  # round-trip

    def _close_position(exit_price: float, exit_bar: pd.Series, reason: str) -> None:
        nonlocal capital, in_position, entry_index_absolute, entry_bar_local
        nonlocal entry_price, qty, entry_time_str, stop_loss_price, target_price

        gross_pnl = _pnl_from(strategy.entry_side, entry_price, exit_price, qty)
        brokerage = _brokerage_for(entry_price, qty)
        net_pnl = gross_pnl - brokerage

        capital += net_pnl
        entry_notional = entry_price * qty
        pnl_pct = (net_pnl / entry_notional * 100.0) if entry_notional > 0 else 0.0

        exit_local = absolute_indices.index(exit_bar.name) if exit_bar.name in absolute_indices else 0
        entry_local_val = entry_bar_local or 0
        bars_held = max(0, exit_local - entry_local_val)

        trades.append(
            Trade(
                symbol=symbol,
                side=strategy.entry_side,
                entry_timestamp=entry_time_str,
                exit_timestamp=_ts_str(exit_bar["timestamp"]),
                entry_price=round(entry_price, 4),
                exit_price=round(exit_price, 4),
                quantity=round(qty, 4),
                pnl=round(net_pnl, 4),
                pnl_pct=round(pnl_pct, 4),
                bars_held=bars_held,
                exit_reason=reason,
                brokerage=brokerage,
            )
        )
        equity_curve.append(EquityPoint(timestamp=_ts_str(exit_bar["timestamp"]), equity=round(capital, 4)))
        in_position = False
        entry_index_absolute = None
        entry_bar_local = None
        entry_price = 0.0
        qty = 0.0
        entry_time_str = ""
        stop_loss_price = None
        target_price = None

    def _open_position(bar: pd.Series, price: float, local_i: int) -> None:
        nonlocal in_position, entry_index_absolute, entry_bar_local
        nonlocal entry_price, qty, entry_time_str, stop_loss_price, target_price

        sized = _position_size(capital, price)
        if sized <= 0:
            return

        in_position = True
        entry_index_absolute = bar.name
        entry_bar_local = local_i
        entry_price = price
        qty = sized
        entry_time_str = _ts_str(bar["timestamp"])
        stop_loss_price, target_price = _compute_sl_tgt(price) if strategy.exit_mode in {"sl_tgt", "both"} else (None, None)
        equity_curve.append(EquityPoint(timestamp=entry_time_str, equity=round(capital, 4)))

    for local_i, absolute_i in enumerate(absolute_indices):
        bar = df.iloc[absolute_i]
        bar_open = float(bar["open"])
        bar_high = float(bar["high"])
        bar_low = float(bar["low"])
        bar_close = float(bar["close"])
        bar_ts = _ts_str(bar["timestamp"])

        action_parts: list[str] = []

        # ----- Session window for intraday -----
        bar_time = bar["timestamp"].time() if hasattr(bar["timestamp"], "time") else dt_time(9, 15)
        session_allows_entry = True
        session_must_close = False
        if is_intraday:
            session_allows_entry = start_time <= bar_time < end_time
            if bar_time >= end_time:
                session_must_close = True
            elif local_i + 1 < len(absolute_indices):
                next_bar = df.iloc[absolute_indices[local_i + 1]]
                if bar["timestamp"].date() != next_bar["timestamp"].date():
                    session_must_close = True
            else:
                session_must_close = True

        # ================================
        # Phase A: Settle pending fills (next_bar_open)
        # ================================
        if strategy.execution_style == "next_bar_open":
            if pending_exit and in_position:
                _close_position(bar_open, bar, "exit_condition")
                pending_exit = False
                action_parts.append("exit_settled")

            if pending_entry_price is not None and not in_position:
                # Re-open at this bar's open
                _open_position(bar, bar_open, local_i)
                pending_entry_price = None
                pending_entry_abs_index = None
                if in_position:
                    action_parts.append("enter_settled")

        # ================================
        # Phase B: SL / Target intrabar check
        # ================================
        if in_position and strategy.exit_mode in {"sl_tgt", "both"}:
            exit_reason_sl_tgt: str | None = None
            exit_price_override: float | None = None

            if strategy.entry_side == "BUY":
                # Gap-through stop at open
                if stop_loss_price is not None and bar_open <= stop_loss_price:
                    exit_reason_sl_tgt = "stop_loss"
                    exit_price_override = bar_open
                # Intrabar stop
                elif stop_loss_price is not None and bar_low <= stop_loss_price:
                    exit_reason_sl_tgt = "stop_loss"
                    exit_price_override = stop_loss_price

                if exit_reason_sl_tgt is None:
                    # Gap-through target at open
                    if target_price is not None and bar_open >= target_price:
                        exit_reason_sl_tgt = "target"
                        exit_price_override = bar_open
                    # Intrabar target
                    elif target_price is not None and bar_high >= target_price:
                        exit_reason_sl_tgt = "target"
                        exit_price_override = target_price

                # Conflict resolution when both would fire this bar
                if exit_reason_sl_tgt is None and stop_loss_price is not None and target_price is not None:
                    if bar_low <= stop_loss_price and bar_high >= target_price:
                        if strategy.stop_target_conflict == "stop":
                            exit_reason_sl_tgt = "stop_loss"
                            exit_price_override = stop_loss_price
                        else:
                            exit_reason_sl_tgt = "target"
                            exit_price_override = target_price
            else:
                # SELL side
                if stop_loss_price is not None and bar_open >= stop_loss_price:
                    exit_reason_sl_tgt = "stop_loss"
                    exit_price_override = bar_open
                elif stop_loss_price is not None and bar_high >= stop_loss_price:
                    exit_reason_sl_tgt = "stop_loss"
                    exit_price_override = stop_loss_price

                if exit_reason_sl_tgt is None:
                    if target_price is not None and bar_open <= target_price:
                        exit_reason_sl_tgt = "target"
                        exit_price_override = bar_open
                    elif target_price is not None and bar_low <= target_price:
                        exit_reason_sl_tgt = "target"
                        exit_price_override = target_price

            if exit_reason_sl_tgt is not None and exit_price_override is not None:
                _close_position(exit_price_override, bar, exit_reason_sl_tgt)
                action_parts.append(f"exit_{exit_reason_sl_tgt}")

        # ================================
        # Phase C: Signal-driven actions
        # ================================
        entry_signal = evaluate_node(df, absolute_i, strategy.entry_conditions) if not in_position else False
        exit_signal = False
        if in_position and strategy.exit_mode in {"condition", "both"} and strategy.exit_conditions is not None:
            exit_signal = evaluate_node(df, absolute_i, strategy.exit_conditions)

        if strategy.execution_style == "same_bar_close":
            if in_position and exit_signal:
                _close_position(bar_close, bar, "exit_condition")
                action_parts.append("exit_condition")
            elif in_position and session_must_close:
                _close_position(bar_close, bar, "session_end")
                action_parts.append("exit_session_end")
            elif not in_position and entry_signal and session_allows_entry:
                _open_position(bar, bar_close, local_i)
                if in_position:
                    action_parts.append(f"enter_{strategy.entry_side.lower()}")
        else:
            # next_bar_open scheduling
            if in_position and session_must_close:
                _close_position(bar_close, bar, "session_end")
                action_parts.append("exit_session_end")
                pending_exit = False
            elif not in_position and entry_signal and session_allows_entry:
                pending_entry_price = bar_close
                pending_entry_abs_index = absolute_i
                action_parts.append("entry_pending")
            elif in_position and exit_signal:
                pending_exit = True
                action_parts.append("exit_pending")

        # Equity track (mark-to-market at close if in position)
        current_equity = capital
        if in_position:
            unrealized = _pnl_from(strategy.entry_side, entry_price, bar_close, qty)
            current_equity = capital + unrealized

        position_state = "flat"
        if in_position:
            position_state = "open_buy" if strategy.entry_side == "BUY" else "open_sell"

        action_str = "|".join(action_parts) if action_parts else "hold"

        row = DailySignalLogRow(
            timestamp=bar_ts,
            open=bar_open,
            high=bar_high,
            low=bar_low,
            close=bar_close,
            volume=float(bar["volume"]) if not pd.isna(bar.get("volume", None)) else None,
            entry_signal=entry_signal,
            exit_signal=exit_signal,
            action=action_str,
            position_state=position_state,
            stop_loss_price=round(stop_loss_price, 4) if stop_loss_price else None,
            target_price=round(target_price, 4) if target_price else None,
        )
        daily_log.append(row)

    # Force-close any remaining position at last bar
    if in_position and absolute_indices:
        last_bar = df.iloc[absolute_indices[-1]]
        _close_position(float(last_bar["close"]), last_bar, "end_of_backtest")

    # Build metrics
    winning = [t for t in trades if t.pnl > 0]
    losing = [t for t in trades if t.pnl < 0]
    gross_profit = sum(t.pnl for t in winning)
    gross_loss = abs(sum(t.pnl for t in losing))
    net_pnl = sum(t.pnl for t in trades)
    total_brokerage = sum(t.brokerage for t in trades)
    total_trades = len(trades)
    win_rate = (len(winning) / total_trades * 100.0) if total_trades else 0.0
    avg_pnl = net_pnl / total_trades if total_trades else 0.0
    avg_pnl_pcts = [t.pnl_pct for t in trades]
    avg_pnl_pct = sum(avg_pnl_pcts) / len(avg_pnl_pcts) if avg_pnl_pcts else 0.0
    profit_factor = round(gross_profit / gross_loss, 4) if gross_loss > 0 else None
    return_pct = (net_pnl / starting_capital * 100.0) if starting_capital else 0.0
    eq_values = [p.equity for p in equity_curve]
    max_dd = _max_drawdown_pct(eq_values)

    metrics = InstrumentMetrics(
        starting_capital=round(starting_capital, 4),
        ending_capital=round(capital, 4),
        gross_profit=round(gross_profit, 4),
        gross_loss=round(gross_loss, 4),
        net_pnl=round(net_pnl, 4),
        return_pct=round(return_pct, 4),
        total_trades=total_trades,
        winning_trades=len(winning),
        losing_trades=len(losing),
        win_rate_pct=round(win_rate, 4),
        avg_pnl=round(avg_pnl, 4),
        avg_pnl_pct=round(avg_pnl_pct, 4),
        profit_factor=profit_factor,
        max_drawdown_pct=max_dd,
        total_brokerage=round(total_brokerage, 4),
    )

    triggered_days = [r for r in daily_log if r.action != "hold"]

    return InstrumentBacktestResult(
        symbol=symbol,
        bars_processed=bars_processed,
        metrics=metrics,
        trades=trades,
        equity_curve=equity_curve,
        triggered_days=triggered_days,
        daily_signal_log=daily_log,
    )


def _empty_metrics(capital: float) -> InstrumentMetrics:
    return InstrumentMetrics(
        starting_capital=capital,
        ending_capital=capital,
        gross_profit=0.0,
        gross_loss=0.0,
        net_pnl=0.0,
        return_pct=0.0,
        total_trades=0,
        winning_trades=0,
        losing_trades=0,
        win_rate_pct=0.0,
        avg_pnl=0.0,
        avg_pnl_pct=0.0,
        profit_factor=None,
        max_drawdown_pct=0.0,
        total_brokerage=0.0,
    )


# ---------------------------------------------------------------------------
# Portfolio equity curve merger
# ---------------------------------------------------------------------------


def _merge_equity_curves(instrument_results: list[InstrumentBacktestResult]) -> list[EquityPoint]:
    """Sum per-instrument equity curves on a common timeline using forward-fill."""
    if not instrument_results:
        return []

    curves = []
    for res in instrument_results:
        if res.equity_curve:
            s = pd.Series(
                {p.timestamp: p.equity for p in res.equity_curve},
                dtype=float,
            )
            curves.append(s)

    if not curves:
        return []

    combined = pd.concat(curves, axis=1)
    combined = combined.sort_index().ffill()
    total = combined.sum(axis=1)

    return [EquityPoint(timestamp=str(ts), equity=round(float(eq), 4)) for ts, eq in total.items()]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_backtest(
    *,
    strategy: ParsedStrategy,
    session_token: str,
    device_id: str,
    environment: str,
) -> StrategyBacktestResult:
    requested_start = parse_user_timestamp(strategy.start_date, timezone=IST_TZ, is_end=False)
    requested_end = parse_user_timestamp(strategy.end_date, timezone=IST_TZ, is_end=True)
    if requested_end < requested_start:
        raise HTTPException(status_code=400, detail="execute.end_date must be on or after start_date.")

    all_expressions = _all_expressions(strategy)
    warmup_bars = _warmup_bars_for(all_expressions, strategy.interval)

    instrument_results: list[InstrumentBacktestResult] = []
    for symbol in strategy.instruments:
        df, _warmup_rows, _attempts = fetch_with_warmup(
            session_token=session_token,
            device_id=device_id,
            environment=environment,
            symbol=symbol,
            interval=strategy.interval,
            requested_start=requested_start,
            requested_end=requested_end,
            warmup_bars=warmup_bars,
            # Nubra needs intra_day=False here so intraday intervals can still return
            # prior-session candles for indicator warmup/backtest history.
            intra_day=False,
        )
        enriched = inject_indicator_columns(df, all_expressions)
        instrument_results.append(_run_instrument(strategy, enriched, symbol))

    # Portfolio aggregation
    total_starting = strategy.initial_capital
    total_ending = sum(r.metrics.ending_capital for r in instrument_results)
    total_gross_profit = sum(r.metrics.gross_profit for r in instrument_results)
    total_gross_loss = sum(r.metrics.gross_loss for r in instrument_results)
    total_net_pnl = sum(r.metrics.net_pnl for r in instrument_results)
    total_brokerage = sum(r.metrics.total_brokerage for r in instrument_results)
    total_trades = sum(r.metrics.total_trades for r in instrument_results)
    total_winning = sum(r.metrics.winning_trades for r in instrument_results)
    total_losing = sum(r.metrics.losing_trades for r in instrument_results)
    win_rate_pct = (total_winning / total_trades * 100.0) if total_trades else 0.0
    return_pct = (total_net_pnl / total_starting * 100.0) if total_starting else 0.0
    profit_factor = round(total_gross_profit / total_gross_loss, 4) if total_gross_loss > 0 else None

    # Portfolio equity (sum of per-instrument curves)
    portfolio_equity_curve = _merge_equity_curves(instrument_results)
    portfolio_equity_values = [p.equity for p in portfolio_equity_curve]
    max_dd = _max_drawdown_pct(portfolio_equity_values) if portfolio_equity_values else 0.0

    portfolio = PortfolioMetrics(
        starting_capital=round(total_starting, 4),
        ending_capital=round(total_ending, 4),
        gross_profit=round(total_gross_profit, 4),
        gross_loss=round(total_gross_loss, 4),
        net_pnl=round(total_net_pnl, 4),
        return_pct=round(return_pct, 4),
        total_trades=total_trades,
        winning_trades=total_winning,
        losing_trades=total_losing,
        win_rate_pct=round(win_rate_pct, 4),
        profit_factor=profit_factor,
        max_drawdown_pct=max_dd,
        capital_per_instrument=round(strategy.capital_per_instrument, 4),
        total_brokerage=round(total_brokerage, 4),
        equity_curve=portfolio_equity_curve,
    )

    strategy_summary = {
        "instruments": strategy.instruments,
        "interval": strategy.interval,
        "entry_side": strategy.entry_side,
        "exit_mode": strategy.exit_mode,
        "holding_type": strategy.holding_type,
        "execution_style": strategy.execution_style,
        "initial_capital": strategy.initial_capital,
        "start_date": strategy.start_date,
        "end_date": strategy.end_date,
    }

    return StrategyBacktestResult(
        mode="backtest",
        strategy_summary=strategy_summary,
        instruments=instrument_results,
        portfolio=portfolio,
    )
