from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha1
from typing import Any, Mapping


PRICE_SOURCES = ("open", "high", "low", "close", "hl2", "hlc3", "ohlc4")
PRICE_OR_VOLUME_SOURCES = PRICE_SOURCES + ("volume",)
VWAP_ANCHORS = ("session", "week", "month")
MA_TYPES = ("SMA", "EMA", "WMA", "DEMA", "TEMA", "TRIMA", "KAMA", "MAMA", "T3")

COMPARISON_OPERATORS = (
    "greater_than",
    "less_than",
    "greater_equal",
    "less_equal",
    "equal",
)
CROSS_OPERATORS = ("crosses_above", "crosses_below")
DELTA_OPERATORS = ("up_by", "down_by")
RANGE_OPERATORS = ("within_range",)
PREVIOUS_BAR_OPERATORS = set(CROSS_OPERATORS + DELTA_OPERATORS)
ALL_OPERATORS = COMPARISON_OPERATORS + CROSS_OPERATORS + DELTA_OPERATORS + RANGE_OPERATORS

PRICE_LEVEL_TYPES = {"PRICE", "SMA", "EMA", "WMA", "VWAP", "PSAR", "BB"}
VOLUME_LEVEL_TYPES = {"VOLUME", "OBV"}

MA_TYPE_TO_INT = {name: index for index, name in enumerate(MA_TYPES)}

OUTPUT_OPTIONS: dict[str, tuple[str, ...]] = {
    "BB": ("upper_band", "middle_band", "lower_band"),
    "MACD": ("macd_line", "signal_line", "histogram"),
    "STOCH": ("k_line", "d_line"),
    "ADX": ("adx_value", "plus_di", "minus_di"),
}

DEFAULT_OUTPUTS: dict[str, str] = {
    "BB": "middle_band",
    "MACD": "macd_line",
    "STOCH": "k_line",
    "ADX": "adx_value",
}

OUTPUT_COLUMN_SUFFIXES: dict[str, dict[str, str]] = {
    "BB": {
        "upper_band": "bbands_upperband",
        "middle_band": "bbands_middleband",
        "lower_band": "bbands_lowerband",
    },
    "MACD": {
        "macd_line": "macd_macd",
        "signal_line": "macd_macdsignal",
        "histogram": "macd_macdhist",
    },
    "STOCH": {
        "k_line": "stoch_slowk",
        "d_line": "stoch_slowd",
    },
    "ADX": {
        "adx_value": "adx",
        "plus_di": "plus_di",
        "minus_di": "minus_di",
    },
}

INDICATOR_PARAMETER_CATALOG: dict[str, dict[str, Any]] = {
    "PRICE": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_SOURCES)},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "VOLUME": {
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "RSI": {
        "length": {"type": "integer", "default": 14, "min": 2, "max": 500},
        "source": {"type": "string", "default": "close", "options": list(PRICE_SOURCES)},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "SMA": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_OR_VOLUME_SOURCES)},
        "period": {"type": "integer", "default": 9, "min": 1, "max": 500},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "EMA": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_OR_VOLUME_SOURCES)},
        "period": {"type": "integer", "default": 9, "min": 1, "max": 500},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "WMA": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_OR_VOLUME_SOURCES)},
        "period": {"type": "integer", "default": 9, "min": 1, "max": 500},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "VWAP": {
        "source": {"type": "string", "default": "hlc3", "options": list(PRICE_SOURCES)},
        "anchor": {"type": "string", "default": "session", "options": list(VWAP_ANCHORS)},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "BB": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_OR_VOLUME_SOURCES)},
        "length": {"type": "integer", "default": 20, "min": 2, "max": 500},
        "std_dev_up": {"type": "float", "default": 2.0, "min": 0.1, "max": 10.0},
        "std_dev_down": {"type": "float", "default": 2.0, "min": 0.1, "max": 10.0},
        "ma_type": {"type": "string", "default": "SMA", "options": list(MA_TYPES)},
        "output": {"type": "string", "default": "middle_band", "options": list(OUTPUT_OPTIONS["BB"])},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "PSAR": {
        "start": {"type": "float", "default": 0.02, "min": 0.0, "max": 1.5},
        "increment": {"type": "float", "default": 0.02, "min": 0.0, "max": 1.0},
        "max_value": {"type": "float", "default": 0.2, "min": 0.0, "max": 5.0},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "MACD": {
        "source": {"type": "string", "default": "close", "options": list(PRICE_SOURCES)},
        "fast_length": {"type": "integer", "default": 12, "min": 2, "max": 500},
        "slow_length": {"type": "integer", "default": 26, "min": 3, "max": 500},
        "signal_length": {"type": "integer", "default": 9, "min": 1, "max": 500},
        "output": {"type": "string", "default": "macd_line", "options": list(OUTPUT_OPTIONS["MACD"])},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "STOCH": {
        "k_length": {"type": "integer", "default": 14, "min": 1, "max": 500},
        "smooth_k": {"type": "integer", "default": 3, "min": 1, "max": 200},
        "d_length": {"type": "integer", "default": 3, "min": 1, "max": 200},
        "k_ma_type": {"type": "string", "default": "SMA", "options": list(MA_TYPES)},
        "d_ma_type": {"type": "string", "default": "SMA", "options": list(MA_TYPES)},
        "output": {"type": "string", "default": "k_line", "options": list(OUTPUT_OPTIONS["STOCH"])},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "CCI": {
        "length": {"type": "integer", "default": 20, "min": 2, "max": 500},
        "source": {"type": "string", "default": "hlc3", "const": "hlc3"},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "ADX": {
        "length": {"type": "integer", "default": 14, "min": 2, "max": 500},
        "output": {"type": "string", "default": "adx_value", "options": list(OUTPUT_OPTIONS["ADX"])},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "ATR": {
        "length": {"type": "integer", "default": 14, "min": 1, "max": 500},
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
    "OBV": {
        "offset": {"type": "integer", "default": 0, "min": 0, "max": 500},
    },
}


@dataclass(frozen=True)
class ResolvedIndicator:
    indicator_type: str
    output: str | None
    offset: int
    params: dict[str, Any]
    function_name: str
    function_params: dict[str, Any]
    raw_column: str | None
    custom_kind: str | None
    category: str
    signature: str


def normalize_indicator_type(value: Any) -> str:
    indicator_type = str(value or "").strip().upper()
    if indicator_type not in INDICATOR_PARAMETER_CATALOG:
        raise ValueError(f"Unsupported indicator type '{value}'.")
    return indicator_type


def normalize_output(indicator_type: Any, output: Any = None) -> str | None:
    normalized_type = normalize_indicator_type(indicator_type)
    options = OUTPUT_OPTIONS.get(normalized_type)
    if not options:
        return None

    if output is None or str(output).strip() == "":
        return DEFAULT_OUTPUTS[normalized_type]

    normalized_output = str(output).strip().lower()
    if normalized_output not in options:
        raise ValueError(
            f"Unsupported output '{output}' for {normalized_type}. Expected one of {', '.join(options)}."
        )
    return normalized_output


def indicator_category(indicator_type: Any, output: Any = None) -> str:
    normalized_type = normalize_indicator_type(indicator_type)
    normalized_output = normalize_output(normalized_type, output)

    if normalized_type in PRICE_LEVEL_TYPES:
        return "price_level"
    if normalized_type in VOLUME_LEVEL_TYPES:
        return "volume_level"
    if normalized_type in {"RSI", "STOCH"}:
        return "oscillator_bounded"
    if normalized_type == "ADX":
        if normalized_output in {"adx_value", "plus_di", "minus_di"}:
            return "oscillator_bounded"
    if normalized_type in {"MACD", "CCI", "ATR"}:
        return "oscillator_unbounded"
    raise ValueError(f"Unable to determine category for {normalized_type}.")


def condition_capabilities(indicator_type: Any, output: Any = None) -> dict[str, Any]:
    normalized_type = normalize_indicator_type(indicator_type)
    normalized_output = normalize_output(normalized_type, output)
    category = indicator_category(normalized_type, normalized_output)

    allowed_rhs: dict[str, Any] = {"number": True, "range": True, "indicator_categories": [], "indicator_types": []}
    bounded_range: tuple[float, float] | None = None
    operators = list(ALL_OPERATORS)

    if normalized_type in PRICE_LEVEL_TYPES:
        allowed_rhs["indicator_categories"] = ["price_level"]
    elif normalized_type == "RSI":
        bounded_range = (0.0, 100.0)
    elif normalized_type == "STOCH":
        bounded_range = (0.0, 100.0)
        allowed_rhs["indicator_types"] = ["STOCH"]
    elif normalized_type == "ADX":
        bounded_range = (0.0, 100.0)
        if normalized_output in {"plus_di", "minus_di"}:
            allowed_rhs["indicator_types"] = ["ADX"]
    elif normalized_type in {"MACD"}:
        allowed_rhs["indicator_types"] = ["MACD"]
    elif normalized_type in {"CCI", "ATR"}:
        pass
    elif normalized_type in VOLUME_LEVEL_TYPES:
        allowed_rhs["indicator_categories"] = ["volume_level"]

    return {
        "type": normalized_type,
        "category": category,
        "outputs": list(OUTPUT_OPTIONS.get(normalized_type, ())),
        "default_output": DEFAULT_OUTPUTS.get(normalized_type),
        "allowed_rhs": allowed_rhs,
        "allowed_operators": operators,
        "bounded_range": bounded_range,
        "parameters": INDICATOR_PARAMETER_CATALOG[normalized_type],
    }


def validate_condition_contract(
    *,
    lhs_type: Any,
    lhs_output: Any,
    operator: str,
    rhs: Any,
) -> None:
    capabilities = condition_capabilities(lhs_type, lhs_output)
    normalized_operator = str(operator or "").strip().lower()
    if normalized_operator not in capabilities["allowed_operators"]:
        raise ValueError(
            f"{capabilities['type']} does not support operator '{operator}'. "
            f"Expected one of {', '.join(capabilities['allowed_operators'])}."
        )

    rhs_kind = _detect_rhs_kind(rhs)
    allowed_rhs = capabilities["allowed_rhs"]
    bounded_range = capabilities["bounded_range"]

    if normalized_operator == "within_range":
        if rhs_kind != "range":
            raise ValueError("Operator 'within_range' requires rhs to be an object with 'low' and 'high'.")
        if bounded_range is not None:
            _validate_numeric_bounds(rhs.low, bounded_range, capabilities["type"])
            _validate_numeric_bounds(rhs.high, bounded_range, capabilities["type"])
        return

    if normalized_operator in DELTA_OPERATORS:
        if rhs_kind != "number":
            raise ValueError(f"Operator '{normalized_operator}' requires rhs to be a numeric threshold.")
        return

    if rhs_kind == "indicator":
        rhs_type = normalize_indicator_type(getattr(rhs, "type", None))
        rhs_output = normalize_output(rhs_type, getattr(rhs, "output", None))
        rhs_category = indicator_category(rhs_type, rhs_output)

        if rhs_type in allowed_rhs["indicator_types"]:
            return
        if rhs_category in allowed_rhs["indicator_categories"]:
            return

        allowed_descriptions = allowed_rhs["indicator_types"] + allowed_rhs["indicator_categories"]
        if not allowed_descriptions:
            raise ValueError(
                f"{capabilities['type']} can only compare against numeric values, not another indicator."
            )
        raise ValueError(
            f"{capabilities['type']} cannot compare against {rhs_type}. "
            f"Allowed indicator rhs: {', '.join(allowed_descriptions)}."
        )

    if rhs_kind == "number":
        if not allowed_rhs["number"]:
            raise ValueError(f"{capabilities['type']} does not accept numeric rhs values.")
        if bounded_range is not None:
            _validate_numeric_bounds(float(rhs), bounded_range, capabilities["type"])
        return

    if rhs_kind == "range":
        raise ValueError("Range rhs is only valid with operator 'within_range'.")

    raise ValueError("rhs must be either another indicator, a number, or a {low, high} range.")


def resolve_indicator(
    indicator_type: Any,
    params: Mapping[str, Any] | None = None,
    *,
    output: Any = None,
    offset: int = 0,
) -> ResolvedIndicator:
    normalized_type = normalize_indicator_type(indicator_type)
    normalized_output = normalize_output(normalized_type, output)
    clean_params = dict(params or {})

    if "offset" in clean_params and not offset:
        offset = int(clean_params.pop("offset"))
    else:
        clean_params.pop("offset", None)

    if "output" in clean_params and normalized_output is None:
        normalized_output = normalize_output(normalized_type, clean_params.pop("output"))
    else:
        clean_params.pop("output", None)

    if offset < 0:
        raise ValueError("Indicator offset must be greater than or equal to 0.")

    category = indicator_category(normalized_type, normalized_output)
    signature = indicator_signature(
        indicator_type=normalized_type,
        params=clean_params,
        output=normalized_output,
        offset=offset,
    )

    if normalized_type == "PRICE":
        source = _normalize_source(clean_params.get("source", "close"), allow_volume=False)
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"source": source},
            function_name="PRICE",
            function_params={"source": source},
            raw_column=None,
            custom_kind="price",
            category=category,
            signature=signature,
        )

    if normalized_type == "VOLUME":
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={},
            function_name="VOLUME",
            function_params={},
            raw_column=None,
            custom_kind="volume",
            category=category,
            signature=signature,
        )

    if normalized_type == "VWAP":
        source = _normalize_source(clean_params.get("source", "hlc3"), allow_volume=False)
        anchor = str(clean_params.get("anchor", "session")).strip().lower()
        if anchor not in VWAP_ANCHORS:
            raise ValueError(f"VWAP anchor must be one of {', '.join(VWAP_ANCHORS)}.")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"source": source, "anchor": anchor},
            function_name="VWAP",
            function_params={"source": source, "anchor": anchor},
            raw_column=None,
            custom_kind="vwap",
            category=category,
            signature=signature,
        )

    if normalized_type in {"SMA", "EMA", "WMA"}:
        source = _normalize_source(clean_params.get("source", "close"), allow_volume=True)
        period = _as_int(clean_params.get("period", clean_params.get("length", 9)), "period")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"source": source, "period": period},
            function_name=normalized_type,
            function_params={"timeperiod": period, "price": source},
            raw_column=normalized_type.lower(),
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "RSI":
        source = _normalize_source(clean_params.get("source", "close"), allow_volume=False)
        length = _as_int(clean_params.get("length", 14), "length")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"source": source, "length": length},
            function_name="RSI",
            function_params={"timeperiod": length, "price": source},
            raw_column="rsi",
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "BB":
        source = _normalize_source(clean_params.get("source", "close"), allow_volume=True)
        length = _as_int(clean_params.get("length", 20), "length")
        std_dev_up = _as_float(clean_params.get("std_dev_up", 2.0), "std_dev_up")
        std_dev_down = _as_float(clean_params.get("std_dev_down", 2.0), "std_dev_down")
        ma_type = _normalize_ma_type(clean_params.get("ma_type", "SMA"))
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=normalized_output,
            offset=offset,
            params={
                "source": source,
                "length": length,
                "std_dev_up": std_dev_up,
                "std_dev_down": std_dev_down,
                "ma_type": ma_type,
            },
            function_name="BBANDS",
            function_params={
                "timeperiod": length,
                "nbdevup": std_dev_up,
                "nbdevdn": std_dev_down,
                "matype": MA_TYPE_TO_INT[ma_type],
                "price": source,
            },
            raw_column=OUTPUT_COLUMN_SUFFIXES["BB"][normalized_output or DEFAULT_OUTPUTS["BB"]],
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "PSAR":
        start = _as_float(clean_params.get("start", 0.02), "start")
        increment = _as_float(clean_params.get("increment", 0.02), "increment")
        max_value = _as_float(clean_params.get("max_value", 0.2), "max_value")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"start": start, "increment": increment, "max_value": max_value},
            function_name="SAREXT",
            function_params={
                "accelerationinitlong": start,
                "accelerationlong": increment,
                "accelerationmaxlong": max_value,
                "accelerationinitshort": start,
                "accelerationshort": increment,
                "accelerationmaxshort": max_value,
            },
            raw_column="sarext",
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "MACD":
        source = _normalize_source(clean_params.get("source", "close"), allow_volume=False)
        fast_length = _as_int(clean_params.get("fast_length", 12), "fast_length")
        slow_length = _as_int(clean_params.get("slow_length", 26), "slow_length")
        signal_length = _as_int(clean_params.get("signal_length", 9), "signal_length")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=normalized_output,
            offset=offset,
            params={
                "source": source,
                "fast_length": fast_length,
                "slow_length": slow_length,
                "signal_length": signal_length,
            },
            function_name="MACD",
            function_params={
                "price": source,
                "fastperiod": fast_length,
                "slowperiod": slow_length,
                "signalperiod": signal_length,
            },
            raw_column=OUTPUT_COLUMN_SUFFIXES["MACD"][normalized_output or DEFAULT_OUTPUTS["MACD"]],
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "STOCH":
        k_length = _as_int(clean_params.get("k_length", 14), "k_length")
        smooth_k = _as_int(clean_params.get("smooth_k", 3), "smooth_k")
        d_length = _as_int(clean_params.get("d_length", 3), "d_length")
        k_ma_type = _normalize_ma_type(clean_params.get("k_ma_type", "SMA"))
        d_ma_type = _normalize_ma_type(clean_params.get("d_ma_type", "SMA"))
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=normalized_output,
            offset=offset,
            params={
                "k_length": k_length,
                "smooth_k": smooth_k,
                "d_length": d_length,
                "k_ma_type": k_ma_type,
                "d_ma_type": d_ma_type,
            },
            function_name="STOCH",
            function_params={
                "fastk_period": k_length,
                "slowk_period": smooth_k,
                "slowk_matype": MA_TYPE_TO_INT[k_ma_type],
                "slowd_period": d_length,
                "slowd_matype": MA_TYPE_TO_INT[d_ma_type],
            },
            raw_column=OUTPUT_COLUMN_SUFFIXES["STOCH"][normalized_output or DEFAULT_OUTPUTS["STOCH"]],
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "CCI":
        length = _as_int(clean_params.get("length", 20), "length")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"length": length, "source": "hlc3"},
            function_name="CCI",
            function_params={"timeperiod": length},
            raw_column="cci",
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "ADX":
        length = _as_int(clean_params.get("length", 14), "length")
        output_name = normalized_output or DEFAULT_OUTPUTS["ADX"]
        function_name = {
            "adx_value": "ADX",
            "plus_di": "PLUS_DI",
            "minus_di": "MINUS_DI",
        }[output_name]
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=output_name,
            offset=offset,
            params={"length": length},
            function_name=function_name,
            function_params={"timeperiod": length},
            raw_column=OUTPUT_COLUMN_SUFFIXES["ADX"][output_name],
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "ATR":
        length = _as_int(clean_params.get("length", 14), "length")
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={"length": length},
            function_name="ATR",
            function_params={"timeperiod": length},
            raw_column="atr",
            custom_kind=None,
            category=category,
            signature=signature,
        )

    if normalized_type == "OBV":
        return ResolvedIndicator(
            indicator_type=normalized_type,
            output=None,
            offset=offset,
            params={},
            function_name="OBV",
            function_params={"price": "close"},
            raw_column="obv",
            custom_kind=None,
            category=category,
            signature=signature,
        )

    raise ValueError(f"Unsupported indicator type '{normalized_type}'.")


def indicator_signature(
    *,
    indicator_type: Any,
    params: Mapping[str, Any] | None,
    output: Any = None,
    offset: int = 0,
) -> str:
    normalized_type = normalize_indicator_type(indicator_type)
    normalized_output = normalize_output(normalized_type, output)
    cleaned = dict(params or {})
    cleaned.pop("offset", None)
    cleaned.pop("output", None)
    flattened = ",".join(f"{key}={cleaned[key]}" for key in sorted(cleaned))
    return f"{normalized_type}|{normalized_output or '-'}|{offset}|{flattened}"


def signature_to_column(signature: str) -> str:
    digest = sha1(signature.encode("utf-8")).hexdigest()[:12]
    return f"ind_{digest}"


def indicator_catalog() -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for indicator_type in sorted(INDICATOR_PARAMETER_CATALOG):
        capabilities = condition_capabilities(indicator_type)
        outputs = OUTPUT_OPTIONS.get(indicator_type, ())
        if outputs:
            capabilities["output_rules"] = {
                output_name: condition_capabilities(indicator_type, output_name)
                for output_name in outputs
            }
        catalog.append(capabilities)
    return catalog


def operator_requires_previous_bar(operator: str) -> bool:
    return str(operator or "").strip().lower() in PREVIOUS_BAR_OPERATORS


def _detect_rhs_kind(rhs: Any) -> str:
    if rhs is None:
        return "unknown"

    if isinstance(rhs, (int, float)) and not isinstance(rhs, bool):
        return "number"

    if hasattr(rhs, "low") and hasattr(rhs, "high"):
        return "range"

    if isinstance(rhs, Mapping) and {"low", "high"}.issubset(rhs.keys()):
        return "range"

    if hasattr(rhs, "type"):
        return "indicator"

    if isinstance(rhs, Mapping) and "type" in rhs:
        return "indicator"

    return "unknown"


def _validate_numeric_bounds(value: float, bounds: tuple[float, float], indicator_type: str) -> None:
    low, high = bounds
    if value < low or value > high:
        raise ValueError(f"{indicator_type} numeric rhs must be between {low} and {high}.")


def _normalize_source(value: Any, *, allow_volume: bool) -> str:
    normalized = str(value or "").strip().lower()
    valid = PRICE_OR_VOLUME_SOURCES if allow_volume else PRICE_SOURCES
    if normalized not in valid:
        raise ValueError(f"Unsupported source '{value}'. Expected one of {', '.join(valid)}.")
    return normalized


def _normalize_ma_type(value: Any) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in MA_TYPE_TO_INT:
        raise ValueError(f"Unsupported ma_type '{value}'. Expected one of {', '.join(MA_TYPES)}.")
    return normalized


def _as_int(value: Any, field_name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer.") from exc


def _as_float(value: Any, field_name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric.") from exc
