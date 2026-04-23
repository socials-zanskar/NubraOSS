import unittest
from datetime import datetime
from unittest.mock import patch

import pandas as pd

from app.services.strategy_backtester import ParsedStrategy, _run_instrument
from app.services.strategy_data import IST_TZ, IndicatorExpr, column_name_for, inject_indicator_columns
from app.services.strategy_eval import Condition, ConditionGroup, NumberOperand
from app.services.strategy_live_service import LivePosition, LiveRuntime, StrategyLiveService


def make_df(rows: list[tuple[str, float, float, float, float, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "timestamp": pd.Timestamp(timestamp, tz=IST_TZ),
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": volume,
            }
            for timestamp, open_price, high_price, low_price, close_price, volume in rows
        ]
    )


def indicator_expr(indicator_type: str, **params: object) -> IndicatorExpr:
    return IndicatorExpr.from_dict({"type": indicator_type, "params": params})


def build_strategy(
    *,
    entry_side: str,
    entry_conditions: Condition | ConditionGroup,
    exit_mode: str = "sl_tgt",
    exit_conditions: Condition | ConditionGroup | None = None,
    stop_loss_pct: float | None = 1.0,
    target_pct: float | None = 1.0,
    holding_type: str = "positional",
    stop_target_conflict: str = "target",
    initial_capital: float = 10000.0,
    capital_per_instrument: float = 10000.0,
) -> ParsedStrategy:
    return ParsedStrategy(
        instruments=["TEST"],
        interval="1d",
        entry_side=entry_side,  # type: ignore[arg-type]
        entry_conditions=entry_conditions,
        exit_mode=exit_mode,  # type: ignore[arg-type]
        exit_conditions=exit_conditions,
        stop_loss_pct=stop_loss_pct,
        target_pct=target_pct,
        initial_capital=initial_capital,
        capital_per_instrument=capital_per_instrument,
        start_date="2024-01-01",
        end_date="2024-01-03",
        start_time="09:15",
        end_time="15:30",
        holding_type=holding_type,  # type: ignore[arg-type]
        exchange="NSE",
        instrument_type="STOCK",
        execution_style="same_bar_close",
        stop_target_conflict=stop_target_conflict,  # type: ignore[arg-type]
        cost_config=None,
    )


class StrategyDataTests(unittest.TestCase):
    def test_indicator_columns_are_unique_per_params(self) -> None:
        df = make_df(
            [
                ("2024-01-01 15:30", 100.0, 101.0, 99.0, 100.0, 1000.0),
                ("2024-01-02 15:30", 101.0, 103.0, 100.0, 102.0, 1000.0),
                ("2024-01-03 15:30", 102.0, 104.0, 101.0, 103.0, 1000.0),
                ("2024-01-04 15:30", 101.0, 105.0, 100.0, 104.0, 1000.0),
                ("2024-01-05 15:30", 104.0, 106.0, 103.0, 105.0, 1000.0),
                ("2024-01-06 15:30", 103.0, 107.0, 102.0, 106.0, 1000.0),
            ]
        )
        fast = indicator_expr("EMA", source="close", period=3)
        slow = indicator_expr("EMA", source="close", period=5)

        fast_col = column_name_for(fast)
        slow_col = column_name_for(slow)

        self.assertNotEqual(fast_col, slow_col)

        enriched = inject_indicator_columns(df, [fast, slow])
        self.assertIn(fast_col, enriched.columns)
        self.assertIn(slow_col, enriched.columns)


class StrategyBacktesterTests(unittest.TestCase):
    def test_buy_conflict_resolution_can_choose_target(self) -> None:
        price = indicator_expr("PRICE", source="close")
        entry = Condition(lhs=price, operator="less_than", rhs=NumberOperand(100.1))
        strategy = build_strategy(entry_side="BUY", entry_conditions=entry, stop_target_conflict="target")
        df = make_df(
            [
                ("2024-01-01 15:30", 99.8, 100.2, 99.5, 100.0, 1000.0),
                ("2024-01-02 15:30", 100.0, 102.0, 98.5, 100.5, 1000.0),
            ]
        )

        result = _run_instrument(strategy, inject_indicator_columns(df, [price]), "TEST")

        self.assertEqual(len(result.trades), 1)
        self.assertEqual(result.trades[0].exit_reason, "target")
        self.assertAlmostEqual(result.trades[0].exit_price, 101.0, places=4)

    def test_sell_conflict_resolution_can_choose_target(self) -> None:
        price = indicator_expr("PRICE", source="close")
        entry = Condition(lhs=price, operator="greater_than", rhs=NumberOperand(99.9))
        strategy = build_strategy(entry_side="SELL", entry_conditions=entry, stop_target_conflict="target")
        df = make_df(
            [
                ("2024-01-01 15:30", 99.8, 100.2, 99.5, 100.0, 1000.0),
                ("2024-01-02 15:30", 100.0, 101.5, 98.5, 99.5, 1000.0),
            ]
        )

        result = _run_instrument(strategy, inject_indicator_columns(df, [price]), "TEST")

        self.assertEqual(len(result.trades), 1)
        self.assertEqual(result.trades[0].exit_reason, "target")
        self.assertAlmostEqual(result.trades[0].exit_price, 99.0, places=4)


class StrategyLiveServiceTests(unittest.TestCase):
    def test_position_exit_signal_supports_condition_groups(self) -> None:
        price = indicator_expr("PRICE", source="close")
        grouped_exit = ConditionGroup(
            logic="AND",
            items=[Condition(lhs=price, operator="greater_than", rhs=NumberOperand(0.0))],
        )
        strategy = build_strategy(
            entry_side="BUY",
            entry_conditions=Condition(lhs=price, operator="greater_than", rhs=NumberOperand(0.0)),
            exit_mode="condition",
            exit_conditions=grouped_exit,
            stop_loss_pct=None,
            target_pct=None,
        )
        runtime = LiveRuntime(strategy=strategy, session_token="token", device_id="device", environment="UAT")
        position = LivePosition(
            instrument="TEST",
            quantity=1,
            entry_side="BUY",
            entry_price=100.0,
            entry_time_ist="2024-01-01 15:30 IST",
            entry_order_id=None,
            entry_order_status=None,
        )
        enriched = inject_indicator_columns(
            make_df([("2024-01-02 15:30", 100.0, 101.0, 99.0, 100.0, 1000.0)]),
            [price],
        )
        service = StrategyLiveService()

        reason, exit_price = service._position_exit_signal(runtime, position, enriched.iloc[-1], len(enriched) - 1, enriched)

        self.assertEqual(reason, "EXIT_CONDITION")
        self.assertEqual(exit_price, 100.0)

    def test_order_delivery_type_respects_lowercase_intraday(self) -> None:
        price = indicator_expr("PRICE", source="close")
        strategy = build_strategy(
            entry_side="BUY",
            entry_conditions=Condition(lhs=price, operator="greater_than", rhs=NumberOperand(0.0)),
            holding_type="intraday",
        )

        self.assertEqual(StrategyLiveService()._order_delivery_type(strategy), "ORDER_DELIVERY_TYPE_IDAY")

    def test_evaluate_once_uses_capital_per_instrument(self) -> None:
        price = indicator_expr("PRICE", source="close")
        strategy = build_strategy(
            entry_side="BUY",
            entry_conditions=Condition(lhs=price, operator="greater_than", rhs=NumberOperand(0.0)),
            exit_mode="sl_tgt",
            exit_conditions=None,
            capital_per_instrument=5000.0,
        )
        runtime = LiveRuntime(strategy=strategy, session_token="token", device_id="device", environment="UAT")
        service = StrategyLiveService()
        raw_df = make_df(
            [
                ("2024-01-01 15:30", 99.0, 101.0, 98.0, 100.0, 1000.0),
                ("2024-01-02 15:30", 99.0, 101.0, 98.0, 100.0, 1000.0),
            ]
        )
        enriched = inject_indicator_columns(raw_df, [price])
        captured_quantity: dict[str, int] = {}

        def fake_place_order(runtime_obj: LiveRuntime, instrument: str, quantity: int, order_side: str) -> dict[str, object]:
            captured_quantity["value"] = quantity
            return {
                "symbol": instrument,
                "exchange": "NSE",
                "order_id": 1,
                "order_status": "accepted",
                "requested_qty": quantity,
                "effective_qty": quantity,
                "filled_qty": quantity,
                "avg_filled_price": 100.0,
                "fallback_price": 100.0,
                "ltp_price": 100.0,
            }

        with (
            patch("app.services.strategy_live_service.fetch_with_warmup", return_value=(raw_df, 0, 1)),
            patch("app.services.strategy_live_service.inject_indicator_columns", return_value=enriched),
            patch.object(service, "_resolve_instrument", return_value={"instrument": "TEST", "lot_size": 1}),
            patch.object(service, "_place_order", side_effect=fake_place_order),
            patch.object(service, "_record_alert", return_value=None),
        ):
            service._evaluate_once(
                runtime,
                pd.Timestamp(datetime(2024, 1, 2, 15, 30), tz=IST_TZ).to_pydatetime(),
            )

        self.assertEqual(captured_quantity["value"], 50)
        self.assertEqual(runtime.positions["TEST"].quantity, 50)


if __name__ == "__main__":
    unittest.main()
