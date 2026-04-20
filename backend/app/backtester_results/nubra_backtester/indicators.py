from __future__ import annotations

from typing import Any

import pandas as pd
from nubra_talib import add_talib
from talib import abstract

from .indicator_registry import ResolvedIndicator, resolve_indicator, signature_to_column
from .models import IndicatorRequest


def interval_is_intraday(interval: str) -> bool:
    value = interval.strip().lower()
    return value not in {"1d", "1w", "1mt"} and value.endswith(("s", "m", "h"))


def required_history_bars(request: IndicatorRequest | dict[str, Any] | Any, interval: str) -> int:
    indicator = IndicatorRequest.from_value(request)
    resolved = resolve_indicator(
        indicator.type,
        indicator.params,
        output=indicator.output,
        offset=indicator.offset,
    )

    if resolved.custom_kind in {"price", "volume"}:
        base = 0
    elif resolved.custom_kind == "vwap":
        base = 1 if interval_is_intraday(interval) else 0
    else:
        try:
            fn = abstract.Function(resolved.function_name)
            if resolved.function_params:
                lookback_params = {k: v for k, v in resolved.function_params.items() if k != "price"}
                fn.set_parameters(lookback_params)
            base = int(fn.lookback)
        except Exception as exc:
            raise ValueError(
                f"Unsupported or invalid TA-Lib indicator '{resolved.function_name}'. {exc}"
            ) from exc

    return base + resolved.offset


def apply_indicators(
    df: pd.DataFrame,
    indicators: list[IndicatorRequest | dict[str, Any] | Any],
) -> tuple[pd.DataFrame, dict[str, str]]:
    out = ensure_price_inputs(df.copy())
    column_map: dict[str, str] = {}

    for raw_indicator in indicators:
        indicator = IndicatorRequest.from_value(raw_indicator)
        resolved = resolve_indicator(
            indicator.type,
            indicator.params,
            output=indicator.output,
            offset=indicator.offset,
        )
        desired_column = indicator.name or _default_output_name(resolved)
        out, actual_column = apply_indicator_expression(out, resolved, column_name=desired_column)
        column_map[desired_column] = actual_column
        column_map[resolved.signature] = actual_column

    return out, column_map


def apply_indicator_expression(
    df: pd.DataFrame,
    indicator: IndicatorRequest | dict[str, Any] | Any | ResolvedIndicator,
    *,
    column_name: str | None = None,
) -> tuple[pd.DataFrame, str]:
    out = ensure_price_inputs(df.copy())
    resolved = indicator if isinstance(indicator, ResolvedIndicator) else _resolve_from_value(indicator)
    actual_column = column_name or signature_to_column(resolved.signature)

    if actual_column in out.columns:
        return out, actual_column

    out, raw_series_column = _inject_indicator(out, resolved)
    source_series = out[raw_series_column]
    out[actual_column] = source_series
    return out, actual_column


def ensure_price_inputs(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "hl2" not in out.columns:
        out["hl2"] = (out["high"] + out["low"]) / 2.0
    if "hlc3" not in out.columns:
        out["hlc3"] = (out["high"] + out["low"] + out["close"]) / 3.0
    if "ohlc4" not in out.columns:
        out["ohlc4"] = (out["open"] + out["high"] + out["low"] + out["close"]) / 4.0
    return out


def _resolve_from_value(indicator: IndicatorRequest | dict[str, Any] | Any) -> ResolvedIndicator:
    request = IndicatorRequest.from_value(indicator)
    return resolve_indicator(
        request.type,
        request.params,
        output=request.output,
        offset=request.offset,
    )


def _inject_indicator(df: pd.DataFrame, resolved: ResolvedIndicator) -> tuple[pd.DataFrame, str]:
    actual_column = signature_to_column(resolved.signature)
    if actual_column in df.columns:
        return df, actual_column

    out = df
    if resolved.custom_kind:
        series = _compute_custom(out, resolved)
    else:
        out = add_talib(out, funcs={resolved.function_name: resolved.function_params})
        if not resolved.raw_column or resolved.raw_column not in out.columns:
            raise ValueError(
                f"Indicator {resolved.indicator_type} did not produce expected column '{resolved.raw_column}'."
            )
        series = out[resolved.raw_column]

    out[actual_column] = series.shift(resolved.offset) if resolved.offset else series
    return out, actual_column


def _default_output_name(resolved: ResolvedIndicator) -> str:
    if resolved.custom_kind == "price":
        source = str(resolved.params.get("source", "close"))
        if source == "close" and resolved.offset == 0:
            return "price"
        suffix = f"_{source}" if source != "close" else ""
        offset_suffix = f"_shift{resolved.offset}" if resolved.offset else ""
        return f"price{suffix}{offset_suffix}"

    if resolved.custom_kind == "volume":
        offset_suffix = f"_shift{resolved.offset}" if resolved.offset else ""
        return f"volume{offset_suffix}"

    if resolved.custom_kind == "vwap":
        anchor = str(resolved.params.get("anchor", "session"))
        source = str(resolved.params.get("source", "hlc3"))
        if anchor == "session" and source == "hlc3" and resolved.offset == 0:
            return "vwap"
        suffix = f"_{anchor}" if anchor != "session" else ""
        source_suffix = f"_{source}" if source != "hlc3" else ""
        offset_suffix = f"_shift{resolved.offset}" if resolved.offset else ""
        return f"vwap{suffix}{source_suffix}{offset_suffix}"

    if resolved.output:
        offset_suffix = f"_shift{resolved.offset}" if resolved.offset else ""
        return f"{resolved.indicator_type.lower()}_{resolved.output}{offset_suffix}"

    offset_suffix = f"_shift{resolved.offset}" if resolved.offset else ""
    return f"{resolved.indicator_type.lower()}{offset_suffix}"


def _compute_custom(df: pd.DataFrame, resolved: ResolvedIndicator) -> pd.Series:
    if resolved.custom_kind == "price":
        source = str(resolved.function_params["source"])
        return df[source]

    if resolved.custom_kind == "volume":
        return pd.to_numeric(df["volume"], errors="coerce")

    if resolved.custom_kind == "vwap":
        source = str(resolved.function_params["source"])
        anchor = str(resolved.function_params["anchor"])
        price_series = df[source]
        volume = pd.to_numeric(df["volume"], errors="coerce").fillna(0.0)

        localized = pd.to_datetime(df["timestamp"]).dt.tz_localize(None)
        if anchor == "session":
            group_keys = localized.dt.strftime("%Y-%m-%d")
        elif anchor == "week":
            iso = localized.dt.isocalendar()
            group_keys = iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)
        else:
            group_keys = localized.dt.strftime("%Y-%m")

        cumulative_price_volume = (price_series * volume).groupby(group_keys).cumsum()
        cumulative_volume = volume.groupby(group_keys).cumsum()
        return cumulative_price_volume.div(cumulative_volume.replace(0, pd.NA))

    raise ValueError(f"Unknown custom indicator kind '{resolved.custom_kind}'.")
