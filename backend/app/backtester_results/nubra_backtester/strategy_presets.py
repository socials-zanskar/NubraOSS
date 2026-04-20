from __future__ import annotations

# ---------------------------------------------------------------------------
# Strategy presets — each preset deliberately exercises specific engine
# features so the Streamlit playground can be used as a functional test
# harness for every major code path.
#
# Feature coverage index
# ──────────────────────
#  1. RSI Reversal — Positional Daily          baseline, flat AND list (compat)
#  2. Nested OR Entry — OR(RSI, AND(MACD+EMA)) ConditionGroup nesting
#  3. Deeply Nested — AND(OR, OR)              3-level nesting, AND of two OR groups
#  4. Bollinger + Stoch — within_range op      within_range operator, NumberRange rhs
#  5. Intraday with Zerodha Brokerage          CostConfig, intraday holds
#  6. Next-Bar-Open Execution                  ExecutionStyle.NEXT_BAR_OPEN
#  7. Target Priority on Conflict              ConflictResolution.TARGET
#  8. SELL / Short Strategy                    SELL side, BUY exit logic reversed
#  9. Cross-Timeframe: 15m + Daily EMA         IndicatorExpr.interval override
# 10. Multi-Stock — All New Fields             comprehensive, multi-symbol
# ---------------------------------------------------------------------------

STRATEGY_PRESETS: dict[str, dict] = {

    # ── 1. Baseline ──────────────────────────────────────────────────────────
    "1. RSI Reversal — Positional Daily": {
        "instruments": ["HDFCBANK"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            # Flat list — engine auto-wraps as AND group (backward-compat check)
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14, "source": "close"}},
                    "op": "crosses_above",
                    "rhs": 30,
                },
                {
                    "lhs": {"type": "PRICE", "params": {"source": "close"}},
                    "op": "greater_than",
                    "rhs": {"type": "EMA", "params": {"period": 50, "source": "close"}},
                },
            ],
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 3.0,
            "target_pct": 6.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "stop",
        },
    },

    # ── 2. Nested OR entry ───────────────────────────────────────────────────
    # Entry fires when EITHER:
    #   Arm A: RSI crosses above 30 (oversold recovery)
    #   Arm B: price > EMA50  AND  MACD line crosses above signal line
    "2. Nested OR Entry — OR(RSI, AND(MACD+EMA))": {
        "instruments": ["RELIANCE"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            "conditions": {
                "logic": "OR",
                "items": [
                    # Arm A — single condition
                    {
                        "lhs": {"type": "RSI", "params": {"length": 14}},
                        "op": "crosses_above",
                        "rhs": 30,
                    },
                    # Arm B — nested AND group
                    {
                        "logic": "AND",
                        "items": [
                            {
                                "lhs": {"type": "PRICE"},
                                "op": "greater_than",
                                "rhs": {"type": "EMA", "params": {"period": 50}},
                            },
                            {
                                "lhs": {
                                    "type": "MACD",
                                    "params": {
                                        "fast_length": 12,
                                        "slow_length": 26,
                                        "signal_length": 9,
                                    },
                                    "output": "macd_line",
                                },
                                "op": "crosses_above",
                                "rhs": {
                                    "type": "MACD",
                                    "params": {
                                        "fast_length": 12,
                                        "slow_length": 26,
                                        "signal_length": 9,
                                    },
                                    "output": "signal_line",
                                },
                            },
                        ],
                    },
                ],
            },
        },
        "exit": {
            "mode": "both",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_above",
                    "rhs": 70,
                }
            ],
            "stop_loss_pct": 4.0,
            "target_pct": 8.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "stop",
        },
    },

    # ── 3. Deeply nested AND(OR, OR) ─────────────────────────────────────────
    # Entry fires when BOTH of these OR groups pass:
    #   Group A: RSI < 35  OR  RSI crosses above 30
    #   Group B: EMA20 > EMA50  OR  price > SMA200
    "3. Deeply Nested — AND(OR, OR)": {
        "instruments": ["INFY"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            "conditions": {
                "logic": "AND",
                "items": [
                    # Group A — oscillator signal
                    {
                        "logic": "OR",
                        "items": [
                            {
                                "lhs": {"type": "RSI", "params": {"length": 14}},
                                "op": "less_than",
                                "rhs": 35,
                            },
                            {
                                "lhs": {"type": "RSI", "params": {"length": 14}},
                                "op": "crosses_above",
                                "rhs": 30,
                            },
                        ],
                    },
                    # Group B — trend confirmation
                    {
                        "logic": "OR",
                        "items": [
                            {
                                "lhs": {"type": "EMA", "params": {"period": 20}},
                                "op": "greater_than",
                                "rhs": {"type": "EMA", "params": {"period": 50}},
                            },
                            {
                                "lhs": {"type": "PRICE"},
                                "op": "greater_than",
                                "rhs": {"type": "SMA", "params": {"period": 200}},
                            },
                        ],
                    },
                ],
            },
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 3.0,
            "target_pct": 6.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "stop",
        },
    },

    # ── 4. within_range operator + BB ────────────────────────────────────────
    # Tests the within_range operator with a NumberRange rhs.
    # Entry: RSI in [35, 60] AND price above BB lower band
    "4. Bollinger + RSI Range — within_range operator": {
        "instruments": ["TCS"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "within_range",
                    "rhs": {"low": 35, "high": 60},
                },
                {
                    "lhs": {"type": "PRICE"},
                    "op": "greater_than",
                    "rhs": {
                        "type": "BB",
                        "params": {"length": 20, "std_dev_up": 2.0, "std_dev_down": 2.0},
                        "output": "lower_band",
                    },
                },
                {
                    "lhs": {"type": "EMA", "params": {"period": 20}},
                    "op": "greater_than",
                    "rhs": {"type": "EMA", "params": {"period": 50}},
                },
            ],
        },
        "exit": {
            "mode": "both",
            "conditions": [
                {
                    "lhs": {"type": "PRICE"},
                    "op": "greater_than",
                    "rhs": {
                        "type": "BB",
                        "params": {"length": 20, "std_dev_up": 2.0, "std_dev_down": 2.0},
                        "output": "upper_band",
                    },
                }
            ],
            "stop_loss_pct": 2.5,
            "target_pct": 5.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "stop",
        },
    },

    # ── 5. Intraday with Zerodha brokerage ───────────────────────────────────
    # Tests CostConfig: round-trip brokerage = min(0.03% × value, ₹20) × 2 orders
    "5. Intraday with Zerodha Brokerage": {
        "instruments": ["HDFCBANK"],
        "chart": {"type": "Candlestick", "interval": "15m"},
        "entry": {
            "side": "BUY",
            "conditions": [
                {
                    "lhs": {"type": "PRICE"},
                    "op": "greater_than",
                    "rhs": {"type": "VWAP", "params": {"source": "hlc3", "anchor": "session"}},
                },
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "greater_than",
                    "rhs": 55,
                },
                {
                    "lhs": {"type": "EMA", "params": {"period": 9}},
                    "op": "greater_than",
                    "rhs": {"type": "EMA", "params": {"period": 21}},
                },
            ],
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 0.4,
            "target_pct": 0.8,
        },
        "execute": {
            "initial_capital": 200000,
            "start_date": "2026-02-01",
            "end_date": "2026-03-31",
            "start_time": "09:20",
            "end_time": "15:15",
            "holding_type": "intraday",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "cost_config": {
                "intraday_brokerage_pct": 0.03,
                "intraday_brokerage_flat": 20.0,
                "delivery_brokerage_pct": 0.0,
                "delivery_brokerage_flat": 0.0,
            },
            "stop_target_conflict": "stop",
        },
    },

    # ── 6. Next-bar-open execution ───────────────────────────────────────────
    # Same RSI+EMA strategy as preset 1 but fills at the NEXT bar's open.
    # Compare trades vs preset 1 to see the lag effect.
    "6. Next-Bar-Open Execution": {
        "instruments": ["HDFCBANK"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_above",
                    "rhs": 30,
                },
                {
                    "lhs": {"type": "PRICE"},
                    "op": "greater_than",
                    "rhs": {"type": "EMA", "params": {"period": 50}},
                },
            ],
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 3.0,
            "target_pct": 6.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "next_bar_open",     # <── KEY: fills at next open
            "stop_target_conflict": "stop",
        },
    },

    # ── 7. Target priority conflict resolution ───────────────────────────────
    # Tight SL and TGT so intrabar conflicts are common.
    # conflict = "target" means when both hit the same bar, we take the profit.
    "7. Target Priority on Conflict": {
        "instruments": ["RELIANCE"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "BUY",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_above",
                    "rhs": 30,
                },
            ],
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 1.0,   # tight — likely to see intrabar conflicts
            "target_pct": 1.5,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "target",        # <── KEY: optimistic resolution
        },
    },

    # ── 8. SELL / short strategy ─────────────────────────────────────────────
    # Entry on overbought RSI breakdown below EMA — tests SELL side PnL direction.
    "8. SELL / Short Strategy": {
        "instruments": ["HDFCBANK"],
        "chart": {"type": "Candlestick", "interval": "1d"},
        "entry": {
            "side": "SELL",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_below",
                    "rhs": 70,
                },
                {
                    "lhs": {"type": "PRICE"},
                    "op": "less_than",
                    "rhs": {"type": "EMA", "params": {"period": 50}},
                },
            ],
        },
        "exit": {
            "mode": "both",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_below",
                    "rhs": 35,
                }
            ],
            "stop_loss_pct": 3.0,
            "target_pct": 6.0,
        },
        "execute": {
            "initial_capital": 100000,
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "holding_type": "positional",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "stop_target_conflict": "stop",
        },
    },

    # ── 9. Cross-timeframe: 15m chart + daily EMA filter ─────────────────────
    # Tests IndicatorExpr.interval override.
    # Entry on 15m RSI cross, but only permitted when price is above daily EMA50.
    # The daily EMA is fetched separately and aligned via merge_asof(backward).
    "9. Cross-Timeframe: 15m Chart + Daily EMA Filter": {
        "instruments": ["HDFCBANK"],
        "chart": {"type": "Candlestick", "interval": "15m"},
        "entry": {
            "side": "BUY",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_above",
                    "rhs": 40,
                },
                {
                    "lhs": {"type": "PRICE"},
                    "op": "greater_than",
                    # interval="1d" → engine fetches daily data and aligns it
                    "rhs": {
                        "type": "EMA",
                        "params": {"period": 50},
                        "interval": "1d",
                    },
                },
            ],
        },
        "exit": {
            "mode": "sl_tgt",
            "stop_loss_pct": 0.5,
            "target_pct": 1.0,
        },
        "execute": {
            "initial_capital": 200000,
            "start_date": "2026-02-01",
            "end_date": "2026-03-31",
            "start_time": "09:20",
            "end_time": "15:15",
            "holding_type": "intraday",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "cost_config": {
                "intraday_brokerage_pct": 0.03,
                "intraday_brokerage_flat": 20.0,
            },
            "stop_target_conflict": "stop",
        },
    },

    # ── 10. Multi-stock — all new fields combined ─────────────────────────────
    # Tests everything at once:
    #   • 3 instruments
    #   • Nested AND(condition, OR(condition, condition)) entry
    #   • exit mode = both (condition + SL/TGT)
    #   • CostConfig enabled
    #   • stop_target_conflict = target
    #   • execution_style = same_bar_close
    "10. Multi-Stock — All New Fields Combined": {
        "instruments": ["HDFCBANK", "INFY", "RELIANCE"],
        "chart": {"type": "Candlestick", "interval": "15m"},
        "entry": {
            "side": "BUY",
            "conditions": {
                "logic": "AND",
                "items": [
                    # Must be above VWAP
                    {
                        "lhs": {"type": "PRICE"},
                        "op": "greater_than",
                        "rhs": {"type": "VWAP", "params": {"source": "hlc3", "anchor": "session"}},
                    },
                    # AND either RSI momentum OR MACD cross
                    {
                        "logic": "OR",
                        "items": [
                            {
                                "lhs": {"type": "RSI", "params": {"length": 14}},
                                "op": "crosses_above",
                                "rhs": 50,
                            },
                            {
                                "lhs": {
                                    "type": "MACD",
                                    "params": {
                                        "fast_length": 12,
                                        "slow_length": 26,
                                        "signal_length": 9,
                                    },
                                    "output": "macd_line",
                                },
                                "op": "crosses_above",
                                "rhs": {
                                    "type": "MACD",
                                    "params": {
                                        "fast_length": 12,
                                        "slow_length": 26,
                                        "signal_length": 9,
                                    },
                                    "output": "signal_line",
                                },
                            },
                        ],
                    },
                ],
            },
        },
        "exit": {
            "mode": "both",
            "conditions": [
                {
                    "lhs": {"type": "RSI", "params": {"length": 14}},
                    "op": "crosses_above",
                    "rhs": 70,
                }
            ],
            "stop_loss_pct": 0.5,
            "target_pct": 1.2,
        },
        "execute": {
            "initial_capital": 300000,
            "start_date": "2026-02-01",
            "end_date": "2026-03-31",
            "start_time": "09:20",
            "end_time": "15:15",
            "holding_type": "intraday",
            "exchange": "NSE",
            "instrument_type": "STOCK",
            "execution_style": "same_bar_close",
            "cost_config": {
                "intraday_brokerage_pct": 0.03,
                "intraday_brokerage_flat": 20.0,
            },
            "stop_target_conflict": "target",
        },
    },
}

DEFAULT_STRATEGY_PRESET = "1. RSI Reversal — Positional Daily"
