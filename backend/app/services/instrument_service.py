from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import httpx
from fastapi import HTTPException

from app.config import settings


@dataclass
class InstrumentCacheEntry:
    environment: str
    device_id: str
    rows: list[dict]
    loaded_at: str


class InstrumentService:
    def __init__(self) -> None:
        self._cache: dict[str, InstrumentCacheEntry] = {}

    def _get_base_url(self, environment: str) -> str:
        if environment == "UAT":
            return settings.nubra_uat_base_url
        return settings.nubra_prod_base_url

    def _extract_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        return (
            payload.get("message")
            or payload.get("detail")
            or payload.get("error")
            or f"Nubra request failed with status {response.status_code}."
        )

    def _request_headers(self, session_token: str, device_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": device_id,
        }

    def _fetch_exchange_refdata(
        self,
        session_token: str,
        environment: str,
        device_id: str,
        exchange: str,
    ) -> list[dict]:
        base_url = self._get_base_url(environment)
        today_ist = datetime.now().strftime("%Y-%m-%d")
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{base_url}/refdata/refdata/{today_ist}",
                params={"exchange": exchange},
                headers=self._request_headers(session_token, device_id),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()
        rows = payload.get("refdata", [])
        return rows if isinstance(rows, list) else []

    def warm_cache(self, session_token: str, environment: str, device_id: str) -> None:
        rows = self._fetch_exchange_refdata(session_token, environment, device_id, "NSE")
        try:
            rows.extend(self._fetch_exchange_refdata(session_token, environment, device_id, "BSE"))
        except HTTPException:
            pass
        self._cache[session_token] = InstrumentCacheEntry(
            environment=environment,
            device_id=device_id,
            rows=rows,
            loaded_at=datetime.now().isoformat(),
        )

    def _get_cached_rows(self, session_token: str, environment: str, device_id: str) -> list[dict]:
        entry = self._cache.get(session_token)
        if entry and entry.environment == environment and entry.device_id == device_id:
            return entry.rows
        self.warm_cache(session_token, environment, device_id)
        entry = self._cache.get(session_token)
        return entry.rows if entry else []

    def _coerce_positive_int(self, value: object, fallback: int | None = None) -> int | None:
        try:
            coerced = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return fallback
        if coerced <= 0:
            return fallback
        return coerced

    def _is_cash_stock_row(self, row: dict) -> bool:
        derivative_type = str(row.get("derivative_type") or "").strip().upper()
        option_type = str(row.get("option_type") or "").strip().upper()
        return derivative_type not in {"FUT", "OPT"} and option_type not in {"CE", "PE"}

    def search_stocks(
        self,
        session_token: str,
        environment: str,
        device_id: str,
        query: str,
        limit: int = 8,
    ) -> list[dict]:
        q = query.strip().upper()
        if not q:
            return []
        rows = self._get_cached_rows(session_token, environment, device_id)
        matches: list[tuple[int, dict]] = []
        for row in rows:
            if not self._is_cash_stock_row(row):
                continue
            stock_name = str(row.get("stock_name") or "").strip().upper()
            symbol = str(row.get("symbol") or "").strip().upper()
            nubra_name = str(row.get("nubra_name") or "").strip().upper()
            exchange = str(row.get("exchange") or "").strip().upper()
            if exchange not in {"NSE", "BSE"}:
                continue
            score = -1
            if stock_name == q:
                score = 100
            elif symbol == q:
                score = 95
            elif stock_name.startswith(q):
                score = 90
            elif symbol.startswith(q):
                score = 85
            elif q in stock_name:
                score = 70
            elif q in symbol:
                score = 65
            elif q in nubra_name:
                score = 50
            if score < 0:
                continue
            ref_id = self._coerce_positive_int(row.get("ref_id"))
            if ref_id is None:
                continue
            matches.append(
                (
                    score,
                    {
                        "instrument": stock_name or symbol,
                        "display_name": stock_name or symbol,
                        "exchange": exchange,
                        "ref_id": ref_id,
                        "tick_size": self._coerce_positive_int(row.get("tick_size"), 1) or 1,
                        "lot_size": self._coerce_positive_int(row.get("lot_size"), 1) or 1,
                    },
                )
            )
        matches.sort(key=lambda item: (-item[0], item[1]["display_name"], item[1]["exchange"]))
        deduped: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for _, item in matches:
            key = (item["display_name"], item["exchange"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
            if len(deduped) >= limit:
                break
        return deduped

    def resolve_stock_meta(
        self,
        session_token: str,
        environment: str,
        device_id: str,
        instrument: str,
    ) -> tuple[int, int, int]:
        rows = self.search_stocks(session_token, environment, device_id, instrument, limit=20)
        symbol = instrument.strip().upper()
        for row in rows:
            if str(row["instrument"]).upper() == symbol:
                return int(row["ref_id"]), int(row["lot_size"]), int(row["tick_size"])
        if rows:
            first = rows[0]
            return int(first["ref_id"]), int(first["lot_size"]), int(first["tick_size"])
        raise HTTPException(status_code=404, detail=f"Unable to resolve ref_id for {symbol} on NSE.")


instrument_service = InstrumentService()
