from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import pandas as pd
from fastapi import HTTPException

from app.services.strategy_catalog import (
    DELTA_OPERATORS,
    OperatorId,
    RANGE_OPERATORS,
)
from app.services.strategy_data import IndicatorExpr, column_name_for


@dataclass(frozen=True)
class NumberOperand:
    value: float


@dataclass(frozen=True)
class RangeOperand:
    low: float
    high: float


Operand = IndicatorExpr | NumberOperand | RangeOperand


@dataclass(frozen=True)
class Condition:
    lhs: IndicatorExpr
    operator: OperatorId
    rhs: Operand


@dataclass(frozen=True)
class ConditionGroup:
    """Represents a nested AND/OR group of Conditions or sub-groups."""

    logic: str  # "AND" or "OR"
    items: list  # list[Condition | ConditionGroup]


# ConditionNode is either a leaf Condition or a ConditionGroup
ConditionNode = Condition | ConditionGroup


def parse_condition(payload: dict[str, Any]) -> Condition:
    lhs_payload = payload.get("lhs")
    if not isinstance(lhs_payload, dict):
        raise HTTPException(status_code=400, detail="Condition lhs must be an indicator object.")
    lhs = IndicatorExpr.from_dict(lhs_payload)

    # Support both "operator" (old key) and "op" (new engine key)
    operator_raw = payload.get("op") or payload.get("operator") or ""
    operator = str(operator_raw).lower()
    if operator not in {
        "greater_than",
        "less_than",
        "greater_equal",
        "less_equal",
        "equal",
        "crosses_above",
        "crosses_below",
        "up_by",
        "down_by",
        "within_range",
    }:
        raise HTTPException(status_code=400, detail=f"Unknown operator '{operator}'.")

    rhs_payload = payload.get("rhs")
    if operator in RANGE_OPERATORS:
        if not isinstance(rhs_payload, dict) or "low" not in rhs_payload or "high" not in rhs_payload:
            raise HTTPException(status_code=400, detail="within_range requires rhs={low, high}.")
        rhs: Operand = RangeOperand(low=float(rhs_payload["low"]), high=float(rhs_payload["high"]))
    elif operator in DELTA_OPERATORS:
        rhs = NumberOperand(value=_coerce_number(rhs_payload))
    else:
        rhs = _parse_indicator_or_number(rhs_payload, lhs)

    return Condition(lhs=lhs, operator=operator, rhs=rhs)  # type: ignore[arg-type]


def parse_condition_node(payload: Any) -> ConditionNode:
    """
    Parse either a leaf Condition dict or a ConditionGroup dict.

    A ConditionGroup has:  { "logic": "AND"|"OR", "items": [...] }
    A leaf Condition has:  { "lhs": ..., "op"|"operator": ..., "rhs": ... }

    Also accepts a flat list[Condition] as a backward-compat AND group.
    """
    if isinstance(payload, list):
        # Backward compat: flat list → AND group
        items = [parse_condition_node(item) for item in payload]
        return ConditionGroup(logic="AND", items=items)

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail=f"Invalid condition node: expected dict, got {type(payload).__name__}.")

    if "logic" in payload and "items" in payload:
        # It's a ConditionGroup
        logic_raw = str(payload["logic"]).upper()
        if logic_raw not in {"AND", "OR"}:
            raise HTTPException(status_code=400, detail=f"ConditionGroup logic must be 'AND' or 'OR', got '{logic_raw}'.")
        items_raw = payload.get("items") or []
        if not isinstance(items_raw, list):
            raise HTTPException(status_code=400, detail="ConditionGroup.items must be a list.")
        items = [parse_condition_node(item) for item in items_raw]
        return ConditionGroup(logic=logic_raw, items=items)

    # leaf Condition
    return parse_condition(payload)


def _rhs_indicator_family(expr: IndicatorExpr) -> str:
    indicator_type = expr.type.upper()
    source = str(expr.params_dict.get("source", "close")).lower()
    output = expr.output or ""

    if indicator_type in {"VOLUME", "OBV"}:
        return "volume"
    if indicator_type in {"SMA", "EMA", "WMA"} and source == "volume":
        return "volume"

    if indicator_type in {"PRICE", "SMA", "EMA", "WMA", "VWAP", "BB", "PSAR"}:
        return "price"

    if indicator_type == "MACD":
        return "macd"
    if indicator_type == "STOCH":
        return "stoch"
    if indicator_type == "ADX" and output in {"plus_di", "minus_di"}:
        return "adx_pair"

    return "number_only"


def _parse_indicator_or_number(rhs_payload: Any, lhs: IndicatorExpr) -> Operand:
    if isinstance(rhs_payload, dict) and rhs_payload.get("type"):
        expr = IndicatorExpr.from_dict(rhs_payload)
        lhs_family = _rhs_indicator_family(lhs)
        rhs_family = _rhs_indicator_family(expr)

        if lhs_family == "number_only":
            raise HTTPException(status_code=400, detail=f"RHS for {lhs.type} must be a number, not an indicator.")
        if lhs_family == "price" and rhs_family != "price":
            raise HTTPException(status_code=400, detail=f"RHS indicator must be price-like when LHS is {lhs.type}.")
        if lhs_family == "volume" and rhs_family != "volume":
            raise HTTPException(status_code=400, detail=f"RHS indicator must be volume-like when LHS is {lhs.type}.")
        if lhs_family == "macd" and expr.type.upper() != "MACD":
            raise HTTPException(status_code=400, detail="MACD conditions can only compare against another MACD output or a number.")
        if lhs_family == "stoch" and expr.type.upper() != "STOCH":
            raise HTTPException(status_code=400, detail="Stochastic conditions can only compare against another STOCH output or a number.")
        if lhs_family == "adx_pair":
            if expr.type.upper() != "ADX" or (expr.output or "") not in {"plus_di", "minus_di"}:
                raise HTTPException(status_code=400, detail="ADX +/-DI conditions can only compare against another ADX DI output or a number.")
        return expr
    return NumberOperand(value=_coerce_number(rhs_payload))


def _coerce_number(value: Any) -> float:
    if isinstance(value, dict) and "value" in value:
        value = value["value"]
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Cannot interpret '{value}' as a number.") from exc


def iter_expressions(conditions: Iterable[Condition]) -> list[IndicatorExpr]:
    """Collect all IndicatorExpr references from a flat list of Conditions (legacy path)."""
    out: list[IndicatorExpr] = []
    for cond in conditions:
        out.append(cond.lhs)
        if isinstance(cond.rhs, IndicatorExpr):
            out.append(cond.rhs)
    return out


def iter_expressions_from_node(node: ConditionNode) -> list[IndicatorExpr]:
    """Recursively collect all IndicatorExpr references from a ConditionGroup tree."""
    out: list[IndicatorExpr] = []
    if isinstance(node, Condition):
        out.append(node.lhs)
        if isinstance(node.rhs, IndicatorExpr):
            out.append(node.rhs)
    else:
        for item in node.items:
            out.extend(iter_expressions_from_node(item))
    return out


# -------------------------------------------------------------------------
# Evaluation
# -------------------------------------------------------------------------


def _value_at(df: pd.DataFrame, index: int, expr: IndicatorExpr) -> float | None:
    column = column_name_for(expr)
    target_index = index - int(expr.offset)
    if target_index < 0 or target_index >= len(df):
        return None
    value = df[column].iloc[target_index]
    if pd.isna(value):
        return None
    return float(value)


def _operand_value(df: pd.DataFrame, index: int, operand: Operand) -> float | None:
    if isinstance(operand, IndicatorExpr):
        return _value_at(df, index, operand)
    if isinstance(operand, NumberOperand):
        return operand.value
    return None


def evaluate_condition(df: pd.DataFrame, index: int, condition: Condition) -> bool:
    if index < 0 or index >= len(df):
        return False

    lhs_now = _value_at(df, index, condition.lhs)
    if lhs_now is None:
        return False

    op = condition.operator

    if op == "within_range" and isinstance(condition.rhs, RangeOperand):
        return condition.rhs.low <= lhs_now <= condition.rhs.high

    if op in DELTA_OPERATORS and isinstance(condition.rhs, NumberOperand):
        if index - 1 - int(condition.lhs.offset) < 0:
            return False
        column = column_name_for(condition.lhs)
        prev_index = index - 1 - int(condition.lhs.offset)
        if prev_index < 0 or prev_index >= len(df):
            return False
        prev_raw = df[column].iloc[prev_index]
        if pd.isna(prev_raw):
            return False
        delta = lhs_now - float(prev_raw)
        if op == "up_by":
            return delta >= condition.rhs.value
        return (-delta) >= condition.rhs.value

    rhs_now = _operand_value(df, index, condition.rhs)
    if rhs_now is None:
        return False

    if op == "greater_than":
        return lhs_now > rhs_now
    if op == "less_than":
        return lhs_now < rhs_now
    if op == "greater_equal":
        return lhs_now >= rhs_now
    if op == "less_equal":
        return lhs_now <= rhs_now
    if op == "equal":
        return abs(lhs_now - rhs_now) < 1e-9
    if op in {"crosses_above", "crosses_below"}:
        if index == 0:
            return False
        lhs_prev = _value_at(df, index - 1, condition.lhs)
        rhs_prev = _operand_value(df, index - 1, condition.rhs)
        if lhs_prev is None or rhs_prev is None:
            return False
        if op == "crosses_above":
            return lhs_prev <= rhs_prev and lhs_now > rhs_now
        return lhs_prev >= rhs_prev and lhs_now < rhs_now

    return False


def evaluate_node(df: pd.DataFrame, index: int, node: ConditionNode) -> bool:
    """Evaluate a ConditionNode (Condition or ConditionGroup) with short-circuit logic."""
    if isinstance(node, Condition):
        return evaluate_condition(df, index, node)

    # ConditionGroup
    if node.logic == "AND":
        for item in node.items:
            if not evaluate_node(df, index, item):
                return False
        return len(node.items) > 0

    # OR
    for item in node.items:
        if evaluate_node(df, index, item):
            return True
    return False


def evaluate_all(df: pd.DataFrame, index: int, conditions: Iterable[Condition]) -> bool:
    """Legacy flat-list AND evaluation — used by live strategy service."""
    result = True
    has_any = False
    for condition in conditions:
        has_any = True
        if not evaluate_condition(df, index, condition):
            return False
    return has_any and result
