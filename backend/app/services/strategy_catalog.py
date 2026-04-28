from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

RhsKind = Literal["number", "indicator", "range", "none"]
OperandCategory = Literal["price_level", "oscillator_bounded", "oscillator_unbounded", "volume_level"]

SourceValue = Literal["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "volume"]

OperatorId = Literal[
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
]


@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    kind: Literal["int", "float", "source", "enum", "output"]
    default: int | float | str
    min_value: int | float | None = None
    max_value: int | float | None = None
    choices: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class IndicatorSpec:
    type: str
    label: str
    category: OperandCategory
    params: tuple[ParamSpec, ...]
    outputs: tuple[str, ...] = field(default_factory=tuple)
    default_output: str | None = None
    has_source: bool = False
    multi_output: bool = False


SOURCE_CHOICES_PRICE: tuple[str, ...] = ("open", "high", "low", "close", "hl2", "hlc3", "ohlc4")
SOURCE_CHOICES_PRICE_VOL: tuple[str, ...] = (*SOURCE_CHOICES_PRICE, "volume")

MA_TYPE_CHOICES: tuple[str, ...] = ("SMA", "EMA", "WMA", "DEMA", "TEMA", "TRIMA", "KAMA", "MAMA", "T3")

OFFSET_SPEC = ParamSpec(key="offset", label="Offset", kind="int", default=0, min_value=0, max_value=500)


INDICATOR_CATALOG: dict[str, IndicatorSpec] = {
    "PRICE": IndicatorSpec(
        type="PRICE",
        label="Price",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "VOLUME": IndicatorSpec(
        type="VOLUME",
        label="Volume",
        category="volume_level",
        params=(OFFSET_SPEC,),
    ),
    "RSI": IndicatorSpec(
        type="RSI",
        label="RSI",
        category="oscillator_bounded",
        params=(
            ParamSpec(key="length", label="Length", kind="int", default=14, min_value=2, max_value=500),
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "SMA": IndicatorSpec(
        type="SMA",
        label="SMA",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE_VOL),
            ParamSpec(key="period", label="Period", kind="int", default=9, min_value=1, max_value=500),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "EMA": IndicatorSpec(
        type="EMA",
        label="EMA",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE_VOL),
            ParamSpec(key="period", label="Period", kind="int", default=9, min_value=1, max_value=500),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "WMA": IndicatorSpec(
        type="WMA",
        label="WMA",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE_VOL),
            ParamSpec(key="period", label="Period", kind="int", default=9, min_value=1, max_value=500),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "VWAP": IndicatorSpec(
        type="VWAP",
        label="VWAP",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="hlc3", choices=SOURCE_CHOICES_PRICE),
            ParamSpec(
                key="anchor",
                label="Anchor",
                kind="enum",
                default="session",
                choices=("session", "week", "month"),
            ),
            OFFSET_SPEC,
        ),
        has_source=True,
    ),
    "BB": IndicatorSpec(
        type="BB",
        label="Bollinger Bands",
        category="price_level",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE_VOL),
            ParamSpec(key="length", label="Length", kind="int", default=20, min_value=2, max_value=500),
            ParamSpec(key="std_dev_up", label="StdDev Up", kind="float", default=2.0, min_value=0.1, max_value=10.0),
            ParamSpec(key="std_dev_down", label="StdDev Down", kind="float", default=2.0, min_value=0.1, max_value=10.0),
            ParamSpec(key="ma_type", label="MA Type", kind="enum", default="SMA", choices=MA_TYPE_CHOICES),
            OFFSET_SPEC,
        ),
        outputs=("upper_band", "middle_band", "lower_band"),
        default_output="middle_band",
        has_source=True,
        multi_output=True,
    ),
    "PSAR": IndicatorSpec(
        type="PSAR",
        label="Parabolic SAR",
        category="price_level",
        params=(
            ParamSpec(key="start", label="Start", kind="float", default=0.02, min_value=0.0, max_value=1.5),
            ParamSpec(key="increment", label="Increment", kind="float", default=0.02, min_value=0.0, max_value=1.0),
            ParamSpec(key="max_value", label="Max", kind="float", default=0.2, min_value=0.0, max_value=5.0),
            OFFSET_SPEC,
        ),
    ),
    "MACD": IndicatorSpec(
        type="MACD",
        label="MACD",
        category="oscillator_unbounded",
        params=(
            ParamSpec(key="source", label="Source", kind="source", default="close", choices=SOURCE_CHOICES_PRICE),
            ParamSpec(key="fast_length", label="Fast", kind="int", default=12, min_value=2, max_value=500),
            ParamSpec(key="slow_length", label="Slow", kind="int", default=26, min_value=3, max_value=500),
            ParamSpec(key="signal_length", label="Signal", kind="int", default=9, min_value=1, max_value=500),
            OFFSET_SPEC,
        ),
        outputs=("macd_line", "signal_line", "histogram"),
        default_output="macd_line",
        has_source=True,
        multi_output=True,
    ),
    "STOCH": IndicatorSpec(
        type="STOCH",
        label="Stochastic",
        category="oscillator_bounded",
        params=(
            ParamSpec(key="k_length", label="K Length", kind="int", default=14, min_value=1, max_value=500),
            ParamSpec(key="smooth_k", label="Smooth K", kind="int", default=3, min_value=1, max_value=200),
            ParamSpec(key="d_length", label="D Length", kind="int", default=3, min_value=1, max_value=200),
            ParamSpec(key="k_ma_type", label="K MA", kind="enum", default="SMA", choices=MA_TYPE_CHOICES),
            ParamSpec(key="d_ma_type", label="D MA", kind="enum", default="SMA", choices=MA_TYPE_CHOICES),
            OFFSET_SPEC,
        ),
        outputs=("k_line", "d_line"),
        default_output="k_line",
        multi_output=True,
    ),
    "CCI": IndicatorSpec(
        type="CCI",
        label="CCI",
        category="oscillator_unbounded",
        params=(
            ParamSpec(key="length", label="Length", kind="int", default=20, min_value=2, max_value=500),
            OFFSET_SPEC,
        ),
    ),
    "ADX": IndicatorSpec(
        type="ADX",
        label="ADX",
        category="oscillator_bounded",
        params=(
            ParamSpec(key="length", label="Length", kind="int", default=14, min_value=2, max_value=500),
            OFFSET_SPEC,
        ),
        outputs=("adx_value", "plus_di", "minus_di"),
        default_output="adx_value",
        multi_output=True,
    ),
    "ATR": IndicatorSpec(
        type="ATR",
        label="ATR",
        category="oscillator_unbounded",
        params=(
            ParamSpec(key="length", label="Length", kind="int", default=14, min_value=1, max_value=500),
            OFFSET_SPEC,
        ),
    ),
    "OBV": IndicatorSpec(
        type="OBV",
        label="OBV",
        category="volume_level",
        params=(OFFSET_SPEC,),
    ),
}


OPERATOR_LABELS: dict[OperatorId, str] = {
    "greater_than": ">",
    "less_than": "<",
    "greater_equal": ">=",
    "less_equal": "<=",
    "equal": "=",
    "crosses_above": "crosses above",
    "crosses_below": "crosses below",
    "up_by": "up by",
    "down_by": "down by",
    "within_range": "within range",
}

COMPARISON_OPERATORS: tuple[OperatorId, ...] = (
    "greater_than",
    "less_than",
    "greater_equal",
    "less_equal",
    "equal",
    "crosses_above",
    "crosses_below",
)
DELTA_OPERATORS: tuple[OperatorId, ...] = ("up_by", "down_by")
RANGE_OPERATORS: tuple[OperatorId, ...] = ("within_range",)


def rhs_kind_for(lhs_category: OperandCategory, operator: OperatorId) -> RhsKind:
    if operator in DELTA_OPERATORS:
        return "number"
    if operator in RANGE_OPERATORS:
        return "range"
    return "indicator" if lhs_category in {"price_level", "volume_level"} else "number"


def rhs_indicator_categories_for(lhs_category: OperandCategory) -> tuple[OperandCategory, ...]:
    if lhs_category == "price_level":
        return ("price_level",)
    if lhs_category == "volume_level":
        return ("volume_level",)
    return ()


def operators_for_category(category: OperandCategory) -> tuple[OperatorId, ...]:
    return COMPARISON_OPERATORS + DELTA_OPERATORS + RANGE_OPERATORS


def indicators_for_category(category: OperandCategory) -> list[IndicatorSpec]:
    return [spec for spec in INDICATOR_CATALOG.values() if spec.category == category]


def get_indicator_spec(indicator_type: str) -> IndicatorSpec:
    spec = INDICATOR_CATALOG.get(indicator_type.upper())
    if spec is None:
        raise ValueError(f"Unknown indicator '{indicator_type}'.")
    return spec


def catalog_payload() -> dict:
    """Serialize the catalog for the frontend."""
    return {
        "indicators": [
            {
                "type": spec.type,
                "label": spec.label,
                "category": spec.category,
                "has_source": spec.has_source,
                "multi_output": spec.multi_output,
                "outputs": list(spec.outputs),
                "default_output": spec.default_output,
                "params": [
                    {
                        "key": param.key,
                        "label": param.label,
                        "kind": param.kind,
                        "default": param.default,
                        "min_value": param.min_value,
                        "max_value": param.max_value,
                        "choices": list(param.choices),
                    }
                    for param in spec.params
                ],
            }
            for spec in INDICATOR_CATALOG.values()
        ],
        "operators": [{"id": op, "label": OPERATOR_LABELS[op]} for op in COMPARISON_OPERATORS + DELTA_OPERATORS + RANGE_OPERATORS],
        "rhs_rules": {
            "price_level": {"default_kind": "indicator", "allow_number": True, "indicator_categories": ["price_level"]},
            "volume_level": {"default_kind": "indicator", "allow_number": True, "indicator_categories": ["volume_level"]},
            "oscillator_bounded": {"default_kind": "number", "allow_number": True, "indicator_categories": []},
            "oscillator_unbounded": {"default_kind": "number", "allow_number": True, "indicator_categories": []},
        },
        "delta_operators": list(DELTA_OPERATORS),
        "range_operators": list(RANGE_OPERATORS),
        "comparison_operators": list(COMPARISON_OPERATORS),
    }
