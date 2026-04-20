from __future__ import annotations

import math
import re
from typing import Any, Mapping, Sequence

import pandas as pd
from nubra_python_sdk.marketdata.market_data import MarketData
from nubra_python_sdk.start_sdk import InitNubraSdk, NubraEnv

from .indicators import apply_indicators, interval_is_intraday, required_history_bars
from .models import HistoricalIndicatorRequest, IndicatorRequest, IndicatorRunResult
from nubra_talib import to_ohlcv_df

DATE_ONLY_PATTERN = re.compile(r"^[A-Za-z0-9,\-\/ ]+$")
DEFAULT_TIMEZONE = "Asia/Kolkata"
TRADING_SESSION_MINUTES = 375
DEFAULT_WARMUP_BUFFER_BARS = 300


class NubraIndicatorEngine:
    def __init__(
        self,
        market_data: Any,
        timezone: str = DEFAULT_TIMEZONE,
        paise_to_rupee: bool = True,
        max_refetch_attempts: int = 4,
        warmup_buffer_bars: int = DEFAULT_WARMUP_BUFFER_BARS,
    ) -> None:
        self.market_data = market_data
        self.timezone = timezone
        self.paise_to_rupee = paise_to_rupee
        self.max_refetch_attempts = max_refetch_attempts
        self.warmup_buffer_bars = max(0, int(warmup_buffer_bars))

    @classmethod
    def from_sdk(
        cls,
        env: NubraEnv | str = "PROD",
        *,
        totp_login: bool = False,
        env_creds: bool = True,
        insti_login: bool = False,
        timezone: str = DEFAULT_TIMEZONE,
        paise_to_rupee: bool = True,
        max_refetch_attempts: int = 4,
        warmup_buffer_bars: int = DEFAULT_WARMUP_BUFFER_BARS,
    ) -> "NubraIndicatorEngine":
        sdk_env = _normalize_env(env)
        nubra = InitNubraSdk(
            sdk_env,
            totp_login=totp_login,
            env_creds=env_creds,
            insti_login=insti_login,
        )
        return cls(
            market_data=MarketData(nubra),
            timezone=timezone,
            paise_to_rupee=paise_to_rupee,
            max_refetch_attempts=max_refetch_attempts,
            warmup_buffer_bars=warmup_buffer_bars,
        )

    def calculate(
        self,
        *,
        symbol: str,
        start: Any,
        end: Any,
        indicators: Sequence[IndicatorRequest | Mapping[str, Any]],
        exchange: str = "NSE",
        instrument_type: str = "STOCK",
        interval: str = "1d",
        real_time: bool = False,
        intra_day: bool = False,
    ) -> IndicatorRunResult:
        request = HistoricalIndicatorRequest(
            symbol=symbol,
            start=start,
            end=end,
            indicators=indicators,
            exchange=exchange,
            instrument_type=instrument_type,
            interval=interval,
            real_time=real_time,
            intra_day=intra_day,
        )
        return self.calculate_from_request(request)

    def calculate_from_request(self, request: HistoricalIndicatorRequest) -> IndicatorRunResult:
        normalized_indicators = request.normalized_indicators()
        if not normalized_indicators:
            raise ValueError("At least one indicator request is required.")

        requested_start = _parse_user_timestamp(request.start, timezone=self.timezone, is_end=False)
        requested_end = _parse_user_timestamp(request.end, timezone=self.timezone, is_end=True)
        if requested_end < requested_start:
            raise ValueError("The end timestamp must be on or after the start timestamp.")
        if request.intra_day and any(
            required_history_bars(indicator, request.interval) > 0 for indicator in normalized_indicators
        ):
            raise ValueError(
                "Warmup history needs prior candles, so requests with indicator warmup must use intra_day=False."
            )

        warmup_bars = max(required_history_bars(indicator, request.interval) for indicator in normalized_indicators)

        requested_warmup_bars = self._requested_warmup_bars(warmup_bars)

        df, payload, warmup_rows_available, fetch_attempts = self._fetch_with_warmup(
            symbol=request.symbol,
            exchange=request.exchange,
            instrument_type=request.instrument_type,
            interval=request.interval,
            requested_start=requested_start,
            requested_end=requested_end,
            warmup_bars=requested_warmup_bars,
            real_time=request.real_time,
            intra_day=request.intra_day,
        )

        with_indicators, _ = apply_indicators(df, list(normalized_indicators))
        trimmed = with_indicators[
            (with_indicators["timestamp"] >= requested_start) & (with_indicators["timestamp"] <= requested_end)
        ].reset_index(drop=True)

        if trimmed.empty:
            raise ValueError(
                f"No rows were available for {request.symbol} between {requested_start} and {requested_end}."
            )

        return IndicatorRunResult(
            data=trimmed,
            requested_start=requested_start,
            requested_end=requested_end,
            fetched_start=df["timestamp"].min(),
            fetched_end=df["timestamp"].max(),
            warmup_bars_required=warmup_bars,
            warmup_rows_available=warmup_rows_available,
            fetch_attempts=fetch_attempts,
            request_payload=payload,
        )

    def _requested_warmup_bars(self, required_bars: int) -> int:
        return max(0, int(required_bars)) + self.warmup_buffer_bars

    def _fetch_with_warmup(
        self,
        *,
        symbol: str,
        exchange: str,
        instrument_type: str,
        interval: str,
        requested_start: pd.Timestamp,
        requested_end: pd.Timestamp,
        warmup_bars: int,
        real_time: bool,
        intra_day: bool,
    ) -> tuple[pd.DataFrame, dict[str, Any], int, int]:
        fetch_start = _estimate_fetch_start(requested_start, interval, warmup_bars)
        payload: dict[str, Any] | None = None

        for attempt_index in range(1, self.max_refetch_attempts + 2):
            payload = {
                "exchange": exchange,
                "type": instrument_type,
                "values": [symbol],
                "fields": ["open", "high", "low", "close", "cumulative_volume"],
                "startDate": _to_utc_string(fetch_start),
                "endDate": _to_utc_string(requested_end),
                "interval": interval,
                "intraDay": intra_day,
                "realTime": real_time,
            }

            result = self.market_data.historical_data(payload)
            df = self._result_to_ohlcv_df(result=result, symbol=symbol, interval=interval)
            if df.empty:
                raise ValueError(
                    f"Nubra historical_data returned no OHLCV rows for {symbol} with payload {payload}."
                )

            warmup_rows_available = int((df["timestamp"] < requested_start).sum())
            if warmup_rows_available >= warmup_bars:
                return df, payload, warmup_rows_available, attempt_index

            if attempt_index > self.max_refetch_attempts:
                raise ValueError(
                    "Unable to fetch enough warmup candles. "
                    f"Required {warmup_bars} rows before {requested_start}, got {warmup_rows_available}."
                )

            missing = max(1, warmup_bars - warmup_rows_available)
            fetch_start = _estimate_fetch_start(
                requested_start,
                interval,
                warmup_bars + missing * attempt_index,
            )

        raise RuntimeError("Warmup fetch loop exited unexpectedly.")

    def _result_to_ohlcv_df(self, *, result: Any, symbol: str, interval: str) -> pd.DataFrame:
        df = to_ohlcv_df(result, symbol=symbol, interval=interval)
        if df.empty:
            return df
        if df["timestamp"].dt.tz is None:
            df["timestamp"] = df["timestamp"].dt.tz_localize("Asia/Kolkata").dt.tz_convert(self.timezone)
        else:
            df["timestamp"] = df["timestamp"].dt.tz_convert(self.timezone)


        if self.paise_to_rupee and df["close"].mean() > 10000: # basic heuristic
            df[["open", "high", "low", "close"]] = df[["open", "high", "low", "close"]].div(100.0)

        # Keep intraday cumulative volume normalization
        df["volume"] = self._normalize_volume(df, interval)
        return df


    def _normalize_volume(self, df: pd.DataFrame, interval: str) -> pd.Series:
        volume = pd.to_numeric(df["volume"], errors="coerce")
        if not interval_is_intraday(interval):
            return volume.astype("float64")

        day_keys = df["timestamp"].dt.normalize()
        raw_diff = volume.diff()
        session_reset = day_keys.ne(day_keys.shift()) | raw_diff.lt(0)
        normalized = raw_diff.where(~session_reset, volume)
        return normalized.astype("float64")


def _normalize_env(env: NubraEnv | str) -> NubraEnv:
    if isinstance(env, NubraEnv):
        return env

    try:
        return getattr(NubraEnv, str(env).upper())
    except AttributeError as exc:
        raise ValueError("env must be either NubraEnv.UAT, NubraEnv.PROD, 'UAT', or 'PROD'.") from exc


def _parse_user_timestamp(value: Any, *, timezone: str, is_end: bool) -> pd.Timestamp:
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
            (
                parsed_timestamp.hour,
                parsed_timestamp.minute,
                parsed_timestamp.second,
                parsed_timestamp.microsecond,
            )
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
        # Use session-aware arithmetic: a 1h bar only exists during trading hours
        # (6 bars/session for NSE). Wall-clock math drastically undershoots.
        hours = int(value[:-1])
        bars_per_session = max(1, TRADING_SESSION_MINUTES // (hours * 60))
        sessions = max(1, math.ceil(warmup_bars / bars_per_session))
        calendar_days = max(3, sessions * 2 + 1)  # ×2 = weekend / holiday slack
        return requested_start - pd.Timedelta(days=calendar_days)
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


