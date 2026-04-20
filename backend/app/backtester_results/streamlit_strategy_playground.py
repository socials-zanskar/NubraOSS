"""
Nubra Strategy Engine — Test Playground
========================================
Run:  streamlit run streamlit_strategy_playground.py

Two tabs:
  🔨 Strategy Builder  — Streak-style visual form builder (no JSON needed)
  📝 JSON Editor + Run — Raw JSON editing, presets, backtest / realtime output
"""
from __future__ import annotations

import json
from typing import Any

import pandas as pd
import streamlit as st

from nubra_backtester import (
    DEFAULT_STRATEGY_PRESET,
    STRATEGY_PRESETS,
    ConditionGroup,
    NubraStrategyEngine,
    Strategy,
)

# ═════════════════════════════════════════════════════════════════════════════
# Builder — constants
# ═════════════════════════════════════════════════════════════════════════════

_B_INDS = [
    "PRICE", "VOLUME", "RSI", "EMA", "SMA", "WMA",
    "MACD", "BB", "STOCH", "VWAP", "CCI", "ADX", "ATR", "OBV", "PSAR",
]
_B_PRICE_SRCS  = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"]
_B_MA_TYPES    = ["SMA", "EMA", "WMA", "DEMA", "TEMA", "TRIMA", "KAMA", "MAMA", "T3"]
_B_ANCHORS     = ["session", "week", "month"]
_B_INTERVALS   = ["1d", "1w", "1mt", "5m", "10m", "15m", "30m", "1h", "1m", "3m"]
_B_OPS = [
    ("crosses_above", "Crosses Above ↗"),
    ("crosses_below", "Crosses Below ↘"),
    ("greater_than",  "Greater Than >"),
    ("less_than",     "Less Than <"),
    ("greater_equal", "Greater or Equal ≥"),
    ("less_equal",    "Less or Equal ≤"),
    ("equal",         "Equal To ="),
    ("up_by",         "Gone Up By (Δ+)"),
    ("down_by",       "Gone Down By (Δ-)"),
    ("within_range",  "Within Range [lo, hi]"),
]
_B_OP_VALS = [o[0] for o in _B_OPS]
_B_OP_MAP  = dict(_B_OPS)

# ═════════════════════════════════════════════════════════════════════════════
# Builder — session state helpers
# ═════════════════════════════════════════════════════════════════════════════

def _bld_new_cid() -> int:
    st.session_state.setdefault("_bld_ctr", 0)
    st.session_state["_bld_ctr"] += 1
    return st.session_state["_bld_ctr"]


def _bld_cond_defaults(cid: int) -> None:
    """Pre-seed all session-state keys for a new condition so widgets show defaults."""
    ss = st.session_state
    p = f"_ec_{cid}"
    # LHS
    ss.setdefault(f"{p}_lhs",      "RSI")
    ss.setdefault(f"{p}_lhs_len",  14)
    ss.setdefault(f"{p}_lhs_per",  9)
    ss.setdefault(f"{p}_lhs_src",  "close")
    ss.setdefault(f"{p}_lhs_fst",  12)
    ss.setdefault(f"{p}_lhs_slw",  26)
    ss.setdefault(f"{p}_lhs_sig",  9)
    ss.setdefault(f"{p}_lhs_bbl",  20)
    ss.setdefault(f"{p}_lhs_stu",  2.0)
    ss.setdefault(f"{p}_lhs_std",  2.0)
    ss.setdefault(f"{p}_lhs_kln",  14)
    ss.setdefault(f"{p}_lhs_skn",  3)
    ss.setdefault(f"{p}_lhs_dln",  3)
    ss.setdefault(f"{p}_lhs_anc",  "session")
    ss.setdefault(f"{p}_lhs_pst",  0.02)
    ss.setdefault(f"{p}_lhs_pnc",  0.02)
    ss.setdefault(f"{p}_lhs_pmx",  0.2)
    ss.setdefault(f"{p}_lhs_macd_out",  "macd_line")
    ss.setdefault(f"{p}_lhs_bb_out",    "middle_band")
    ss.setdefault(f"{p}_lhs_stoch_out", "k_line")
    ss.setdefault(f"{p}_lhs_adx_out",   "adx_value")
    ss.setdefault(f"{p}_lhs_off",  0)
    ss.setdefault(f"{p}_lhs_ivl",  "")
    # Operator + RHS
    ss.setdefault(f"{p}_op",       "crosses_above")
    ss.setdefault(f"{p}_rhs_k",    "number")
    ss.setdefault(f"{p}_rhs_num",  30.0)
    ss.setdefault(f"{p}_rhs_low",  30.0)
    ss.setdefault(f"{p}_rhs_hi",   70.0)
    # RHS indicator
    ss.setdefault(f"{p}_rhs",      "EMA")
    ss.setdefault(f"{p}_rhs_len",  14)
    ss.setdefault(f"{p}_rhs_per",  50)
    ss.setdefault(f"{p}_rhs_src",  "close")
    ss.setdefault(f"{p}_rhs_fst",  12)
    ss.setdefault(f"{p}_rhs_slw",  26)
    ss.setdefault(f"{p}_rhs_sig",  9)
    ss.setdefault(f"{p}_rhs_bbl",  20)
    ss.setdefault(f"{p}_rhs_stu",  2.0)
    ss.setdefault(f"{p}_rhs_std",  2.0)
    ss.setdefault(f"{p}_rhs_kln",  14)
    ss.setdefault(f"{p}_rhs_skn",  3)
    ss.setdefault(f"{p}_rhs_dln",  3)
    ss.setdefault(f"{p}_rhs_anc",  "session")
    ss.setdefault(f"{p}_rhs_pst",  0.02)
    ss.setdefault(f"{p}_rhs_pnc",  0.02)
    ss.setdefault(f"{p}_rhs_pmx",  0.2)
    ss.setdefault(f"{p}_rhs_macd_out",  "macd_line")
    ss.setdefault(f"{p}_rhs_bb_out",    "middle_band")
    ss.setdefault(f"{p}_rhs_stoch_out", "k_line")
    ss.setdefault(f"{p}_rhs_adx_out",   "adx_value")
    ss.setdefault(f"{p}_rhs_off",  0)
    ss.setdefault(f"{p}_rhs_ivl",  "")


def _bld_init() -> None:
    """Initialize all top-level builder session-state keys."""
    ss = st.session_state
    ss.setdefault("_bld_ctr",         0)
    ss.setdefault("_bld_instr",       "HDFCBANK")
    ss.setdefault("_bld_interval",    "1d")
    ss.setdefault("_bld_entry_side",  "BUY")
    ss.setdefault("_bld_entry_logic", "AND")
    ss.setdefault("_bld_entry_cids",  [])
    ss.setdefault("_bld_exit_mode",   "sl_tgt")
    ss.setdefault("_bld_exit_logic",  "AND")
    ss.setdefault("_bld_exit_cids",   [])
    ss.setdefault("_bld_exit_sl",     3.0)
    ss.setdefault("_bld_exit_tgt",    6.0)
    ss.setdefault("_bld_capital",     100000.0)
    ss.setdefault("_bld_start",       "2026-01-01")
    ss.setdefault("_bld_end",         "2026-03-31")
    ss.setdefault("_bld_start_time",  "09:15")
    ss.setdefault("_bld_end_time",    "15:15")
    ss.setdefault("_bld_holding",     "positional")
    ss.setdefault("_bld_exchange",    "NSE")
    ss.setdefault("_bld_instr_type",  "STOCK")
    ss.setdefault("_bld_exec_style",  "same_bar_close")
    ss.setdefault("_bld_conflict",    "stop")
    ss.setdefault("_bld_use_brok",    False)
    ss.setdefault("_bld_intra_pct",   0.03)
    ss.setdefault("_bld_intra_flat",  20.0)

    # Seed one default entry condition on first load
    if not ss["_bld_entry_cids"]:
        cid = _bld_new_cid()
        ss["_bld_entry_cids"].append(cid)
        _bld_cond_defaults(cid)


# ═════════════════════════════════════════════════════════════════════════════
# Builder — indicator selector widget
# ═════════════════════════════════════════════════════════════════════════════

def _render_ind_selector(pfx: str, label: str = "Indicator") -> str:
    """
    Render an indicator type selectbox + its params.
    pfx  — unique key prefix, e.g. "_ec_1_lhs"
    Returns the selected indicator type string.
    """
    ss = st.session_state

    ind = st.selectbox(label, _B_INDS, key=pfx)

    if ind == "PRICE":
        st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")

    elif ind == "VOLUME":
        st.caption("No parameters")

    elif ind == "RSI":
        c1, c2 = st.columns(2)
        with c1: st.number_input("Length", 2, 500, key=f"{pfx}_len")
        with c2: st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")

    elif ind in ("EMA", "SMA", "WMA"):
        c1, c2 = st.columns(2)
        with c1: st.number_input("Period", 1, 500, key=f"{pfx}_per")
        with c2: st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")

    elif ind == "MACD":
        c1, c2, c3 = st.columns(3)
        with c1: st.number_input("Fast", 2, 500, key=f"{pfx}_fst")
        with c2: st.number_input("Slow", 3, 500, key=f"{pfx}_slw")
        with c3: st.number_input("Signal", 1, 500, key=f"{pfx}_sig")
        c4, c5 = st.columns(2)
        with c4: st.selectbox("Output", ["macd_line", "signal_line", "histogram"], key=f"{pfx}_macd_out")
        with c5: st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")

    elif ind == "BB":
        c1, c2, c3 = st.columns(3)
        with c1: st.number_input("Length", 2, 500, key=f"{pfx}_bbl")
        with c2: st.number_input("Std Up", 0.1, 10.0, format="%.1f", key=f"{pfx}_stu")
        with c3: st.number_input("Std Dn", 0.1, 10.0, format="%.1f", key=f"{pfx}_std")
        c4, c5 = st.columns(2)
        with c4: st.selectbox("Output", ["upper_band", "middle_band", "lower_band"], key=f"{pfx}_bb_out")
        with c5: st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")

    elif ind == "STOCH":
        c1, c2, c3 = st.columns(3)
        with c1: st.number_input("K Length", 1, 500, key=f"{pfx}_kln")
        with c2: st.number_input("Smooth K", 1, 200, key=f"{pfx}_skn")
        with c3: st.number_input("D Length", 1, 200, key=f"{pfx}_dln")
        st.selectbox("Output", ["k_line", "d_line"], key=f"{pfx}_stoch_out")

    elif ind == "VWAP":
        c1, c2 = st.columns(2)
        with c1: st.selectbox("Source", _B_PRICE_SRCS, key=f"{pfx}_src")
        with c2: st.selectbox("Anchor", _B_ANCHORS, key=f"{pfx}_anc")

    elif ind == "CCI":
        st.number_input("Length", 2, 500, key=f"{pfx}_len")

    elif ind == "ADX":
        c1, c2 = st.columns(2)
        with c1: st.number_input("Length", 2, 500, key=f"{pfx}_len")
        with c2: st.selectbox("Output", ["adx_value", "plus_di", "minus_di"], key=f"{pfx}_adx_out")

    elif ind == "ATR":
        st.number_input("Length", 1, 500, key=f"{pfx}_len")

    elif ind == "PSAR":
        c1, c2, c3 = st.columns(3)
        with c1: st.number_input("Start", 0.001, 1.5, format="%.3f", key=f"{pfx}_pst")
        with c2: st.number_input("Increment", 0.001, 1.0, format="%.3f", key=f"{pfx}_pnc")
        with c3: st.number_input("Max", 0.001, 5.0, format="%.3f", key=f"{pfx}_pmx")

    elif ind == "OBV":
        st.caption("No parameters")

    # Advanced — offset and cross-timeframe
    with st.expander("⚙ Advanced (offset / cross-timeframe)", expanded=False):
        st.number_input(
            "Offset (bars back)",
            0, 500, key=f"{pfx}_off",
            help="Shift indicator value N bars into the past. 0 = current bar.",
        )
        st.selectbox(
            "Interval override",
            ["(chart interval)"] + _B_INTERVALS,
            key=f"{pfx}_ivl",
            help="Leave as '(chart interval)' unless you want cross-timeframe data.",
        )

    return ind


# ═════════════════════════════════════════════════════════════════════════════
# Builder — JSON builders (session state → dict)
# ═════════════════════════════════════════════════════════════════════════════

def _ind_json(ind_type: str, pfx: str) -> dict:
    """Build IndicatorExpr JSON dict from session-state keys under `pfx`."""
    ss = st.session_state
    d: dict[str, Any] = {"type": ind_type, "params": {}}

    if ind_type == "PRICE":
        d["params"] = {"source": ss.get(f"{pfx}_src", "close")}
    elif ind_type == "VOLUME":
        d["params"] = {}
    elif ind_type == "RSI":
        d["params"] = {"length": int(ss.get(f"{pfx}_len", 14)),
                       "source": ss.get(f"{pfx}_src", "close")}
    elif ind_type in ("EMA", "SMA", "WMA"):
        d["params"] = {"period": int(ss.get(f"{pfx}_per", 9)),
                       "source": ss.get(f"{pfx}_src", "close")}
    elif ind_type == "MACD":
        d["params"] = {"fast_length":   int(ss.get(f"{pfx}_fst", 12)),
                       "slow_length":   int(ss.get(f"{pfx}_slw", 26)),
                       "signal_length": int(ss.get(f"{pfx}_sig", 9)),
                       "source":        ss.get(f"{pfx}_src", "close")}
        d["output"] = ss.get(f"{pfx}_macd_out", "macd_line")
    elif ind_type == "BB":
        d["params"] = {"length":      int(ss.get(f"{pfx}_bbl", 20)),
                       "std_dev_up":  float(ss.get(f"{pfx}_stu", 2.0)),
                       "std_dev_down": float(ss.get(f"{pfx}_std", 2.0)),
                       "source":       ss.get(f"{pfx}_src", "close")}
        d["output"] = ss.get(f"{pfx}_bb_out", "middle_band")
    elif ind_type == "STOCH":
        d["params"] = {"k_length": int(ss.get(f"{pfx}_kln", 14)),
                       "smooth_k": int(ss.get(f"{pfx}_skn", 3)),
                       "d_length": int(ss.get(f"{pfx}_dln", 3))}
        d["output"] = ss.get(f"{pfx}_stoch_out", "k_line")
    elif ind_type == "VWAP":
        d["params"] = {"source": ss.get(f"{pfx}_src", "hlc3"),
                       "anchor": ss.get(f"{pfx}_anc", "session")}
    elif ind_type == "CCI":
        d["params"] = {"length": int(ss.get(f"{pfx}_len", 20))}
    elif ind_type == "ADX":
        d["params"] = {"length": int(ss.get(f"{pfx}_len", 14))}
        d["output"] = ss.get(f"{pfx}_adx_out", "adx_value")
    elif ind_type == "ATR":
        d["params"] = {"length": int(ss.get(f"{pfx}_len", 14))}
    elif ind_type == "PSAR":
        d["params"] = {"start":     float(ss.get(f"{pfx}_pst", 0.02)),
                       "increment": float(ss.get(f"{pfx}_pnc", 0.02)),
                       "max_value": float(ss.get(f"{pfx}_pmx", 0.2))}
    elif ind_type == "OBV":
        d["params"] = {}

    off = int(ss.get(f"{pfx}_off", 0))
    if off > 0:
        d["offset"] = off

    ivl = ss.get(f"{pfx}_ivl", "(chart interval)")
    if ivl and ivl != "(chart interval)":
        d["interval"] = ivl

    return d


def _cond_json(cid: int) -> dict:
    ss = st.session_state
    p  = f"_ec_{cid}"
    lhs_type = ss.get(f"{p}_lhs", "RSI")
    lhs = _ind_json(lhs_type, f"{p}_lhs")
    op  = ss.get(f"{p}_op", "crosses_above")

    if op == "within_range":
        rhs: Any = {"low": float(ss.get(f"{p}_rhs_low", 30.0)),
                    "high": float(ss.get(f"{p}_rhs_hi",  70.0))}
    elif op in ("up_by", "down_by"):
        rhs = float(ss.get(f"{p}_rhs_num", 1.0))
    elif ss.get(f"{p}_rhs_k", "number") == "indicator":
        rhs_type = ss.get(f"{p}_rhs", "EMA")
        rhs = _ind_json(rhs_type, f"{p}_rhs")
    else:
        rhs = float(ss.get(f"{p}_rhs_num", 30.0))

    return {"lhs": lhs, "op": op, "rhs": rhs}


def _group_json(gid_str: str) -> dict:
    gid   = int(gid_str[1:])
    ss    = st.session_state
    logic = ss.get(f"_eg_{gid}_logic", "AND")
    items = [_cond_json(c) for c in ss.get(f"_eg_{gid}_cids", [])]
    return {"logic": logic, "items": items}


def _section_json(section: str, top_logic: str) -> dict:
    ss   = st.session_state
    cids = ss.get(f"_bld_{section}_cids", [])
    items = []
    for cid in cids:
        if isinstance(cid, str) and cid.startswith("g"):
            items.append(_group_json(cid))
        else:
            items.append(_cond_json(cid))
    return {"logic": top_logic, "items": items}


def _build_strategy_json() -> dict:
    ss = st.session_state
    entry_logic = ss.get("_bld_entry_logic", "AND")
    exit_mode   = ss.get("_bld_exit_mode", "sl_tgt")

    exit_d: dict[str, Any] = {"mode": exit_mode}
    if exit_mode in ("condition", "both"):
        exit_logic = ss.get("_bld_exit_logic", "AND")
        exit_d["conditions"] = _section_json("exit", exit_logic)
    if exit_mode in ("sl_tgt", "both"):
        exit_d["stop_loss_pct"] = float(ss.get("_bld_exit_sl",  3.0))
        exit_d["target_pct"]    = float(ss.get("_bld_exit_tgt", 6.0))

    holding = ss.get("_bld_holding", "positional")
    execute: dict[str, Any] = {
        "initial_capital":      float(ss.get("_bld_capital",    100000.0)),
        "start_date":           str(ss.get("_bld_start",        "2026-01-01")),
        "end_date":             str(ss.get("_bld_end",          "2026-03-31")),
        "holding_type":         holding,
        "exchange":             ss.get("_bld_exchange",         "NSE"),
        "instrument_type":      ss.get("_bld_instr_type",       "STOCK"),
        "execution_style":      ss.get("_bld_exec_style",       "same_bar_close"),
        "stop_target_conflict": ss.get("_bld_conflict",         "stop"),
    }
    if holding == "intraday":
        execute["start_time"] = ss.get("_bld_start_time", "09:15")
        execute["end_time"]   = ss.get("_bld_end_time",   "15:15")
    if ss.get("_bld_use_brok", False):
        execute["cost_config"] = {
            "intraday_brokerage_pct":  float(ss.get("_bld_intra_pct",  0.03)),
            "intraday_brokerage_flat": float(ss.get("_bld_intra_flat", 20.0)),
        }

    instruments = [s.strip().upper()
                   for s in ss.get("_bld_instr", "HDFCBANK").split(",")
                   if s.strip()]

    return {
        "instruments": instruments,
        "chart": {
            "type": "Candlestick",
            "interval": ss.get("_bld_interval", "1d"),
        },
        "entry": {
            "side":       ss.get("_bld_entry_side", "BUY"),
            "conditions": _section_json("entry", entry_logic),
        },
        "exit": exit_d,
        "execute": execute,
    }


# ═════════════════════════════════════════════════════════════════════════════
# Builder — condition / group renderers
# ═════════════════════════════════════════════════════════════════════════════

def _render_condition_card(cid: int, section: str, removable: bool = True) -> bool:
    """
    Render one condition card.
    Returns True if the user clicked Remove (caller should remove cid from list).
    """
    ss = st.session_state
    p  = f"_ec_{cid}"
    _bld_cond_defaults(cid)   # no-op if keys already set

    removed = False
    try:
        ctx = st.container(border=True)
    except TypeError:
        ctx = st.container()

    with ctx:
        hdr, rmv_col = st.columns([11, 1])
        with hdr:
            pass
        with rmv_col:
            if removable and st.button("✕", key=f"{p}_rm", help="Remove this condition"):
                removed = True

        lhs_col, op_col, rhs_col = st.columns([4, 3, 4])

        with lhs_col:
            st.markdown("**When**")
            lhs_type = _render_ind_selector(f"{p}_lhs", label="Indicator")

        with op_col:
            st.markdown("**···**")
            op = st.selectbox(
                "Operator",
                _B_OP_VALS,
                format_func=lambda v: _B_OP_MAP.get(v, v),
                key=f"{p}_op",
            )

        with rhs_col:
            st.markdown("**Compared to**")
            if op == "within_range":
                st.caption("Is within range:")
                r1, r2 = st.columns(2)
                with r1: st.number_input("Low",  key=f"{p}_rhs_low")
                with r2: st.number_input("High", key=f"{p}_rhs_hi")

            elif op in ("up_by", "down_by"):
                st.caption("By at least (absolute):")
                st.number_input("Value", key=f"{p}_rhs_num")

            else:
                rhs_kind = st.radio(
                    "RHS type", ["number", "indicator"],
                    horizontal=True, key=f"{p}_rhs_k",
                )
                if rhs_kind == "number":
                    st.number_input("Value", key=f"{p}_rhs_num")
                else:
                    _render_ind_selector(f"{p}_rhs", label="Indicator")

    return removed


def _render_group_card(gid_str: str) -> bool:
    """
    Render a nested condition group card.
    Returns True if the user removed the entire group.
    """
    gid  = int(gid_str[1:])
    ss   = st.session_state
    ss.setdefault(f"_eg_{gid}_logic", "AND")
    ss.setdefault(f"_eg_{gid}_cids",  [])

    removed = False
    try:
        ctx = st.container(border=True)
    except TypeError:
        ctx = st.container()

    with ctx:
        hdr_col, lgc_col, rmv_col = st.columns([5, 4, 1])
        with hdr_col:
            st.markdown("**Condition Group**")
        with lgc_col:
            st.radio("Group logic", ["AND", "OR"], horizontal=True, key=f"_eg_{gid}_logic")
        with rmv_col:
            if st.button("✕", key=f"_eg_{gid}_rm", help="Remove this group"):
                removed = True

        gcids     = list(ss[f"_eg_{gid}_cids"])
        to_remove = None

        for i, gcid in enumerate(gcids):
            if i > 0:
                logic_label = ss.get(f"_eg_{gid}_logic", "AND")
                st.markdown(
                    f"<div style='text-align:center;color:#888;font-size:0.85em;"
                    f"margin:2px 0'>── {logic_label} ──</div>",
                    unsafe_allow_html=True,
                )
            if _render_condition_card(gcid, f"g{gid}", removable=len(gcids) > 1):
                to_remove = gcid

        if to_remove is not None:
            ss[f"_eg_{gid}_cids"].remove(to_remove)
            st.rerun()

        if st.button("+ Add condition to group", key=f"_eg_{gid}_add"):
            new_cid = _bld_new_cid()
            _bld_cond_defaults(new_cid)
            ss[f"_eg_{gid}_cids"].append(new_cid)
            st.rerun()

    return removed


def _render_conditions_section(section: str) -> None:
    """Render the full list of conditions (and groups) for entry or exit."""
    ss    = st.session_state
    cids  = list(ss[f"_bld_{section}_cids"])
    logic = ss.get(f"_bld_{section}_logic", "AND")

    to_remove = None
    for i, cid in enumerate(cids):
        if i > 0:
            st.markdown(
                f"<div style='text-align:center;color:#555;font-weight:bold;"
                f"font-size:0.9em;margin:4px 0'>── {logic} ──</div>",
                unsafe_allow_html=True,
            )
        if isinstance(cid, str) and cid.startswith("g"):
            if _render_group_card(cid):
                to_remove = cid
        else:
            if _render_condition_card(cid, section, removable=len(cids) > 1):
                to_remove = cid

    if to_remove is not None:
        ss[f"_bld_{section}_cids"].remove(to_remove)
        st.rerun()

    b1, b2 = st.columns(2)
    with b1:
        if st.button(f"+ Add Condition", key=f"_bld_{section}_add", use_container_width=True):
            cid = _bld_new_cid()
            _bld_cond_defaults(cid)
            ss[f"_bld_{section}_cids"].append(cid)
            st.rerun()
    with b2:
        if st.button(
            f"+ Add AND/OR Group",
            key=f"_bld_{section}_addg",
            use_container_width=True,
            help="Add a nested group with its own AND/OR logic.",
        ):
            gid    = _bld_new_cid()
            gkey   = f"g{gid}"
            ss[f"_bld_{section}_cids"].append(gkey)
            ss[f"_eg_{gid}_logic"] = "AND"
            first  = _bld_new_cid()
            _bld_cond_defaults(first)
            ss[f"_eg_{gid}_cids"] = [first]
            st.rerun()


# ═════════════════════════════════════════════════════════════════════════════
# Builder — main tab renderer
# ═════════════════════════════════════════════════════════════════════════════

def _render_builder_tab() -> None:
    _bld_init()
    ss = st.session_state

    st.markdown("### Strategy Builder")
    st.caption(
        "Build conditions visually — like Streak. "
        "Click **Build JSON → Load to Editor** when done, then switch to the "
        "📝 JSON Editor tab to run it."
    )

    # ── Instruments & Chart ───────────────────────────────────────────────
    with st.expander("📈 Instruments & Chart", expanded=True):
        c1, c2 = st.columns(2)
        with c1:
            st.text_input(
                "Symbols (comma-separated)",
                key="_bld_instr",
                help="E.g.  HDFCBANK, INFY, RELIANCE",
            )
        with c2:
            st.selectbox("Chart Interval", _B_INTERVALS, key="_bld_interval")

    # ── Entry ─────────────────────────────────────────────────────────────
    with st.expander("🟢 Entry Conditions", expanded=True):
        ec1, ec2 = st.columns(2)
        with ec1:
            st.radio("Entry Side", ["BUY", "SELL"], horizontal=True, key="_bld_entry_side")
        with ec2:
            st.radio(
                "Top-level Logic", ["AND", "OR"],
                horizontal=True, key="_bld_entry_logic",
                help="AND = every condition must be true. OR = any one condition is enough.",
            )
        _render_conditions_section("entry")

    # ── Exit ──────────────────────────────────────────────────────────────
    with st.expander("🔴 Exit Settings", expanded=True):
        exit_mode = st.radio(
            "Exit Mode",
            ["sl_tgt", "condition", "both"],
            format_func={
                "sl_tgt":     "Stop Loss / Target",
                "condition":  "Condition Based",
                "both":       "Both (SL/TGT + Condition)",
            }.__getitem__,
            horizontal=True, key="_bld_exit_mode",
        )

        if exit_mode in ("sl_tgt", "both"):
            x1, x2 = st.columns(2)
            with x1:
                st.number_input("Stop Loss %", 0.01, 100.0, format="%.2f", key="_bld_exit_sl")
            with x2:
                st.number_input("Target %", 0.01, 100.0, format="%.2f", key="_bld_exit_tgt")

        if exit_mode in ("condition", "both"):
            st.radio("Exit Condition Logic", ["AND", "OR"], horizontal=True, key="_bld_exit_logic")
            _render_conditions_section("exit")

    # ── Execution ─────────────────────────────────────────────────────────
    with st.expander("⚙ Execution Settings", expanded=True):
        x1, x2 = st.columns(2)
        with x1:
            st.number_input(
                "Initial Capital (₹)", 1_000.0, 1e9, step=10_000.0, key="_bld_capital"
            )
            st.text_input("Start Date (YYYY-MM-DD)", key="_bld_start")
            st.text_input("End Date   (YYYY-MM-DD)", key="_bld_end")
            st.text_input("Exchange",         key="_bld_exchange")
            st.text_input("Instrument Type",  key="_bld_instr_type")

        with x2:
            holding = st.radio(
                "Holding Type", ["positional", "intraday"],
                horizontal=True, key="_bld_holding",
            )
            if holding == "intraday":
                st.text_input("Session Start Time (HH:MM)", key="_bld_start_time")
                st.text_input("Session End Time   (HH:MM)", key="_bld_end_time")

        st.divider()
        y1, y2 = st.columns(2)
        with y1:
            st.radio(
                "Execution Style",
                ["same_bar_close", "next_bar_open"],
                format_func={
                    "same_bar_close": "Same-bar Close (no lag)",
                    "next_bar_open":  "Next-bar Open (academic)",
                }.__getitem__,
                key="_bld_exec_style",
                help="same_bar_close: signal fires → fill at bar close. next_bar_open: fill at next bar's open.",
            )
        with y2:
            st.radio(
                "Stop/Target Conflict",
                ["stop", "target"],
                format_func={
                    "stop":   "Stop wins (conservative)",
                    "target": "Target wins (optimistic)",
                }.__getitem__,
                key="_bld_conflict",
                help="When both SL and target are hit within the same bar, which exit wins?",
            )

        use_brok = st.checkbox(
            "Enable Brokerage Costs (Zerodha default)",
            key="_bld_use_brok",
        )
        if use_brok:
            bc1, bc2 = st.columns(2)
            with bc1:
                st.number_input(
                    "Intraday brokerage %", 0.0, 10.0,
                    format="%.4f", key="_bld_intra_pct",
                    help="0.03 = Zerodha default",
                )
            with bc2:
                st.number_input(
                    "Intraday flat cap ₹", 0.0, 1000.0,
                    key="_bld_intra_flat",
                    help="₹20 = Zerodha default",
                )

    # ── Build JSON ────────────────────────────────────────────────────────
    st.divider()
    if st.button("📋  Build JSON → Load to Editor", type="primary", use_container_width=True):
        try:
            payload  = _build_strategy_json()
            Strategy.model_validate(payload)           # validate before loading
            st.session_state["strategy_text"] = json.dumps(payload, indent=2)
            st.success(
                "JSON built and loaded to the **📝 JSON Editor** tab. "
                "Switch to that tab and click Run."
            )
            with st.expander("Preview generated JSON", expanded=True):
                st.json(payload)
        except Exception as exc:
            st.error(f"Validation error — fix the strategy and try again:\n\n```\n{exc}\n```")


# ═════════════════════════════════════════════════════════════════════════════
# Editor + Run tab — helpers (unchanged from before)
# ═════════════════════════════════════════════════════════════════════════════

def _r4(value: Any) -> Any:
    if value is None:
        return None
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return value


def _fmt_expr(d: dict | None) -> str:
    if not d or not isinstance(d, dict):
        return str(d)
    parts: list[str] = [d.get("type", "?")]
    params = d.get("params") or {}
    if params:
        parts.append(f"({', '.join(f'{k}={v}' for k, v in params.items())})")
    if d.get("output"):
        parts.append(f".{d['output']}")
    if d.get("offset"):
        parts.append(f"[offset={d['offset']}]")
    if d.get("symbol"):
        parts.append(f" @{d['symbol']}")
    if d.get("interval"):
        parts.append(f" /{d['interval']}")
    return "".join(parts)


def _fmt_rhs(rhs: Any) -> str:
    if rhs is None:
        return "—"
    if isinstance(rhs, (int, float)):
        return str(rhs)
    if isinstance(rhs, dict):
        if "type" in rhs:
            return _fmt_expr(rhs)
        if "low" in rhs and "high" in rhs:
            return f"[{rhs['low']}, {rhs['high']}]"
    return str(rhs)


def _condition_eval_df(evals: list[dict]) -> pd.DataFrame:
    rows = []
    for e in evals:
        rhs_val = e.get("rhs_value")
        rows.append({
            "ok":       "✅" if e.get("matched") else "❌",
            "lhs":      _fmt_expr(e.get("lhs") or {}),
            "op":       e.get("op", ""),
            "rhs":      _fmt_rhs(e.get("rhs")),
            "lhs_val":  _r4(e.get("lhs_value")),
            "rhs_val":  _r4(rhs_val) if isinstance(rhs_val, (int, float)) else str(rhs_val) if rhs_val else None,
            "lhs_prev": _r4(e.get("lhs_previous")),
            "rhs_prev": _r4(e.get("rhs_previous")),
            "note":     e.get("message") or "",
        })
    return pd.DataFrame(rows) if rows else pd.DataFrame()


def _metrics_row(specs: list[tuple[str, Any, str | None]], n_cols: int = 4) -> None:
    cols = st.columns(n_cols)
    for i, (label, value, delta) in enumerate(specs):
        cols[i % n_cols].metric(label, value, delta)


def _feature_flags(strategy: Strategy) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    flags["execution_style"]      = strategy.execute.execution_style.value
    flags["stop_target_conflict"] = strategy.execute.stop_target_conflict.value
    flags["holding_type"]         = strategy.execute.holding_type.value
    flags["n_instruments"]        = len(strategy.instruments)
    flags["brokerage_enabled"]    = strategy.execute.cost_config is not None
    if strategy.execute.cost_config:
        cc = strategy.execute.cost_config
        flags["brokerage_detail"] = (
            f"intraday min({cc.intraday_brokerage_pct}%,₹{cc.intraday_brokerage_flat}) | "
            f"delivery min({cc.delivery_brokerage_pct}%,₹{cc.delivery_brokerage_flat})"
        )

    def _has_sub(group: ConditionGroup) -> bool:
        return any(isinstance(item, ConditionGroup) for item in group.items)

    flags["nested_entry"] = _has_sub(strategy.entry.conditions)
    flags["entry_logic"]  = strategy.entry.conditions.logic
    if strategy.exit.conditions:
        flags["nested_exit"] = _has_sub(strategy.exit.conditions)
    else:
        flags["nested_exit"] = False

    cross = [e for e in strategy.unique_indicator_expressions() if e.interval or e.symbol]
    flags["cross_timeframe"] = len(cross) > 0
    flags["cross_tf_exprs"]  = [_fmt_expr(e.model_dump()) for e in cross]
    flags["operators_used"]  = sorted({c.op.value for c in strategy.all_conditions()})
    return flags


def _render_feature_flags(flags: dict[str, Any]) -> None:
    st.markdown("**Active features:**")
    cols = st.columns(4)

    def _badge(idx: int, label: str, val: str, active: bool) -> None:
        color = "#2e7d32" if active else "#555"
        cols[idx % 4].markdown(
            f"<span style='background:{color};color:#fff;padding:2px 8px;"
            f"border-radius:4px;font-size:0.78em'>{label}</span>&nbsp;"
            f"<code style='font-size:0.78em'>{val}</code>",
            unsafe_allow_html=True,
        )

    _badge(0, "exec style",  flags["execution_style"],     flags["execution_style"] != "same_bar_close")
    _badge(1, "conflict",    flags["stop_target_conflict"], flags["stop_target_conflict"] != "stop")
    _badge(2, "brokerage",   "on" if flags["brokerage_enabled"] else "off", flags["brokerage_enabled"])
    _badge(3, "nested",      "yes" if flags["nested_entry"] else "no",      flags["nested_entry"])

    if flags.get("cross_timeframe"):
        st.info(f"Cross-timeframe indicators: {', '.join(flags['cross_tf_exprs'])}")
    if flags.get("operators_used"):
        st.caption(f"Operators used: {', '.join(flags['operators_used'])}")
    if flags.get("brokerage_detail"):
        st.caption(f"Brokerage: {flags['brokerage_detail']}")


def _render_triggered_day(rd: dict) -> None:
    ts        = str(rd["timestamp"])[:19]
    action    = rd.get("action", "hold")
    entry_sig = rd.get("entry_signal", False)
    exit_sig  = rd.get("exit_signal", False)
    pos       = rd.get("position_state", "flat")
    label = (
        f"🕐 {ts}  │  `{action}`  │  pos: `{pos}`  │  "
        f"entry {'✅' if entry_sig else '❌'}  exit {'✅' if exit_sig else '❌'}"
    )
    with st.expander(label, expanded=False):
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Open",   _r4(rd["open"]))
        c2.metric("High",   _r4(rd["high"]))
        c3.metric("Low",    _r4(rd["low"]))
        c4.metric("Close",  _r4(rd["close"]))
        c5.metric("Volume", _r4(rd.get("volume")) or "—")

        sl  = rd.get("stop_loss_price")
        tgt = rd.get("target_price")
        if sl is not None or tgt is not None:
            sc1, sc2 = st.columns(2)
            sc1.metric("Stop loss", _r4(sl)  if sl  is not None else "—")
            sc2.metric("Target",    _r4(tgt) if tgt is not None else "—")

        iv = rd.get("indicator_values") or {}
        if iv:
            st.markdown("**Indicator values at this bar:**")
            items  = list(iv.items())
            ivcols = st.columns(min(len(items), 5))
            for i, (k, v) in enumerate(items):
                ivcols[i % len(ivcols)].metric(k, _r4(v) if v is not None else "NaN")

        entry_evals = rd.get("entry_conditions") or []
        exit_evals  = rd.get("exit_conditions")  or []
        if entry_evals:
            st.markdown("**Entry condition evaluations** *(short-circuit — only evaluated conditions shown)*:")
            st.dataframe(_condition_eval_df(entry_evals), use_container_width=True, hide_index=True)
        if exit_evals:
            st.markdown("**Exit condition evaluations:**")
            st.dataframe(_condition_eval_df(exit_evals), use_container_width=True, hide_index=True)
        if not entry_evals and not exit_evals:
            st.caption("Triggered by stop/target or session end — no condition evaluations.")


def _build_signal_log_df(rows: list[Any]) -> pd.DataFrame:
    out = []
    for row in rows:
        rd = row.model_dump(mode="json")
        base: dict[str, Any] = {
            "timestamp":      rd["timestamp"],
            "open":           rd["open"],
            "high":           rd["high"],
            "low":            rd["low"],
            "close":          rd["close"],
            "volume":         rd.get("volume"),
            "entry_signal":   rd["entry_signal"],
            "exit_signal":    rd["exit_signal"],
            "action":         rd["action"],
            "position_state": rd["position_state"],
            "stop_loss":      rd.get("stop_loss_price"),
            "target":         rd.get("target_price"),
        }
        for k, v in (rd.get("indicator_values") or {}).items():
            base[f"ind:{k}"] = _r4(v)
        out.append(base)
    df = pd.DataFrame(out)
    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


# ═════════════════════════════════════════════════════════════════════════════
# Main
# ═════════════════════════════════════════════════════════════════════════════

def main() -> None:
    st.set_page_config(page_title="Nubra Strategy Playground", layout="wide")
    st.title("Nubra Strategy Engine — Playground")

    preset_names = list(STRATEGY_PRESETS)
    if "strategy_text" not in st.session_state:
        st.session_state["strategy_text"] = json.dumps(
            STRATEGY_PRESETS[DEFAULT_STRATEGY_PRESET], indent=2
        )

    # ── Top-level tab switch ──────────────────────────────────────────────
    builder_tab, editor_tab = st.tabs(["🔨  Strategy Builder", "📝  JSON Editor + Run"])

    # ═══════════════════════════════════════════════════════════════════════
    # TAB 1 — Builder
    # ═══════════════════════════════════════════════════════════════════════
    with builder_tab:
        _render_builder_tab()

    # ═══════════════════════════════════════════════════════════════════════
    # TAB 2 — JSON Editor + Run
    # ═══════════════════════════════════════════════════════════════════════
    with editor_tab:
        # ── Sidebar ──────────────────────────────────────────────────────
        with st.sidebar:
            st.subheader("Presets")
            preset_name = st.selectbox(
                "Sample strategy", preset_names,
                index=preset_names.index(DEFAULT_STRATEGY_PRESET),
            )
            if st.button("Load preset", use_container_width=True):
                st.session_state["strategy_text"] = json.dumps(
                    STRATEGY_PRESETS[preset_name], indent=2
                )
                st.rerun()

            st.divider()
            st.subheader("SDK")
            env        = st.selectbox("Environment", ["PROD", "UAT"], index=0)
            totp_login = st.checkbox("TOTP login", value=False)
            env_creds  = st.checkbox("Env creds",  value=True)

            st.divider()
            st.subheader("Execution Overrides")
            st.caption("Applied on top of the JSON at run time.")
            override_exec = st.radio(
                "execution_style",
                ["(from JSON)", "same_bar_close", "next_bar_open"],
                index=0, horizontal=True,
            )
            override_conflict = st.radio(
                "stop_target_conflict",
                ["(from JSON)", "stop", "target"],
                index=0, horizontal=True,
            )
            enable_brok_override = st.checkbox("Override brokerage", value=False)
            brok_override: dict | None = None
            if enable_brok_override:
                with st.expander("Brokerage config", expanded=True):
                    intra_pct  = st.number_input("Intraday %",   value=0.03, format="%.4f", step=0.01)
                    intra_flat = st.number_input("Intraday ₹",   value=20.0, step=1.0)
                    deliv_pct  = st.number_input("Delivery %",   value=0.0,  format="%.4f", step=0.01)
                    deliv_flat = st.number_input("Delivery ₹",   value=0.0,  step=1.0)
                    brok_override = {
                        "intraday_brokerage_pct":  intra_pct,
                        "intraday_brokerage_flat": intra_flat,
                        "delivery_brokerage_pct":  deliv_pct,
                        "delivery_brokerage_flat": deliv_flat,
                    }

            st.divider()
            st.subheader("Run Mode")
            action = st.radio("Mode", ["Validate", "Backtest", "Realtime"], index=0)
            as_of  = st.text_input("Realtime as-of (optional)", value="")

            st.divider()
            with st.expander("Indicator Catalog"):
                st.json(NubraStrategyEngine.indicator_catalog())

        # ── JSON editor ───────────────────────────────────────────────────
        strategy_text = st.text_area("Strategy JSON", height=520, key="strategy_text")
        run_clicked   = st.button("▶  Run", type="primary", use_container_width=True)

        if not run_clicked:
            return

        # ── Parse + apply overrides ───────────────────────────────────────
        try:
            payload = json.loads(strategy_text)
        except json.JSONDecodeError as exc:
            st.error(f"Invalid JSON: {exc}")
            return

        execute_block = payload.setdefault("execute", {})
        if override_exec != "(from JSON)":
            execute_block["execution_style"] = override_exec
        if override_conflict != "(from JSON)":
            execute_block["stop_target_conflict"] = override_conflict
        if brok_override is not None:
            execute_block["cost_config"] = brok_override

        try:
            strategy = Strategy.model_validate(payload)
        except Exception as exc:
            st.error(f"**Strategy validation failed:**\n\n```\n{exc}\n```")
            return

        st.success("Strategy JSON is valid.")
        flags = _feature_flags(strategy)
        _render_feature_flags(flags)

        with st.expander("Parsed strategy (normalised)", expanded=False):
            st.json(strategy.model_dump(mode="json"))

        if action == "Validate":
            return

        try:
            engine = NubraStrategyEngine.from_sdk(env=env, totp_login=totp_login, env_creds=env_creds)
        except Exception as exc:
            st.error(f"SDK init failed: {exc}")
            return

        # ── Backtest ──────────────────────────────────────────────────────
        if action == "Backtest":
            with st.spinner("Running backtest…"):
                try:
                    result = engine.backtest(strategy)
                except Exception as exc:
                    st.error(f"Backtest failed:\n\n```\n{exc}\n```")
                    return

            p = result.portfolio
            st.subheader("Portfolio Summary")
            _metrics_row([
                ("Starting capital", f"₹{p.starting_capital:,.0f}", None),
                ("Ending capital",   f"₹{p.ending_capital:,.0f}",   None),
                ("Net P&L",          f"₹{p.net_pnl:,.2f}",          f"{p.return_pct:.2f}%"),
                ("Total trades",     p.total_trades,                 None),
                ("Win / Loss",       f"{p.winning_trades} / {p.losing_trades}", None),
                ("Win rate",         f"{p.win_rate_pct:.1f}%",       None),
                ("Profit factor",    f"{p.profit_factor:.2f}" if p.profit_factor else "N/A", None),
                ("Max drawdown",     f"{p.max_drawdown_pct:.2f}%",   None),
                ("Total brokerage",  f"₹{p.total_brokerage:,.4f}",  None),
            ], n_cols=4)

            if p.equity_curve:
                cdf = pd.DataFrame(
                    [{"timestamp": pt.timestamp, "Portfolio Equity (₹)": pt.equity}
                     for pt in p.equity_curve]
                )
                cdf["timestamp"] = pd.to_datetime(cdf["timestamp"])
                st.line_chart(cdf.set_index("timestamp"), height=240)

            tabs = st.tabs([r.symbol for r in result.instruments]) \
                   if len(result.instruments) > 1 else [st.container()]

            for tab, instr in zip(tabs, result.instruments):
                with tab:
                    m = instr.metrics
                    st.markdown(f"### {instr.symbol}")
                    b1, b2, b3 = st.columns(3)
                    b1.info(f"exec: `{strategy.execute.execution_style.value}`")
                    b2.info(f"conflict: `{strategy.execute.stop_target_conflict.value}`")
                    b3.info(f"brokerage: `{'on' if flags['brokerage_enabled'] else 'off'}`")

                    _metrics_row([
                        ("Starting capital",   f"₹{m.starting_capital:,.0f}",  None),
                        ("Ending capital",     f"₹{m.ending_capital:,.0f}",    None),
                        ("Net P&L",            f"₹{m.net_pnl:,.2f}",           f"{m.return_pct:.2f}%"),
                        ("Gross profit",       f"₹{m.gross_profit:,.2f}",      None),
                        ("Gross loss",         f"₹{m.gross_loss:,.2f}",        None),
                        ("Total trades",       m.total_trades,                  None),
                        ("Win / Loss",         f"{m.winning_trades} / {m.losing_trades}", None),
                        ("Win rate",           f"{m.win_rate_pct:.1f}%",        None),
                        ("Avg P&L / trade",    f"₹{m.avg_pnl:,.2f}",           f"{m.avg_pnl_pct:.2f}%"),
                        ("Profit factor",      f"{m.profit_factor:.2f}" if m.profit_factor else "N/A", None),
                        ("Max drawdown",       f"{m.max_drawdown_pct:.2f}%",    None),
                        ("Total brokerage",    f"₹{m.total_brokerage:,.4f}",   None),
                    ], n_cols=4)

                    st.caption(
                        f"Data: **{str(instr.fetched_start)[:19]}** → **{str(instr.fetched_end)[:19]}**  "
                        f"(req {str(instr.requested_start)[:10]} → {str(instr.requested_end)[:10]})  |  "
                        f"{instr.bars_processed} bars  |  "
                        f"warmup {instr.warmup_rows_available}/{instr.warmup_bars_required}  |  "
                        f"{instr.fetch_attempts} fetch(es)"
                    )

                    inner = st.tabs(["Trades", "Equity Curve", "Triggered Days",
                                     "Full Signal Log", "Final Indicators"])

                    with inner[0]:
                        if not instr.trades:
                            st.info("No trades generated.")
                        else:
                            rows = []
                            for t in instr.trades:
                                rows.append({
                                    "entry_time":  str(t.entry_timestamp)[:19],
                                    "exit_time":   str(t.exit_timestamp)[:19],
                                    "side":        t.side.value,
                                    "entry_price": _r4(t.entry_price),
                                    "exit_price":  _r4(t.exit_price),
                                    "qty":         _r4(t.quantity),
                                    "raw_pnl":     round(t.pnl + t.brokerage, 2),
                                    "brokerage":   round(t.brokerage, 4),
                                    "net_pnl":     round(t.pnl, 2),
                                    "pnl_%":       round(t.pnl_pct, 4),
                                    "bars_held":   t.bars_held,
                                    "exit_reason": t.exit_reason,
                                })
                            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
                            st.caption(
                                "raw_pnl = gross before brokerage  •  "
                                "brokerage = round-trip (entry + exit order)  •  "
                                "bars_held=0 = same-bar fill"
                            )

                    with inner[1]:
                        if instr.equity_curve:
                            eq = pd.DataFrame(
                                [{"timestamp": pt.timestamp, "Equity (₹)": pt.equity}
                                 for pt in instr.equity_curve]
                            )
                            eq["timestamp"] = pd.to_datetime(eq["timestamp"])
                            st.line_chart(eq.set_index("timestamp"), height=320)

                    with inner[2]:
                        if not instr.triggered_days:
                            st.info("No triggered days.")
                        else:
                            st.caption(
                                f"{len(instr.triggered_days)} triggered bar(s). "
                                "Short-circuit: only evaluated conditions appear."
                            )
                            for row in instr.triggered_days:
                                _render_triggered_day(row.model_dump(mode="json"))

                    with inner[3]:
                        log_df = _build_signal_log_df(instr.daily_signal_log)
                        if log_df.empty:
                            st.info("No signal log.")
                        else:
                            ca, cb = st.columns([2, 1])
                            with ca:
                                only_trig = st.checkbox(
                                    f"Show only triggered rows ({instr.symbol})", value=False
                                )
                            with cb:
                                st.caption(f"{len(log_df)} total bars")
                            disp = log_df[log_df["action"] != "hold"] if only_trig else log_df
                            st.dataframe(disp, use_container_width=True, height=420, hide_index=True)
                            st.caption("ind: columns = indicator value at that bar")

                    with inner[4]:
                        fiv = instr.final_indicator_values
                        if fiv:
                            st.dataframe(
                                pd.DataFrame([{"indicator": k, "value": v} for k, v in fiv.items()]),
                                use_container_width=True, hide_index=True,
                            )

        # ── Realtime ──────────────────────────────────────────────────────
        else:
            with st.spinner("Running realtime evaluation…"):
                try:
                    result = engine.evaluate_realtime(strategy, as_of=as_of or None)
                except Exception as exc:
                    st.error(f"Realtime failed:\n\n```\n{exc}\n```")
                    return

            st.subheader("Realtime Signal")
            for instr in result.instruments:
                rd = instr.model_dump(mode="json")
                st.markdown(f"### {instr.symbol}")

                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Last price",        _r4(rd["last_price"]))
                c2.metric("As of",             str(rd["as_of"])[:19])
                c3.metric("If flat →",         rd["action_if_flat"],        delta_color="off")
                c4.metric("If in position →",  rd["action_if_in_position"], delta_color="off")

                f1, f2, f3 = st.columns(3)
                f1.info(f"Entry signal: {'✅' if rd['entry_signal'] else '❌'}")
                f2.info(f"Exit signal:  {'✅' if rd['exit_signal']  else '❌'}")
                f3.info(f"Session allows entry: {'✅' if rd['session_allows_entry'] else '❌'}")

                sl  = rd.get("suggested_stop_loss_price")
                tgt = rd.get("suggested_target_price")
                if sl is not None or tgt is not None:
                    s1, s2 = st.columns(2)
                    s1.metric("Suggested stop",   _r4(sl)  if sl  is not None else "—")
                    s2.metric("Suggested target", _r4(tgt) if tgt is not None else "—")

                fiv = rd.get("final_indicator_values") or {}
                if fiv:
                    st.markdown("**Indicator values:**")
                    fitems = list(fiv.items())
                    fivc   = st.columns(min(len(fitems), 5))
                    for i, (k, v) in enumerate(fitems):
                        fivc[i % len(fivc)].metric(k, _r4(v) if v is not None else "NaN")

                rt1, rt2 = st.tabs(["Entry conditions", "Exit conditions"])
                with rt1:
                    entry_evals = rd.get("entry_conditions") or []
                    if entry_evals:
                        st.caption("Short-circuit — only evaluated conditions shown.")
                        st.dataframe(_condition_eval_df(entry_evals), use_container_width=True, hide_index=True)
                    else:
                        st.info("No entry condition evaluations.")
                with rt2:
                    exit_evals = rd.get("exit_conditions") or []
                    if exit_evals:
                        st.dataframe(_condition_eval_df(exit_evals), use_container_width=True, hide_index=True)
                    else:
                        st.info("No exit condition evaluations.")

                st.caption(f"Data: {str(rd['fetched_start'])[:19]} → {str(rd['fetched_end'])[:19]}")
                st.divider()


if __name__ == "__main__":
    main()
