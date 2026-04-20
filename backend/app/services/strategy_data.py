from __future__ import annotations

import math
import re
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterable

import httpx
import pandas as pd
from fastapi import HTTPException
from nubra_talib import add_talib, to_ohlcv_df
from talib import abstract as _talib_abstract

from app.config import settings
from app.services.strategy_catalog import INDICATOR_CATALOG, get_indicator_spec

IST_TZ = "Asia/Kolkata"
TRADING_SESSION_MINUTES = 375
DATE_ONLY_PATTERN = re.compile(r"^[A-Za-z0-9,\-\/ ]+$")


@dataclass(frozen=True)
class IndicatorExpr:
    """A normalized indicator expression used anywhere on the LHS or RHS of a condition."""

    type: str
    params: tuple[tuple[str, Any], ...]
    output: str | None
    offset: int

    @property
    def params_dict(self) -> dict[str, Any]:
        return dict(self.params)

    def signature(self) -> str:
        parts = [self.type.upper()]
        for key, value in self.params:
            parts.append(f"{key}={value}")
        if self.output:
            parts.append(f"out={self.output}")
        parts.append(f"offset={self.offset}")
        return "|".join(parts)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IndicatorExpr":
        indicator_type = str(payload.get("type", "")).upper()
        spec = get_indicator_spec(indicator_type)

        raw_params = payload.get("params") or {}
        if not isinstance(raw_params, dict):
            raise HTTPException(status_code=400, detail=f"Indicator {indicator_type} params must be an object.")

        normalized: dict[str, Any] = {}
        offset = int(raw_params.get("offset", payload.get("offset", 0)) or 0)
        for param_spec in spec.params:
            if param_spec.key == "offset":
                continue
            if param_spec.key in raw_params:
                value = raw_params[param_spec.key]
            else:
                value = param_spec.default
            if param_spec.kind == "int":
                value = int(value)
            elif param_spec.kind == "float":
                value = float(value)
            else:
                value = str(value)
            normalized[param_spec.key] = value

        output = payload.get("output") or raw_params.get("output")
        if spec.multi_output:
            if output is None:
                output = spec.default_output
            if output not in spec.outputs:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid output '{output}' for indicator {indicator_type}. Allowed: {list(spec.outputs)}.",
                )
        else:
            output = None

        return cls(
            type=indicator_type,
            params=tuple(sorted(normalized.items())),
            output=output,
            offset=max(offset, 0),
        )


def collect_required_expressions(expressions: Iterable[IndicatorExpr]) -> dict[str, IndicatorExpr]:
    """Deduplicate expressions by computation signature (type+params+output), keeping the max offset per key."""
    dedup: dict[str, IndicatorExpr] = {}
    for expr in expressions:
        # Different offsets share the same underlying column; track the deepest offset for warmup accounting.
        key = f"{expr.type}|" + "|".join(f"{k}={v}" for k, v in expr.params) + (f"|out={expr.output}" if expr.output else "")
        existing = dedup.get(key)
        if existing is None or expr.offset > existing.offset:
            dedup[key] = expr
    return dedup


def column_name_for(expr: IndicatorExpr) -> str:
    """Return the OHLCV dataframe column name that holds this indicator's values."""
    indicator_type = expr.type.upper()

    if indicator_type == "PRICE":
        source = expr.params_dict.get("source", "close")
        return f"_price_{source}"

    if indicator_type == "VOLUME":
        return "volume"

    if indicator_type == "VWAP":
        anchor = expr.params_dict.get("anchor", "session")
        source = expr.params_dict.get("source", "hlc3")
        return f"_vwap_{anchor}_{source}"

    talib_name = talib_function_name_for_expr(expr)
    if indicator_type == "ADX":
        if expr.output == "plus_di":
            return "plus_di"
        if expr.output == "minus_di":
            return "minus_di"
        return "adx"
    if expr.output is None:
        return talib_name.lower()

    output_column = _MULTI_OUTPUT_COLUMN_MAP[indicator_type][expr.output]
    return f"{talib_name.lower()}_{output_column.lower()}"


_TALIB_FUNCTION_NAMES: dict[str, str] = {
    "RSI": "RSI",
    "SMA": "SMA",
    "EMA": "EMA",
    "WMA": "WMA",
    "BB": "BBANDS",
    "PSAR": "SAR",
    "MACD": "MACD",
    "STOCH": "STOCH",
    "CCI": "CCI",
    "ADX": "ADX",
    "ATR": "ATR",
    "OBV": "OBV",
}

_MULTI_OUTPUT_COLUMN_MAP: dict[str, dict[str, str]] = {
    "BB": {"upper_band": "upperband", "middle_band": "middleband", "lower_band": "lowerband"},
    "MACD": {"macd_line": "macd", "signal_line": "macdsignal", "histogram": "macdhist"},
    "STOCH": {"k_line": "slowk", "d_line": "slowd"},
}

_ADX_OUTPUT_FUNCTION_MAP: dict[str, str] = {
    "adx_value": "ADX",
    "plus_di": "PLUS_DI",
    "minus_di": "MINUS_DI",
}


def talib_function_name_for_expr(expr: IndicatorExpr) -> str:
    indicator_type = expr.type.upper()
    if indicator_type == "ADX":
        output = expr.output or "adx_value"
        return _ADX_OUTPUT_FUNCTION_MAP[output]
    return _TALIB_FUNCTION_NAMES[indicator_type]


def _talib_params_for(expr: IndicatorExpr) -> dict[str, Any]:
    """Translate user-facing params into TA-Lib abstract function kwargs."""
    indicator_type = expr.type.upper()
    params = expr.params_dict

    if indicator_type == "RSI":
        return {"timeperiod": int(params.get("length", 14))}
    if indicator_type in {"SMA", "EMA", "WMA"}:
        return {"timeperiod": int(params.get("period", 9))}
    if indicator_type == "BB":
        return {
            "timeperiod": int(params.get("length", 20)),
            "nbdevup": float(params.get("std_dev_up", 2.0)),
            "nbdevdn": float(params.get("std_dev_down", 2.0)),
            "matype": _ma_type_index(str(params.get("ma_type", "SMA"))),
        }
    if indicator_type == "PSAR":
        return {
            "acceleration": float(params.get("increment", 0.02)),
            "maximum": float(params.get("max_value", 0.2)),
        }
    if indicator_type == "MACD":
        return {
            "fastperiod": int(params.get("fast_length", 12)),
            "slowperiod": int(params.get("slow_length", 26)),
            "signalperiod": int(params.get("signal_length", 9)),
        }
    if indicator_type == "STOCH":
        return {
            "fastk_period": int(params.get("k_length", 14)),
            "slowk_period": int(params.get("smooth_k", 3)),
            "slowk_matype": _ma_type_index(str(params.get("k_ma_type", "SMA"))),
            "slowd_period": int(params.get("d_length", 3)),
            "slowd_matype": _ma_type_index(str(params.get("d_ma_type", "SMA"))),
        }
    if indicator_type in {"CCI", "ADX", "ATR"}:
        return {"timeperiod": int(params.get("length", 14))}
    if indicator_type == "OBV":
        return {}
    return {}


_MA_TYPE_TO_INDEX = {
    "SMA": 0,
    "EMA": 1,
    "WMA": 2,
    "DEMA": 3,
    "TEMA": 4,
    "TRIMA": 5,
    "KAMA": 6,
    "MAMA": 7,
    "T3": 8,
}


def _ma_type_index(ma_type: str) -> int:
    return _MA_TYPE_TO_INDEX.get(ma_type.upper(), 0)


def _source_series(df: pd.DataFrame, source: str) -> pd.Series:
    if source == "hl2":
        return (df["high"] + df["low"]) / 2.0
    if source == "hlc3":
        return (df["high"] + df["low"] + df["close"]) / 3.0
    if source == "ohlc4":
        return (df["open"] + df["high"] + df["low"] + df["close"]) / 4.0
    return df[source]


def required_history_bars(expr: IndicatorExpr, interval: str | None = None) -> int:
    indicator_type = expr.type.upper()
    if indicator_type == "PRICE":
        return 0 + expr.offset
    if indicator_type == "VOLUME":
        base = 1 if interval and interval_is_intraday(interval) else 0
        return base + expr.offset
    if indicator_type == "VWAP":
        base = 1 if interval and interval_is_intraday(interval) else 0
        return base + expr.offset

    talib_name = talib_function_name_for_expr(expr)
    fn = _talib_abstract.Function(talib_name)
    talib_params = _talib_params_for(expr)
    if talib_params:
        fn.set_parameters(talib_params)
    return int(fn.lookback) + expr.offset


def inject_indicator_columns(df: pd.DataFrame, expressions: Iterable[IndicatorExpr]) -> pd.DataFrame:
    """Inject a column per deduplicated indicator expression. Mimics backtester_results apply_indicators."""
    out = df.copy()
    dedup = collect_required_expressions(expressions)

    for expr in dedup.values():
        indicator_type = expr.type.upper()

        if indicator_type == "PRICE":
            source = expr.params_dict.get("source", "close")
            series = _source_series(out, source)
            out[f"_price_{source}"] = series
            continue

        if indicator_type == "VOLUME":
            # "volume" column already present; nothing to do.
            continue

        if indicator_type == "VWAP":
            col = column_name_for(expr)
            if col in out.columns:
                continue
            source_key = expr.params_dict.get("source", "hlc3")
            anchor = expr.params_dict.get("anchor", "session")
            source = _source_series(out, source_key)
            volume = pd.to_numeric(out["volume"], errors="coerce").fillna(0.0)

            localized = pd.to_datetime(out["timestamp"]).dt.tz_localize(None)
            if anchor == "session":
                group_keys = localized.dt.strftime("%Y-%m-%d")
            elif anchor == "week":
                iso = localized.dt.isocalendar()
                group_keys = iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)
            else:
                group_keys = localized.dt.strftime("%Y-%m")

            pv = (source * volume).groupby(group_keys).cumsum()
            vol_cum = volume.groupby(group_keys).cumsum()
            out[col] = pv.div(vol_cum.replace(0, pd.NA))
            continue

        talib_name = talib_function_name_for_expr(expr)
        target_col = column_name_for(expr)
        if target_col in out.columns:
            continue

        talib_params = _talib_params_for(expr)
        # nubra_talib add_talib mutates by copying df, returns a new df with additional columns.
        source = expr.params_dict.get("source") if expr.type in {"RSI", "SMA", "EMA", "WMA", "MACD", "BB"} else None
        working = out
        rename_from_close: str | None = None
        if source and source in {"hl2", "hlc3", "ohlc4", "volume"}:
            # TA-Lib abstract uses the 'close' column as price input by default for these indicators.
            # Swap in the custom source under 'close' so add_talib picks it up, then restore.
            working = out.copy()
            working["_orig_close"] = working["close"]
            working["close"] = _source_series(out, source)
            rename_from_close = "_orig_close"
        elif source and source != "close":
            # open/high/low — TA-Lib abstract will still look at 'close' for these indicators.
            working = out.copy()
            working["_orig_close"] = working["close"]
            working["close"] = working[source]
            rename_from_close = "_orig_close"

        enriched = add_talib(working, funcs={talib_name: talib_params})
        if rename_from_close:
            enriched["close"] = enriched[rename_from_close]
            enriched = enriched.drop(columns=[rename_from_close])

        # Copy only the newly added indicator columns back into out
        for col in enriched.columns:
            if col in out.columns:
                continue
            out[col] = enriched[col]

    return out


# ------------------------------------------------------------------
# OHLCV fetcher (ported from backtester_results/engine.py, adapted to use
# NubraOSS httpx + session_token auth pattern instead of InitNubraSdk).
# ------------------------------------------------------------------


INDEX_SYMBOLS: dict[str, tuple[str, str]] = {
    "NIFTY": ("NSE", "INDEX"),
    "BANKNIFTY": ("NSE", "INDEX"),
    "FINNIFTY": ("NSE", "INDEX"),
    "MIDCPNIFTY": ("NSE", "INDEX"),
    "SENSEX": ("BSE", "INDEX"),
    "BANKEX": ("BSE", "INDEX"),
}


def infer_instrument_context(instrument: str) -> tuple[str, str, str]:
    symbol = instrument.strip().upper()
    if symbol in INDEX_SYMBOLS:
        exchange, instrument_type = INDEX_SYMBOLS[symbol]
        return symbol, exchange, instrument_type

    parts = [part for part in symbol.replace("-", " ").split() if part]
    last_part = parts[-1] if parts else symbol
    second_last = parts[-2] if len(parts) > 1 else ""

    if last_part in {"CE", "PE"} or second_last in {"CE", "PE"}:
        return symbol, "NSE", "OPT"
    if last_part == "FUT":
        return symbol, "NSE", "FUT"
    return symbol, "NSE", "STOCK"


def interval_is_intraday(interval: str) -> bool:
    value = interval.strip().lower()
    return value not in {"1d", "1w", "1mt"} and value.endswith(("s", "m", "h"))


def parse_user_timestamp(value: Any, *, timezone: str, is_end: bool) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize(timezone)

    if _looks_like_date_only(value, ts):
        if is_end:
            ts = ts.normalize() + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
        else:
            ts = ts.normalize()
    return ts.tz_convert(timezone)


def _looks_like_date_only(value: Any, parsed_timestamp: pd.Timestamp) -> bool:
    if isinstance(value, str):
        stripped = value.strip()
        if "T" in stripped or ":" in stripped:
            return False
        lowered = stripped.lower()
        if "am" in lowered or "pm" in lowered:
            return False
        if any(
            (parsed_timestamp.hour, parsed_timestamp.minute, parsed_timestamp.second, parsed_timestamp.microsecond)
        ):
            return False
        return bool(DATE_ONLY_PATTERN.match(stripped))
    return False


def _to_utc_string(timestamp: pd.Timestamp) -> str:
    utc_value = timestamp.tz_convert("UTC")
    return utc_value.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _estimate_fetch_start(requested_start: pd.Timestamp, interval: str, warmup_bars: int) -> pd.Timestamp:
    if warmup_bars <= 0:
        return requested_start

    value = interval.strip().lower()
    if value.endswith("mt"):
        return requested_start - pd.DateOffset(months=warmup_bars + 5)
    if value.endswith("w"):
        return requested_start - pd.Timedelta(days=max(14, warmup_bars * 10))
    if value.endswith("d"):
        return requested_start - pd.offsets.BDay(warmup_bars + 5)
    if value.endswith("h"):
        hours = int(value[:-1])
        return requested_start - pd.Timedelta(hours=hours * warmup_bars) - pd.Timedelta(days=2)
    if value.endswith("m"):
        minutes = int(value[:-1])
        bars_per_session = max(1, TRADING_SESSION_MINUTES // minutes)
        sessions = max(1, math.ceil(warmup_bars / bars_per_session))
        calendar_days = max(3, sessions * 2 + 1)
        return requested_start - pd.Timedelta(minutes=minutes * warmup_bars) - pd.Timedelta(days=calendar_days)
    if value.endswith("s"):
        seconds = int(value[:-1])
        bars_per_session = max(1, (TRADING_SESSION_MINUTES * 60) // seconds)
        sessions = max(1, math.ceil(warmup_bars / bars_per_session))
        calendar_days = max(3, sessions * 2 + 1)
        return requested_start - pd.Timedelta(seconds=seconds * warmup_bars) - pd.Timedelta(days=calendar_days)
    raise ValueError(f"Unsupported interval '{interval}'.")


def _get_base_url(environment: str) -> str:
    if environment == "UAT":
        return settings.nubra_uat_base_url
    return settings.nubra_prod_base_url


def _request_headers(session_token: str, device_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {session_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-device-id": device_id,
    }


def _extract_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    detail = payload.get("message") or payload.get("detail") or payload.get("error")
    if isinstance(detail, str) and detail.strip():
        return detail
    return f"Nubra request failed with status {response.status_code}."


def _normalize_history_payload(payload: dict, symbol: str) -> SimpleNamespace:
    result_list = payload.get("result", [])
    normalized_result: list[SimpleNamespace] = []
    for result_item in result_list:
        normalized_values: list[dict] = []
        for stock_data in result_item.get("values", []):
            symbol_chart = stock_data.get(symbol)
            if not symbol_chart:
                continue
            normalized_chart: dict[str, list[dict[str, int | float]]] = {}
            for field_name in ("open", "high", "low", "close", "cumulative_volume", "tick_volume"):
                points = symbol_chart.get(field_name, [])
                target_field = "cumulative_volume" if field_name == "tick_volume" else field_name
                normalized_chart[target_field] = [
                    {"timestamp": int(point.get("ts", 0)), "value": point.get("v", 0)}
                    for point in points
                    if point.get("ts") is not None
                ]
            normalized_values.append({symbol: normalized_chart})
        normalized_result.append(SimpleNamespace(values=normalized_values))
    return SimpleNamespace(result=normalized_result)


def _normalize_volume(df: pd.DataFrame, interval: str) -> pd.Series:
    volume = pd.to_numeric(df["volume"], errors="coerce")
    if not interval_is_intraday(interval):
        return volume.astype("float64")

    day_keys = df["timestamp"].dt.normalize()
    raw_diff = volume.diff()
    session_reset = day_keys.ne(day_keys.shift()) | raw_diff.lt(0)
    normalized = raw_diff.where(~session_reset, volume)
    return normalized.astype("float64")


def _fetch_ohlcv_once(
    *,
    session_token: str,
    device_id: str,
    environment: str,
    exchange: str,
    instrument_type: str,
    symbol: str,
    interval: str,
    fetch_start: pd.Timestamp,
    fetch_end: pd.Timestamp,
    intra_day: bool,
) -> pd.DataFrame:
    base_url = _get_base_url(environment)
    payload = {
        "query": [
            {
                "exchange": exchange,
                "type": instrument_type,
                "values": [symbol],
                "fields": ["open", "high", "low", "close", "cumulative_volume"],
                "startDate": _to_utc_string(fetch_start),
                "endDate": _to_utc_string(fetch_end),
                "interval": interval,
                "intraDay": intra_day,
                "realTime": False,
            }
        ]
    }

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{base_url}/charts/timeseries",
            json=payload,
            headers=_request_headers(session_token, device_id),
        )
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=_extract_error(response))
        data = response.json()

    normalized = _normalize_history_payload(data, symbol)
    df = to_ohlcv_df(normalized, symbol=symbol, tz=IST_TZ, paise_to_rupee=True, interval=interval)
    if df.empty:
        return df

    if df["timestamp"].dt.tz is None:
        df["timestamp"] = df["timestamp"].dt.tz_localize(IST_TZ)
    else:
        df["timestamp"] = df["timestamp"].dt.tz_convert(IST_TZ)

    df["volume"] = _normalize_volume(df, interval)
    return df


def fetch_with_warmup(
    *,
    session_token: str,
    device_id: str,
    environment: str,
    symbol: str,
    interval: str,
    requested_start: pd.Timestamp,
    requested_end: pd.Timestamp,
    warmup_bars: int,
    intra_day: bool = False,
    max_refetch_attempts: int = 4,
) -> tuple[pd.DataFrame, int, int]:
    """Ported from backtester_results/engine.py _fetch_with_warmup."""
    _, exchange, instrument_type = infer_instrument_context(symbol)
    fetch_start = _estimate_fetch_start(requested_start, interval, warmup_bars + 200)

    for attempt_index in range(1, max_refetch_attempts + 2):
        df = _fetch_ohlcv_once(
            session_token=session_token,
            device_id=device_id,
            environment=environment,
            exchange=exchange,
            instrument_type=instrument_type,
            symbol=symbol,
            interval=interval,
            fetch_start=fetch_start,
            fetch_end=requested_end,
            intra_day=intra_day,
        )
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No OHLCV rows returned for {symbol}.")

        warmup_rows_available = int((df["timestamp"] < requested_start).sum())
        if warmup_rows_available >= warmup_bars:
            return df, warmup_rows_available, attempt_index

        if attempt_index > max_refetch_attempts:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Unable to fetch enough warmup candles for {symbol}. "
                    f"Required {warmup_bars} rows before {requested_start}, got {warmup_rows_available}."
                ),
            )

        missing = max(1, warmup_bars - warmup_rows_available)
        fetch_start = _estimate_fetch_start(requested_start, interval, warmup_bars + missing * attempt_index)

    raise RuntimeError("Warmup fetch loop exited unexpectedly.")
