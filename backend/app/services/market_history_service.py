from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from fastapi import HTTPException

from app.config import settings

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
MAX_SYMBOLS_PER_QUERY = 10


@dataclass(frozen=True, slots=True)
class HistoricalFetchRequest:
    session_token: str
    device_id: str
    environment: str
    symbols: tuple[str, ...]
    exchange: str = "NSE"
    instrument_type: str = "STOCK"
    interval: str = "1m"
    start_dt: datetime | None = None
    end_dt: datetime | None = None


class MarketHistoryService:
    def _get_base_url(self, environment: str) -> str:
        return settings.nubra_uat_base_url if environment == "UAT" else settings.nubra_prod_base_url

    def _extract_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = payload.get("message") or payload.get("detail") or payload.get("error")
        if isinstance(detail, str) and detail.strip():
            return detail
        return f"Nubra request failed with status {response.status_code}."

    def _normalize_weekend_window(self, start_dt: datetime, end_dt: datetime) -> tuple[datetime, datetime]:
        end_ist = end_dt.astimezone(IST)
        if end_ist.weekday() < 5:
            return start_dt, end_dt

        shifted_end_ist = end_ist
        while shifted_end_ist.weekday() >= 5:
            shifted_end_ist = shifted_end_ist - timedelta(days=1)
        shifted_end_ist = shifted_end_ist.replace(
            hour=15,
            minute=30,
            second=0,
            microsecond=0,
        )

        duration = max(end_dt - start_dt, timedelta(days=1))
        shifted_end = shifted_end_ist.astimezone(end_dt.tzinfo or UTC)
        shifted_start = shifted_end - duration
        return shifted_start, shifted_end

    def fetch(self, request: HistoricalFetchRequest) -> dict[str, pd.DataFrame]:
        if not request.symbols:
            return {}
        if request.start_dt is None or request.end_dt is None:
            raise ValueError("Historical fetch requires both start_dt and end_dt.")
        if len(request.symbols) > MAX_SYMBOLS_PER_QUERY:
            raise ValueError(
                f"Historical fetch supports at most {MAX_SYMBOLS_PER_QUERY} symbols per query; "
                f"received {len(request.symbols)}."
            )

        start_dt, end_dt = self._normalize_weekend_window(request.start_dt, request.end_dt)

        payload = {
            "query": [
                {
                    "exchange": request.exchange,
                    "type": request.instrument_type,
                    "values": list(request.symbols),
                    "fields": ["open", "high", "low", "close", "cumulative_volume"],
                    "startDate": start_dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "endDate": end_dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "interval": request.interval,
                    # We always provide an explicit time window for chart history.
                    # Keeping intraDay=False ensures Nubra respects start/end dates
                    # instead of forcing the current day, which breaks weekend fallback.
                    "intraDay": False,
                    "realTime": False,
                }
            ]
        }

        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self._get_base_url(request.environment)}/charts/timeseries",
                json=payload,
                headers={
                    "Authorization": f"Bearer {request.session_token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-device-id": request.device_id,
                },
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()
        return self._normalize(payload)

    def _points_to_series(self, points: Iterable[dict]) -> pd.Series:
        timestamps: list[int] = []
        values: list[float] = []
        for point in points:
            timestamp = point.get("ts")
            value = point.get("v")
            if timestamp is None or value is None:
                continue
            timestamps.append(int(timestamp))
            values.append(float(value))
        if not timestamps:
            return pd.Series(dtype="float64")
        index = pd.to_datetime(timestamps, unit="ns", utc=True).tz_convert(IST)
        return pd.Series(values, index=index, dtype="float64")

    def _normalize(self, payload: dict) -> dict[str, pd.DataFrame]:
        symbol_frames: dict[str, pd.DataFrame] = {}
        for result_item in payload.get("result", []):
            for stock_data in result_item.get("values", []):
                for symbol, symbol_chart in stock_data.items():
                    frame = pd.DataFrame(
                        {
                            "open": self._points_to_series(symbol_chart.get("open", [])),
                            "high": self._points_to_series(symbol_chart.get("high", [])),
                            "low": self._points_to_series(symbol_chart.get("low", [])),
                            "close": self._points_to_series(symbol_chart.get("close", [])),
                            "cumulative_volume": self._points_to_series(symbol_chart.get("cumulative_volume", [])),
                        }
                    ).sort_index()
                    if frame.empty:
                        continue
                    frame = frame[~frame.index.duplicated(keep="last")]
                    frame["session_date"] = pd.Index(frame.index.date)
                    frame["bucket_volume"] = self._derive_bucket_volume(frame["cumulative_volume"])
                    for field in ("open", "high", "low", "close"):
                        frame[field] = frame[field] / 100.0
                    frame["symbol"] = str(symbol).strip().upper()
                    symbol_frames[str(symbol).strip().upper()] = frame
        return symbol_frames

    def _derive_bucket_volume(self, cumulative: pd.Series) -> pd.Series:
        diffed = cumulative.diff()
        return diffed.where(diffed.ge(0), cumulative).fillna(cumulative)

    def to_db_rows(self, frames: dict[str, pd.DataFrame], *, exchange: str, source: str = "historical_rest_backfill") -> list[dict]:
        rows: list[dict] = []
        for symbol, frame in frames.items():
            if frame.empty:
                continue
            for timestamp, row in frame.iterrows():
                rows.append(
                    {
                        "symbol": symbol,
                        "exchange": exchange,
                        "bucket_timestamp": timestamp.astimezone(UTC).to_pydatetime(),
                        "open_price": float(row["open"]),
                        "high_price": float(row["high"]),
                        "low_price": float(row["low"]),
                        "close_price": float(row["close"]),
                        "bucket_volume": float(row["bucket_volume"]) if pd.notna(row["bucket_volume"]) else None,
                        "cumulative_volume": float(row["cumulative_volume"]) if pd.notna(row["cumulative_volume"]) else None,
                        "source": source,
                        "raw_json": json.dumps(
                            {
                                "symbol": symbol,
                                "exchange": exchange,
                                "bucket_timestamp_ist": timestamp.strftime("%Y-%m-%d %H:%M:%S %Z"),
                                "open": float(row["open"]),
                                "high": float(row["high"]),
                                "low": float(row["low"]),
                                "close": float(row["close"]),
                                "bucket_volume": float(row["bucket_volume"]) if pd.notna(row["bucket_volume"]) else None,
                                "cumulative_volume": float(row["cumulative_volume"]) if pd.notna(row["cumulative_volume"]) else None,
                            }
                        ),
                    }
                )
        return rows


market_history_service = MarketHistoryService()
