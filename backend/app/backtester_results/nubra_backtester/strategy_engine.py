from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import time
from typing import Any, Mapping

import pandas as pd

from .engine import NubraIndicatorEngine
from .indicator_registry import condition_capabilities, indicator_catalog, signature_to_column
from .indicators import apply_indicator_expression, required_history_bars
from .models import (
    Condition,
    ConditionEvaluation,
    ConditionGroup,
    ConflictResolution,
    CostConfig,
    DailySignalLogRow,
    EquityPoint,
    ExecuteSpec,
    ExecutionStyle,
    HoldingType,
    IndicatorExpr,
    InstrumentBacktestResult,
    InstrumentMetrics,
    LiveInstrumentResult,
    NumberRange,
    PortfolioMetrics,
    Side,
    Strategy,
    StrategyBacktestResult,
    StrategySignalResult,
    Trade,
)

_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal state dataclasses
# ---------------------------------------------------------------------------

@dataclass
class PreparedSymbolData:
    symbol: str
    data: pd.DataFrame
    requested_start: pd.Timestamp
    requested_end: pd.Timestamp
    fetched_start: pd.Timestamp
    fetched_end: pd.Timestamp
    warmup_bars_required: int
    warmup_rows_available: int
    fetch_attempts: int
    request_payload: dict[str, Any]
    column_map: dict[str, str]


@dataclass
class PositionState:
    side: Side
    entry_index: int
    entry_timestamp: pd.Timestamp
    entry_price: float
    quantity: float
    entry_capital: float
    stop_loss_price: float | None
    target_price: float | None


@dataclass
class PendingEntryState:
    side: Side
    signal_timestamp: pd.Timestamp


@dataclass
class PendingExitState:
    reason: str
    signal_timestamp: pd.Timestamp


# ---------------------------------------------------------------------------
# Strategy engine
# ---------------------------------------------------------------------------

class NubraStrategyEngine(NubraIndicatorEngine):

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def backtest(self, strategy: Strategy | Mapping[str, Any]) -> StrategyBacktestResult:
        normalized = self._coerce_strategy(strategy)
        capital_per_instrument = normalized.execute.initial_capital / len(normalized.instruments)

        instrument_results = [
            self._backtest_symbol(normalized, symbol, capital_per_instrument)
            for symbol in normalized.instruments
        ]
        portfolio = self._build_portfolio_metrics(
            instrument_results=instrument_results,
            starting_capital=normalized.execute.initial_capital,
            capital_per_instrument=capital_per_instrument,
        )
        return StrategyBacktestResult(
            strategy=normalized,
            instruments=instrument_results,
            portfolio=portfolio,
        )

    def backtest_json(self, strategy: Strategy | Mapping[str, Any]) -> dict[str, Any]:
        return self.backtest(strategy).model_dump(mode="json")

    def evaluate_realtime(
        self,
        strategy: Strategy | Mapping[str, Any],
        *,
        as_of: Any | None = None,
    ) -> StrategySignalResult:
        normalized = self._coerce_strategy(strategy)
        as_of_ts = self._normalize_timestamp(as_of or pd.Timestamp.now(tz=self.timezone))

        results = [self._evaluate_symbol_live(normalized, symbol, as_of_ts) for symbol in normalized.instruments]
        return StrategySignalResult(strategy=normalized, instruments=results)

    def evaluate_realtime_json(
        self,
        strategy: Strategy | Mapping[str, Any],
        *,
        as_of: Any | None = None,
    ) -> dict[str, Any]:
        return self.evaluate_realtime(strategy, as_of=as_of).model_dump(mode="json")

    @staticmethod
    def indicator_catalog() -> list[dict[str, Any]]:
        return indicator_catalog()

    @staticmethod
    def condition_capabilities(indicator_type: str, output: str | None = None) -> dict[str, Any]:
        return condition_capabilities(indicator_type, output)

    # ------------------------------------------------------------------
    # Backtest core
    # ------------------------------------------------------------------

    def _backtest_symbol(
        self,
        strategy: Strategy,
        symbol: str,
        capital_per_instrument: float,
    ) -> InstrumentBacktestResult:
        requested_start, requested_end = self._execution_window(strategy.execute)
        prepared = self._prepare_symbol_data(
            strategy=strategy,
            symbol=symbol,
            requested_start=requested_start,
            requested_end=requested_end,
        )

        df = prepared.data[
            (prepared.data["timestamp"] >= requested_start) & (prepared.data["timestamp"] <= requested_end)
        ].reset_index(drop=True)
        if df.empty:
            raise ValueError(f"No rows were available for {symbol} between {requested_start} and {requested_end}.")

        capital = capital_per_instrument
        position: PositionState | None = None
        pending_entry: PendingEntryState | None = None
        pending_exit: PendingExitState | None = None
        trades: list[Trade] = []
        equity_curve: list[EquityPoint] = []
        daily_signal_log: list[DailySignalLogRow] = []
        triggered_days: list[DailySignalLogRow] = []
        expressions = strategy.unique_indicator_expressions()

        execution_style = strategy.execute.execution_style
        cost_config = strategy.execute.cost_config
        conflict_resolution = strategy.execute.stop_target_conflict
        is_intraday = strategy.execute.holding_type == HoldingType.INTRADAY

        for idx in range(len(df)):
            row = df.iloc[idx]
            timestamp = row["timestamp"]
            open_price = self._to_float(row["open"])
            close_price = self._to_float(row["close"])
            next_timestamp = df.iloc[idx + 1]["timestamp"] if idx + 1 < len(df) else None
            action_parts: list[str] = []

            entry_signal, entry_conditions = self._evaluate_condition_group(
                df, idx, strategy.entry.conditions, prepared.column_map,
            )
            exit_conditions: list[ConditionEvaluation] = []
            exit_signal = False
            if strategy.exit.mode.value in {"condition", "both"} and strategy.exit.conditions:
                exit_signal, exit_conditions = self._evaluate_condition_group(
                    df, idx, strategy.exit.conditions, prepared.column_map,
                )

            session_allows_entry = self._session_allows_entry(timestamp, strategy.execute)
            session_must_close = self._should_force_session_close(timestamp, next_timestamp, strategy.execute)

            # -----------------------------------------------------------------
            # Phase A: settle pending fills from the PRIOR bar (NEXT_BAR_OPEN only).
            # pending_* are always None in SAME_BAR_CLOSE mode, so these
            # branches are dead code in that path.
            # -----------------------------------------------------------------
            if position is not None and pending_exit is not None:
                capital, trade = self._close_position(
                    symbol=symbol,
                    position=position,
                    exit_timestamp=timestamp,
                    exit_price=open_price,
                    exit_reason=pending_exit.reason,
                    capital=capital,
                    exit_index=idx,
                    cost_config=cost_config,
                    is_intraday=is_intraday,
                )
                trades.append(trade)
                position = None
                action_parts.append(f"exit_{pending_exit.reason}")
                pending_exit = None

            if position is None and pending_entry is not None and open_price > 0:
                position = PositionState(
                    side=pending_entry.side,
                    entry_index=idx,
                    entry_timestamp=timestamp,
                    entry_price=open_price,
                    quantity=capital / open_price,
                    entry_capital=capital,
                    stop_loss_price=self._stop_loss_price(pending_entry.side, open_price, strategy.exit.stop_loss_pct),
                    target_price=self._target_price(pending_entry.side, open_price, strategy.exit.target_pct),
                )
                action_parts.append(f"enter_{pending_entry.side.value.lower()}")
                pending_entry = None

            # -----------------------------------------------------------------
            # Phase B: stop-loss / target check for any position open at the
            # START of this bar. Uses the bar's full OHLC range (both styles).
            # -----------------------------------------------------------------
            if position is not None:
                exit_reason, exit_price = self._check_stop_or_target(
                    position, row, conflict_resolution
                )
                if exit_reason is not None and exit_price is not None:
                    capital, trade = self._close_position(
                        symbol=symbol,
                        position=position,
                        exit_timestamp=timestamp,
                        exit_price=exit_price,
                        exit_reason=exit_reason,
                        capital=capital,
                        exit_index=idx,
                        cost_config=cost_config,
                        is_intraday=is_intraday,
                    )
                    trades.append(trade)
                    position = None
                    action_parts.append(f"exit_{exit_reason}")
                    pending_exit = None

            # -----------------------------------------------------------------
            # Phase C: signal-driven actions — branched by execution style.
            # -----------------------------------------------------------------
            if execution_style == ExecutionStyle.SAME_BAR_CLOSE:
                # C1 — SAME_BAR_CLOSE
                # Signal fires on bar N → fill at bar N's close (no lag).
                # Order: exit before entry so flip-flopping can't wash-trade.

                if (
                    position is not None
                    and exit_signal
                    and strategy.exit.mode.value in {"condition", "both"}
                    and close_price > 0
                ):
                    capital, trade = self._close_position(
                        symbol=symbol,
                        position=position,
                        exit_timestamp=timestamp,
                        exit_price=close_price,
                        exit_reason="exit_condition",
                        capital=capital,
                        exit_index=idx,
                        cost_config=cost_config,
                        is_intraday=is_intraday,
                    )
                    trades.append(trade)
                    position = None
                    action_parts.append("exit_condition")

                if position is not None and session_must_close:
                    capital, trade = self._close_position(
                        symbol=symbol,
                        position=position,
                        exit_timestamp=timestamp,
                        exit_price=close_price,
                        exit_reason="session_end",
                        capital=capital,
                        exit_index=idx,
                        cost_config=cost_config,
                        is_intraday=is_intraday,
                    )
                    trades.append(trade)
                    position = None
                    action_parts.append("exit_session_end")

                if (
                    position is None
                    and entry_signal
                    and close_price > 0
                    and session_allows_entry
                    and not session_must_close
                ):
                    position = PositionState(
                        side=strategy.entry.side,
                        entry_index=idx,
                        entry_timestamp=timestamp,
                        entry_price=close_price,
                        quantity=capital / close_price,
                        entry_capital=capital,
                        stop_loss_price=self._stop_loss_price(
                            strategy.entry.side, close_price, strategy.exit.stop_loss_pct
                        ),
                        target_price=self._target_price(
                            strategy.entry.side, close_price, strategy.exit.target_pct
                        ),
                    )
                    action_parts.append(f"enter_{strategy.entry.side.value.lower()}")

            else:
                # C2 — NEXT_BAR_OPEN
                # Signal fires on bar N → fill at bar N+1's open.

                if position is not None and session_must_close:
                    capital, trade = self._close_position(
                        symbol=symbol,
                        position=position,
                        exit_timestamp=timestamp,
                        exit_price=close_price,
                        exit_reason="session_end",
                        capital=capital,
                        exit_index=idx,
                        cost_config=cost_config,
                        is_intraday=is_intraday,
                    )
                    trades.append(trade)
                    position = None
                    pending_exit = None
                    action_parts.append("exit_session_end")

                can_schedule_next_bar = next_timestamp is not None
                if (
                    position is None
                    and pending_entry is None
                    and entry_signal
                    and close_price > 0
                    and session_allows_entry
                    and can_schedule_next_bar
                    and not session_must_close
                ):
                    pending_entry = PendingEntryState(side=strategy.entry.side, signal_timestamp=timestamp)
                    action_parts.append(f"signal_enter_{strategy.entry.side.value.lower()}")

                if (
                    position is not None
                    and pending_exit is None
                    and exit_signal
                    and strategy.exit.mode.value in {"condition", "both"}
                    and can_schedule_next_bar
                ):
                    pending_exit = PendingExitState(reason="exit_condition", signal_timestamp=timestamp)
                    action_parts.append("signal_exit_condition")

            # -----------------------------------------------------------------
            # Equity curve + daily log
            # -----------------------------------------------------------------
            equity_curve.append(EquityPoint(
                timestamp=timestamp,
                equity=capital if position is None else capital + self._unrealized_pnl(position, close_price),
            ))
            action = "|".join(action_parts) if action_parts else "hold"
            indicator_values = self._indicator_values_snapshot(
                df=df, idx=idx, expressions=expressions, column_map=prepared.column_map,
            )
            daily_row = DailySignalLogRow(
                timestamp=timestamp,
                open=self._to_float(row["open"]),
                high=self._to_float(row["high"]),
                low=self._to_float(row["low"]),
                close=close_price,
                volume=self._series_value(df, idx, "volume"),
                indicator_values=indicator_values,
                entry_signal=entry_signal,
                exit_signal=exit_signal,
                entry_conditions=entry_conditions,
                exit_conditions=exit_conditions,
                action=action,
                position_state=self._position_state_label(position),
                stop_loss_price=position.stop_loss_price if position is not None else None,
                target_price=position.target_price if position is not None else None,
            )
            daily_signal_log.append(daily_row)
            if entry_signal or exit_signal or action != "hold":
                triggered_days.append(daily_row)

        # Force-close any open position at end of backtest
        if position is not None:
            final_row = df.iloc[-1]
            last_action = daily_signal_log[-1].action
            combined_action = (
                "exit_end_of_backtest"
                if last_action == "hold"
                else f"{last_action}|exit_end_of_backtest"
            )
            capital, trade = self._close_position(
                symbol=symbol,
                position=position,
                exit_timestamp=final_row["timestamp"],
                exit_price=self._to_float(final_row["close"]),
                exit_reason="end_of_backtest",
                capital=capital,
                exit_index=len(df) - 1,
                cost_config=cost_config,
                is_intraday=is_intraday,
            )
            trades.append(trade)
            equity_curve[-1] = EquityPoint(timestamp=final_row["timestamp"], equity=capital)
            final_daily_row = daily_signal_log[-1].model_copy(
                update={"action": combined_action, "position_state": "flat",
                        "stop_loss_price": None, "target_price": None}
            )
            daily_signal_log[-1] = final_daily_row
            if triggered_days and triggered_days[-1].timestamp == final_daily_row.timestamp:
                triggered_days[-1] = final_daily_row
            else:
                triggered_days.append(final_daily_row)

        metrics = self._build_instrument_metrics(
            starting_capital=capital_per_instrument,
            ending_capital=capital,
            trades=trades,
            equity_curve=equity_curve,
        )
        final_indicator_values = self._indicator_values_snapshot(
            df=df,
            idx=len(df) - 1,
            expressions=strategy.unique_indicator_expressions(),
            column_map=prepared.column_map,
        )
        return InstrumentBacktestResult(
            symbol=symbol,
            bars_processed=len(df),
            fetched_start=prepared.fetched_start,
            fetched_end=prepared.fetched_end,
            requested_start=requested_start,
            requested_end=requested_end,
            warmup_bars_required=prepared.warmup_bars_required,
            warmup_rows_available=prepared.warmup_rows_available,
            fetch_attempts=prepared.fetch_attempts,
            request_payload=prepared.request_payload,
            final_indicator_values=final_indicator_values,
            daily_signal_log=daily_signal_log,
            triggered_days=triggered_days,
            metrics=metrics,
            trades=trades,
            equity_curve=equity_curve,
        )

    # ------------------------------------------------------------------
    # Live evaluation
    # ------------------------------------------------------------------

    def _evaluate_symbol_live(
        self,
        strategy: Strategy,
        symbol: str,
        as_of: pd.Timestamp,
    ) -> LiveInstrumentResult:
        prepared = self._prepare_symbol_data(
            strategy=strategy,
            symbol=symbol,
            requested_start=as_of,
            requested_end=as_of,
        )
        df = prepared.data[prepared.data["timestamp"] <= as_of].reset_index(drop=True)
        if df.empty:
            raise ValueError(f"No rows were available for {symbol} up to {as_of}.")

        idx = len(df) - 1
        row = df.iloc[idx]
        timestamp = row["timestamp"]
        last_price = self._to_float(row["close"])

        session_allows_entry = self._session_allows_entry(timestamp, strategy.execute)
        session_must_close = self._should_force_session_close(timestamp, None, strategy.execute)

        entry_signal, entry_conditions = self._evaluate_condition_group(
            df, idx, strategy.entry.conditions, prepared.column_map
        )
        exit_conditions: list[ConditionEvaluation] = []
        exit_signal = False
        if strategy.exit.mode.value in {"condition", "both"} and strategy.exit.conditions:
            exit_signal, exit_conditions = self._evaluate_condition_group(
                df, idx, strategy.exit.conditions, prepared.column_map,
            )

        action_if_flat, action_if_in_position = self._resolve_advisory_action(
            entry_signal=entry_signal,
            exit_signal=exit_signal,
            entry_side=strategy.entry.side,
            session_allows_entry=session_allows_entry,
            session_must_close=session_must_close,
        )

        return LiveInstrumentResult(
            symbol=symbol,
            as_of=timestamp,
            fetched_start=prepared.fetched_start,
            fetched_end=prepared.fetched_end,
            request_payload=prepared.request_payload,
            last_price=last_price,
            final_indicator_values=self._indicator_values_snapshot(
                df=df,
                idx=idx,
                expressions=strategy.unique_indicator_expressions(),
                column_map=prepared.column_map,
            ),
            entry_signal=entry_signal,
            exit_signal=exit_signal,
            session_allows_entry=session_allows_entry and not session_must_close,
            action_if_flat=action_if_flat,
            action_if_in_position=action_if_in_position,
            suggested_stop_loss_price=self._stop_loss_price(
                strategy.entry.side, last_price, strategy.exit.stop_loss_pct
            ),
            suggested_target_price=self._target_price(
                strategy.entry.side, last_price, strategy.exit.target_pct
            ),
            entry_conditions=entry_conditions,
            exit_conditions=exit_conditions,
        )

    # ------------------------------------------------------------------
    # Data preparation
    # ------------------------------------------------------------------

    def _prepare_symbol_data(
        self,
        *,
        strategy: Strategy,
        symbol: str,
        requested_start: pd.Timestamp,
        requested_end: pd.Timestamp,
    ) -> PreparedSymbolData:
        expressions = strategy.unique_indicator_expressions()
        chart_interval = strategy.chart.interval
        chart_symbol = symbol.upper()

        # Separate chart-native indicators from external-context ones
        chart_exprs = [
            e for e in expressions
            if (e.symbol or chart_symbol).upper() == chart_symbol
            and (e.interval or chart_interval).lower() == chart_interval.lower()
        ]
        external_exprs = [e for e in expressions if e not in chart_exprs]

        # Warmup based only on chart-native indicators
        warmup_bars = 0
        if chart_exprs:
            warmup_bars = max(
                required_history_bars(e.to_indicator_request(), chart_interval)
                for e in chart_exprs
            )
        if strategy.needs_previous_bar():
            warmup_bars += 1
        requested_warmup_bars = self._requested_warmup_bars(warmup_bars)

        df, payload, warmup_rows_available, fetch_attempts = self._fetch_with_warmup(
            symbol=symbol,
            exchange=strategy.execute.exchange,
            instrument_type=strategy.execute.instrument_type,
            interval=chart_interval,
            requested_start=requested_start,
            requested_end=requested_end,
            warmup_bars=requested_warmup_bars,
            real_time=strategy.execute.real_time,
            intra_day=False,
        )

        # Clean weekends and NaN rows before applying indicators
        prepared = self._validate_and_clean_data(df.copy(), symbol)
        column_map: dict[str, str] = {}

        # Apply chart-native indicators
        for expr in chart_exprs:
            col_name = signature_to_column(expr.signature())
            prepared, actual_col = apply_indicator_expression(
                prepared, expr.to_indicator_request(), column_name=col_name
            )
            column_map[expr.signature()] = actual_col

        # Fetch, compute, and merge external-context indicators
        if external_exprs:
            # Group by (symbol, interval, exchange, instrument_type)
            ctx_groups: dict[tuple[str, str, str, str], list[IndicatorExpr]] = {}
            for expr in external_exprs:
                ctx_key = (
                    (expr.symbol or chart_symbol).upper(),
                    (expr.interval or chart_interval).lower(),
                    (expr.exchange or strategy.execute.exchange).upper(),
                    (expr.instrument_type or strategy.execute.instrument_type).upper(),
                )
                ctx_groups.setdefault(ctx_key, []).append(expr)

            for (ext_sym, ext_interval, ext_exchange, ext_instr_type), ext_list in ctx_groups.items():
                ext_warmup = max(
                    required_history_bars(e.to_indicator_request(), ext_interval)
                    for e in ext_list
                )
                ext_df, _, _, _ = self._fetch_with_warmup(
                    symbol=ext_sym,
                    exchange=ext_exchange,
                    instrument_type=ext_instr_type,
                    interval=ext_interval,
                    requested_start=requested_start,
                    requested_end=requested_end,
                    warmup_bars=self._requested_warmup_bars(ext_warmup),
                    real_time=strategy.execute.real_time,
                    intra_day=False,
                )
                ext_df = self._validate_and_clean_data(ext_df, ext_sym)

                ext_cols: list[str] = []
                for expr in ext_list:
                    col_name = signature_to_column(expr.signature())
                    ext_df, actual_col = apply_indicator_expression(
                        ext_df, expr.to_indicator_request(), column_name=col_name
                    )
                    column_map[expr.signature()] = actual_col
                    ext_cols.append(actual_col)

                # Align external indicator values to chart timestamps.
                # direction="backward" = last completed bar only (no lookahead).
                merge_src = ext_df[["timestamp"] + ext_cols].sort_values("timestamp")
                chart_ts = prepared[["timestamp"]].sort_values("timestamp")
                aligned = pd.merge_asof(
                    chart_ts, merge_src, on="timestamp", direction="backward"
                )
                # Restore original index order after sort
                aligned = aligned.set_index(chart_ts.index)
                for col in ext_cols:
                    prepared[col] = aligned[col].values

        return PreparedSymbolData(
            symbol=symbol,
            data=prepared,
            requested_start=requested_start,
            requested_end=requested_end,
            fetched_start=df["timestamp"].min(),
            fetched_end=df["timestamp"].max(),
            warmup_bars_required=warmup_bars,
            warmup_rows_available=warmup_rows_available,
            fetch_attempts=fetch_attempts,
            request_payload=payload,
            column_map=column_map,
        )

    # ------------------------------------------------------------------
    # Data validation
    # ------------------------------------------------------------------

    def _validate_and_clean_data(self, df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        """
        Remove weekend rows and rows with NaN OHLC values, logging each removal.

        Weekends produce wrong bar counts and fake timestamps (already observed
        in production — Sunday exit dates in backtest output).
        NaN OHLC values crash price-to-float conversion mid-loop.
        Both issues are cleaned here so the backtest loop never sees them.
        """
        # Drop weekends (weekday: Mon=0 … Sun=6)
        weekend_mask = df["timestamp"].dt.weekday >= 5
        n_weekend = int(weekend_mask.sum())
        if n_weekend > 0:
            _log.warning(
                "%s: dropping %d weekend row(s) from market data: %s",
                symbol,
                n_weekend,
                df.loc[weekend_mask, "timestamp"].dt.date.tolist(),
            )
            df = df.loc[~weekend_mask].reset_index(drop=True)

        # Drop rows where any OHLC field is NaN
        ohlc_cols = ["open", "high", "low", "close"]
        nan_mask = df[ohlc_cols].isna().any(axis=1)
        n_nan = int(nan_mask.sum())
        if n_nan > 0:
            _log.warning(
                "%s: dropping %d row(s) with NaN OHLC values: %s",
                symbol,
                n_nan,
                df.loc[nan_mask, "timestamp"].dt.date.tolist(),
            )
            df = df.loc[~nan_mask].reset_index(drop=True)

        return df

    # ------------------------------------------------------------------
    # Condition evaluation (recursive, short-circuit)
    # ------------------------------------------------------------------

    def _evaluate_condition_group(
        self,
        df: pd.DataFrame,
        idx: int,
        group: ConditionGroup,
        column_map: dict[str, str],
    ) -> tuple[bool, list[ConditionEvaluation]]:
        """
        Recursively evaluate a ConditionGroup with proper short-circuit logic.

        AND  → returns False as soon as any item is False; remaining items
               are skipped (not evaluated, not included in the log).
        OR   → returns True  as soon as any item is True;  remaining items
               are skipped.

        The returned evaluations list contains only items actually evaluated
        up to the short-circuit point. Skipped items are omitted, which is
        intentional — they had no bearing on the final signal.
        """
        evaluations: list[ConditionEvaluation] = []

        if group.logic == "AND":
            for item in group.items:
                if isinstance(item, ConditionGroup):
                    matched, sub_evals = self._evaluate_condition_group(df, idx, item, column_map)
                    evaluations.extend(sub_evals)
                    if not matched:
                        return False, evaluations  # short-circuit AND
                else:
                    result = self._evaluate_condition(df, idx, item, column_map)
                    evaluations.append(result)
                    if not result.matched:
                        return False, evaluations  # short-circuit AND
            return True, evaluations

        else:  # OR
            for item in group.items:
                if isinstance(item, ConditionGroup):
                    matched, sub_evals = self._evaluate_condition_group(df, idx, item, column_map)
                    evaluations.extend(sub_evals)
                    if matched:
                        return True, evaluations  # short-circuit OR
                else:
                    result = self._evaluate_condition(df, idx, item, column_map)
                    evaluations.append(result)
                    if result.matched:
                        return True, evaluations  # short-circuit OR
            return False, evaluations

    def _evaluate_condition(
        self,
        df: pd.DataFrame,
        idx: int,
        condition: Condition,
        column_map: dict[str, str],
    ) -> ConditionEvaluation:
        lhs_column = column_map[condition.lhs.signature()]
        lhs_value = self._series_value(df, idx, lhs_column)
        lhs_previous = self._series_value(df, idx - 1, lhs_column) if idx > 0 else None
        rhs_value: float | dict[str, float] | None = None
        rhs_previous: float | None = None

        if lhs_value is None:
            return ConditionEvaluation(
                lhs=condition.lhs, op=condition.op, rhs=condition.rhs,
                matched=False, message="lhs has insufficient data on this bar.",
            )

        if isinstance(condition.rhs, IndicatorExpr):
            rhs_column = column_map[condition.rhs.signature()]
            rhs_value = self._series_value(df, idx, rhs_column)
            rhs_previous = self._series_value(df, idx - 1, rhs_column) if idx > 0 else None
            if rhs_value is None:
                return ConditionEvaluation(
                    lhs=condition.lhs, op=condition.op, rhs=condition.rhs,
                    matched=False, lhs_value=lhs_value, lhs_previous=lhs_previous,
                    message="rhs has insufficient data on this bar.",
                )
        elif isinstance(condition.rhs, NumberRange):
            rhs_value = {"low": condition.rhs.low, "high": condition.rhs.high}
        else:
            rhs_value = float(condition.rhs)

        operator = condition.op.value
        if operator in {"crosses_above", "crosses_below", "up_by", "down_by"} and lhs_previous is None:
            return ConditionEvaluation(
                lhs=condition.lhs, op=condition.op, rhs=condition.rhs,
                matched=False, lhs_value=lhs_value, rhs_value=rhs_value,
                message="previous bar data is required for this operator.",
            )

        if (
            operator in {"crosses_above", "crosses_below"}
            and isinstance(condition.rhs, IndicatorExpr)
            and rhs_previous is None
        ):
            return ConditionEvaluation(
                lhs=condition.lhs, op=condition.op, rhs=condition.rhs,
                matched=False, lhs_value=lhs_value, rhs_value=rhs_value,
                lhs_previous=lhs_previous,
                message="rhs previous bar data is required for cross operators.",
            )

        matched = self._match_operator(
            operator=operator,
            lhs_value=lhs_value,
            lhs_previous=lhs_previous,
            rhs=condition.rhs,
            rhs_value=rhs_value,
            rhs_previous=rhs_previous,
        )
        return ConditionEvaluation(
            lhs=condition.lhs, op=condition.op, rhs=condition.rhs,
            matched=matched, lhs_value=lhs_value, rhs_value=rhs_value,
            lhs_previous=lhs_previous, rhs_previous=rhs_previous,
        )

    # ------------------------------------------------------------------
    # Trade execution helpers
    # ------------------------------------------------------------------

    def _close_position(
        self,
        *,
        symbol: str,
        position: PositionState,
        exit_timestamp: pd.Timestamp,
        exit_price: float,
        exit_reason: str,
        capital: float,
        exit_index: int,
        cost_config: CostConfig | None = None,
        is_intraday: bool = False,
    ) -> tuple[float, Trade]:
        raw_pnl = self._realized_pnl(position, exit_price)

        brokerage = 0.0
        if cost_config is not None:
            entry_value = position.entry_price * position.quantity
            exit_value = exit_price * position.quantity
            brokerage = (
                self._compute_brokerage(entry_value, is_intraday, cost_config)
                + self._compute_brokerage(exit_value, is_intraday, cost_config)
            )

        pnl = raw_pnl - brokerage
        ending_capital = capital + pnl
        trade = Trade(
            symbol=symbol,
            side=position.side,
            entry_timestamp=position.entry_timestamp,
            exit_timestamp=exit_timestamp,
            entry_price=position.entry_price,
            exit_price=exit_price,
            quantity=position.quantity,
            pnl=pnl,
            pnl_pct=(pnl / position.entry_capital) * 100.0 if position.entry_capital else 0.0,
            bars_held=exit_index - position.entry_index,  # 0 = same-bar; no artificial floor
            exit_reason=exit_reason,
            brokerage=brokerage,
        )
        return ending_capital, trade

    def _compute_brokerage(
        self,
        trade_value: float,
        is_intraday: bool,
        cost_config: CostConfig,
    ) -> float:
        """
        Brokerage cost for a single order (one-way: entry OR exit separately).
        Caller sums entry + exit for round-trip cost.

        Delivery: min(pct_cost, flat_cap) — flat_cap=0 means no cap.
        Intraday: min(pct_cost, flat_cap) — Zerodha default: min(0.03%, ₹20).
        """
        if is_intraday:
            pct_cost = trade_value * cost_config.intraday_brokerage_pct / 100.0
            flat_cap = cost_config.intraday_brokerage_flat
            return min(pct_cost, flat_cap) if flat_cap > 0 else pct_cost
        else:
            pct_cost = trade_value * cost_config.delivery_brokerage_pct / 100.0
            flat_cap = cost_config.delivery_brokerage_flat
            return min(pct_cost, flat_cap) if flat_cap > 0 else pct_cost

    def _check_stop_or_target(
        self,
        position: PositionState,
        row: pd.Series,
        conflict_resolution: ConflictResolution = ConflictResolution.STOP,
    ) -> tuple[str | None, float | None]:
        open_price = self._to_float(row["open"])
        high = self._to_float(row["high"])
        low = self._to_float(row["low"])

        stop_price = position.stop_loss_price
        target_price = position.target_price

        if position.side == Side.BUY:
            # Gap through stop or target at open
            if stop_price is not None and open_price <= stop_price:
                return "stop_loss", open_price
            if target_price is not None and open_price >= target_price:
                return "target", open_price

            stop_hit = stop_price is not None and low <= stop_price
            target_hit = target_price is not None and high >= target_price

            if stop_hit and target_hit:
                # Both levels touched intrabar — sequence is ambiguous without ticks
                if conflict_resolution == ConflictResolution.TARGET:
                    return "target", target_price
                return "stop_loss", stop_price
            if stop_hit:
                return "stop_loss", stop_price
            if target_hit:
                return "target", target_price
            return None, None

        # SELL side
        if stop_price is not None and open_price >= stop_price:
            return "stop_loss", open_price
        if target_price is not None and open_price <= target_price:
            return "target", open_price

        stop_hit = stop_price is not None and high >= stop_price
        target_hit = target_price is not None and low <= target_price

        if stop_hit and target_hit:
            if conflict_resolution == ConflictResolution.TARGET:
                return "target", target_price
            return "stop_loss", stop_price
        if stop_hit:
            return "stop_loss", stop_price
        if target_hit:
            return "target", target_price
        return None, None

    # ------------------------------------------------------------------
    # Advisory action resolver (shared by backtest log and live eval)
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_advisory_action(
        *,
        entry_signal: bool,
        exit_signal: bool,
        entry_side: Side,
        session_allows_entry: bool,
        session_must_close: bool,
    ) -> tuple[str, str]:
        """
        Returns (action_if_flat, action_if_in_position) for signal reporting.
        This is advisory only — it does not execute any trade.
        """
        action_if_flat = "hold"
        if entry_signal and session_allows_entry and not session_must_close:
            action_if_flat = f"enter_{entry_side.value.lower()}"

        action_if_in_position = "exit" if (exit_signal or session_must_close) else "hold"
        return action_if_flat, action_if_in_position

    # ------------------------------------------------------------------
    # Metrics builders
    # ------------------------------------------------------------------

    def _build_instrument_metrics(
        self,
        *,
        starting_capital: float,
        ending_capital: float,
        trades: list[Trade],
        equity_curve: list[EquityPoint],
    ) -> InstrumentMetrics:
        gross_profit = sum(max(trade.pnl, 0.0) for trade in trades)
        gross_loss = sum(min(trade.pnl, 0.0) for trade in trades)
        winning_trades = sum(1 for trade in trades if trade.pnl > 0)
        losing_trades = sum(1 for trade in trades if trade.pnl < 0)
        total_trades = len(trades)
        avg_pnl = sum(trade.pnl for trade in trades) / total_trades if total_trades else 0.0
        avg_pnl_pct = sum(trade.pnl_pct for trade in trades) / total_trades if total_trades else 0.0
        total_brokerage = sum(trade.brokerage for trade in trades)
        profit_factor = None
        if gross_loss < 0:
            profit_factor = gross_profit / abs(gross_loss)

        return InstrumentMetrics(
            starting_capital=starting_capital,
            ending_capital=ending_capital,
            gross_profit=gross_profit,
            gross_loss=gross_loss,
            net_pnl=ending_capital - starting_capital,
            return_pct=((ending_capital / starting_capital) - 1.0) * 100.0 if starting_capital else 0.0,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate_pct=(winning_trades / total_trades) * 100.0 if total_trades else 0.0,
            avg_pnl=avg_pnl,
            avg_pnl_pct=avg_pnl_pct,
            profit_factor=profit_factor,
            max_drawdown_pct=self._max_drawdown_pct(equity_curve),
            total_brokerage=total_brokerage,
        )

    def _build_portfolio_metrics(
        self,
        *,
        instrument_results: list[InstrumentBacktestResult],
        starting_capital: float,
        capital_per_instrument: float,
    ) -> PortfolioMetrics:
        ending_capital = sum(r.metrics.ending_capital for r in instrument_results)
        gross_profit = sum(r.metrics.gross_profit for r in instrument_results)
        gross_loss = sum(r.metrics.gross_loss for r in instrument_results)
        total_trades = sum(r.metrics.total_trades for r in instrument_results)
        winning_trades = sum(r.metrics.winning_trades for r in instrument_results)
        losing_trades = sum(r.metrics.losing_trades for r in instrument_results)
        total_brokerage = sum(r.metrics.total_brokerage for r in instrument_results)
        profit_factor = None
        if gross_loss < 0:
            profit_factor = gross_profit / abs(gross_loss)

        portfolio_curve = self._merge_equity_curves(instrument_results, capital_per_instrument)
        return PortfolioMetrics(
            starting_capital=starting_capital,
            ending_capital=ending_capital,
            gross_profit=gross_profit,
            gross_loss=gross_loss,
            net_pnl=ending_capital - starting_capital,
            return_pct=((ending_capital / starting_capital) - 1.0) * 100.0 if starting_capital else 0.0,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate_pct=(winning_trades / total_trades) * 100.0 if total_trades else 0.0,
            profit_factor=profit_factor,
            max_drawdown_pct=self._max_drawdown_pct(portfolio_curve),
            capital_per_instrument=capital_per_instrument,
            equity_curve=portfolio_curve,
            total_brokerage=total_brokerage,
        )

    def _merge_equity_curves(
        self,
        instrument_results: list[InstrumentBacktestResult],
        capital_per_instrument: float,
    ) -> list[EquityPoint]:
        if not instrument_results:
            return []

        series_list: list[pd.Series] = []
        for result in instrument_results:
            if not result.equity_curve:
                continue
            series = pd.Series(
                [point.equity for point in result.equity_curve],
                index=pd.Index([point.timestamp for point in result.equity_curve]),
                dtype="float64",
            )
            series_list.append(series)

        if not series_list:
            return []

        frame = pd.concat(series_list, axis=1).sort_index()
        frame = frame.ffill().fillna(capital_per_instrument)
        total = frame.sum(axis=1)
        return [EquityPoint(timestamp=index, equity=float(value)) for index, value in total.items()]

    # ------------------------------------------------------------------
    # Session / window helpers
    # ------------------------------------------------------------------

    def _session_allows_entry(self, timestamp: pd.Timestamp, execute: ExecuteSpec) -> bool:
        if execute.holding_type != HoldingType.INTRADAY:
            return True
        current_time = timestamp.timetz().replace(tzinfo=None)
        return execute.start_time <= current_time < execute.end_time

    def _should_force_session_close(
        self,
        timestamp: pd.Timestamp,
        next_timestamp: pd.Timestamp | None,
        execute: ExecuteSpec,
    ) -> bool:
        if execute.holding_type != HoldingType.INTRADAY:
            return False
        current_time = timestamp.timetz().replace(tzinfo=None)
        if current_time >= execute.end_time:
            return True
        if next_timestamp is None:
            return False
        next_time = next_timestamp.timetz().replace(tzinfo=None)
        if next_timestamp.normalize() != timestamp.normalize():
            return True
        return next_time >= execute.end_time

    def _execution_window(self, execute: ExecuteSpec) -> tuple[pd.Timestamp, pd.Timestamp]:
        start = pd.Timestamp.combine(execute.start_date, execute.start_time or time(0, 0, 0))
        end_time_value = execute.end_time or time(23, 59, 59, 999999)
        end = pd.Timestamp.combine(execute.end_date, end_time_value)
        return self._normalize_timestamp(start), self._normalize_timestamp(end)

    # ------------------------------------------------------------------
    # Misc helpers
    # ------------------------------------------------------------------

    def _normalize_timestamp(self, value: Any) -> pd.Timestamp:
        timestamp = pd.Timestamp(value)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize(self.timezone)
        return timestamp.tz_convert(self.timezone)

    def _coerce_strategy(self, strategy: Strategy | Mapping[str, Any]) -> Strategy:
        if isinstance(strategy, Strategy):
            return strategy
        return Strategy.model_validate(strategy)

    def _series_value(self, df: pd.DataFrame, idx: int, column: str) -> float | None:
        if idx < 0 or idx >= len(df):
            return None
        value = df.iloc[idx][column]
        if pd.isna(value):
            return None
        return float(value)

    def _stop_loss_price(self, side: Side, price: float, stop_loss_pct: float | None) -> float | None:
        if stop_loss_pct is None:
            return None
        if side == Side.BUY:
            return price * (1.0 - stop_loss_pct / 100.0)
        return price * (1.0 + stop_loss_pct / 100.0)

    def _target_price(self, side: Side, price: float, target_pct: float | None) -> float | None:
        if target_pct is None:
            return None
        if side == Side.BUY:
            return price * (1.0 + target_pct / 100.0)
        return price * (1.0 - target_pct / 100.0)

    def _unrealized_pnl(self, position: PositionState, current_price: float) -> float:
        direction = 1.0 if position.side == Side.BUY else -1.0
        return (current_price - position.entry_price) * position.quantity * direction

    def _realized_pnl(self, position: PositionState, exit_price: float) -> float:
        direction = 1.0 if position.side == Side.BUY else -1.0
        return (exit_price - position.entry_price) * position.quantity * direction

    def _max_drawdown_pct(self, curve: list[EquityPoint]) -> float:
        if not curve:
            return 0.0
        peak = curve[0].equity
        max_drawdown = 0.0
        for point in curve:
            peak = max(peak, point.equity)
            if peak <= 0:
                continue
            drawdown = ((peak - point.equity) / peak) * 100.0
            max_drawdown = max(max_drawdown, drawdown)
        return max_drawdown

    def _to_float(self, value: Any) -> float:
        if value is None or pd.isna(value):
            raise ValueError(
                "NaN price value encountered during strategy evaluation. "
                "This should have been removed by _validate_and_clean_data — "
                "check that _prepare_symbol_data was called before the backtest loop."
            )
        return float(value)

    def _position_state_label(self, position: PositionState | None) -> str:
        if position is None:
            return "flat"
        return f"open_{position.side.value.lower()}"

    def _expression_label(self, expr: IndicatorExpr) -> str:
        parts = [f"{key}={expr.params[key]}" for key in sorted(expr.params)]
        if expr.output:
            parts.append(f"output={expr.output}")
        if expr.offset:
            parts.append(f"offset={expr.offset}")
        # Include context context in the label if set
        if expr.symbol:
            parts.append(f"symbol={expr.symbol}")
        if expr.interval:
            parts.append(f"interval={expr.interval}")
        joined = ", ".join(parts)
        if joined:
            return f"{expr.type}({joined})"
        return expr.type

    def _indicator_values_snapshot(
        self,
        *,
        df: pd.DataFrame,
        idx: int,
        expressions: list[IndicatorExpr],
        column_map: dict[str, str],
    ) -> dict[str, float | None]:
        values: dict[str, float | None] = {}
        for expr in expressions:
            signature = expr.signature()
            column = column_map.get(signature)
            if not column:
                continue
            values[self._expression_label(expr)] = self._series_value(df, idx, column)
        return values

    def _match_operator(
        self,
        *,
        operator: str,
        lhs_value: float,
        lhs_previous: float | None,
        rhs: IndicatorExpr | NumberRange | float,
        rhs_value: float | dict[str, float] | None,
        rhs_previous: float | None,
    ) -> bool:
        if operator == "within_range":
            if not isinstance(rhs, NumberRange):
                return False
            return rhs.low <= lhs_value <= rhs.high

        if isinstance(rhs, NumberRange):
            return False

        current_rhs = float(rhs_value) if rhs_value is not None and not isinstance(rhs_value, dict) else None
        if current_rhs is None:
            return False

        if operator == "greater_than":
            return lhs_value > current_rhs
        if operator == "less_than":
            return lhs_value < current_rhs
        if operator == "greater_equal":
            return lhs_value >= current_rhs
        if operator == "less_equal":
            return lhs_value <= current_rhs
        if operator == "equal":
            return math.isclose(lhs_value, current_rhs, rel_tol=1e-9, abs_tol=1e-9)
        if operator == "crosses_above":
            previous_rhs = rhs_previous if rhs_previous is not None else current_rhs
            return lhs_previous is not None and lhs_previous < previous_rhs and lhs_value > current_rhs
        if operator == "crosses_below":
            previous_rhs = rhs_previous if rhs_previous is not None else current_rhs
            return lhs_previous is not None and lhs_previous > previous_rhs and lhs_value < current_rhs
        if operator == "up_by":
            return lhs_previous is not None and (lhs_value - lhs_previous) >= current_rhs
        if operator == "down_by":
            return lhs_previous is not None and (lhs_previous - lhs_value) >= current_rhs
        return False
