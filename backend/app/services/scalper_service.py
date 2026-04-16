from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.schemas import (
    ScalperCandle,
    ScalperChartPanel,
    ScalperResolvedOptionPair,
    ScalperSnapshotRequest,
    ScalperSnapshotResponse,
)
from app.services.instrument_service import instrument_service
from app.services.market_history_service import HistoricalFetchRequest, market_history_service

IST = ZoneInfo("Asia/Kolkata")

INDEX_UNDERLYINGS = {
    "NIFTY": ("NSE", "INDEX"),
    "BANKNIFTY": ("NSE", "INDEX"),
    "FINNIFTY": ("NSE", "INDEX"),
    "MIDCPNIFTY": ("NSE", "INDEX"),
    "SENSEX": ("BSE", "INDEX"),
    "BANKEX": ("BSE", "INDEX"),
}


@dataclass(frozen=True, slots=True)
class OptionContract:
    display_name: str
    option_type: str
    strike_price: int
    expiry_label: str | None
    lot_size: int | None
    tick_size: int | None


class ScalperService:
    def _normalize_underlying(self, underlying: str) -> str:
        return underlying.strip().upper()

    def _normalize_expiry_request(self, expiry: str | None) -> str | None:
        if not expiry:
            return None
        cleaned = expiry.strip().upper()
        if not cleaned:
            return None
        for fmt in ("%d %b %y", "%d %B %y", "%Y%m%d", "%d-%m-%Y", "%d-%b-%Y"):
            try:
                return datetime.strptime(cleaned, fmt).strftime("%Y%m%d")
            except ValueError:
                continue
        digits = "".join(ch for ch in cleaned if ch.isdigit())
        if len(digits) == 8:
            return digits
        return cleaned

    def _normalize_row_strike(self, raw: object) -> int | None:
        try:
            value = int(float(raw))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if value <= 0:
            return None
        if value >= 100000:
            return int(round(value / 100))
        return value

    def _normalize_expiry_label(self, row: dict) -> str | None:
        for key in ("display_expiry", "expiry_display", "expiry_label", "expiry", "order_expiry_date"):
            value = row.get(key)
            if value is None:
                continue
            if isinstance(value, (int, float)):
                text = str(int(value)).strip().upper()
            else:
                text = str(value).strip().upper()
            if text:
                return text
        return None

    def _iter_option_rows(self, request: ScalperSnapshotRequest) -> list[dict]:
        rows = instrument_service._get_cached_rows(request.session_token, request.environment, request.device_id)  # noqa: SLF001
        underlying = self._normalize_underlying(request.underlying)
        option_rows: list[dict] = []
        for row in rows:
            exchange = str(row.get("exchange") or "").strip().upper()
            if exchange != request.exchange:
                continue
            derivative_type = str(row.get("derivative_type") or "").strip().upper()
            option_type = str(row.get("option_type") or "").strip().upper()
            asset = str(row.get("asset") or "").strip().upper()
            stock_name = str(row.get("stock_name") or "").strip().upper()
            if derivative_type != "OPT" or option_type not in {"CE", "PE"}:
                continue
            if asset != underlying and not stock_name.startswith(underlying):
                continue
            option_rows.append(row)
        return option_rows

    def _resolve_option_pair(self, request: ScalperSnapshotRequest) -> tuple[OptionContract, OptionContract]:
        option_rows = self._iter_option_rows(request)
        if not option_rows:
            raise HTTPException(status_code=404, detail=f"No option contracts found for {request.underlying} on {request.exchange}.")

        target_expiry = self._normalize_expiry_request(request.expiry)
        normalized_rows: list[OptionContract] = []
        for row in option_rows:
            strike = self._normalize_row_strike(row.get("strike_price"))
            display_name = str(row.get("display_name") or row.get("symbol") or row.get("stock_name") or "").strip().upper()
            if strike is None or not display_name:
                continue
            normalized_rows.append(
                OptionContract(
                    display_name=display_name,
                    option_type=str(row.get("option_type") or "").strip().upper(),
                    strike_price=strike,
                    expiry_label=self._normalize_expiry_label(row),
                    lot_size=instrument_service._coerce_positive_int(row.get("lot_size")),  # noqa: SLF001
                    tick_size=instrument_service._coerce_positive_int(row.get("tick_size")),  # noqa: SLF001
                )
            )

        if target_expiry:
            normalized_rows = [row for row in normalized_rows if row.expiry_label == target_expiry]

        if not normalized_rows:
            raise HTTPException(status_code=404, detail="No option contracts matched the selected expiry.")

        call_candidates = [row for row in normalized_rows if row.option_type == "CE"]
        put_candidates = [row for row in normalized_rows if row.option_type == "PE"]
        if not call_candidates or not put_candidates:
            raise HTTPException(status_code=404, detail="Could not resolve both CE and PE contracts for the selected strike.")

        target_strike = int(request.strike_price)
        call = min(call_candidates, key=lambda row: (abs(row.strike_price - target_strike), row.expiry_label or "", row.display_name))
        put = min(put_candidates, key=lambda row: (abs(row.strike_price - target_strike), row.expiry_label or "", row.display_name))
        return call, put

    def _build_panel(
        self,
        *,
        request: ScalperSnapshotRequest,
        instrument: str,
        display_name: str,
        instrument_type: str,
    ) -> ScalperChartPanel:
        now_ist = datetime.now(IST)
        start_dt = now_ist - timedelta(days=max(request.lookback_days + 2, 7))
        frames = market_history_service.fetch(
            HistoricalFetchRequest(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                exchange=request.exchange,
                instrument_type=instrument_type,
                interval=request.interval,
                symbols=(instrument,),
                start_dt=start_dt,
                end_dt=now_ist,
            )
        )
        frame = frames.get(instrument.upper())
        if frame is None or frame.empty:
            raise HTTPException(status_code=404, detail=f"No chart data returned for {display_name}.")

        candles = [
            ScalperCandle(
                time_ist=timestamp.strftime("%d %b %H:%M"),
                epoch_ms=int(timestamp.timestamp() * 1000),
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["bucket_volume"]) if row.get("bucket_volume") is not None else None,
            )
            for timestamp, row in frame.tail(260).iterrows()
        ]
        last_price = candles[-1].close if candles else None
        return ScalperChartPanel(
            instrument=instrument,
            display_name=display_name,
            exchange=request.exchange,
            instrument_type=instrument_type,
            interval=request.interval,
            last_price=last_price,
            candles=candles,
        )

    def snapshot(self, request: ScalperSnapshotRequest) -> ScalperSnapshotResponse:
        underlying = self._normalize_underlying(request.underlying)
        if underlying not in INDEX_UNDERLYINGS:
            raise HTTPException(status_code=400, detail="Scalper currently supports indexed underlyings like NIFTY and BANKNIFTY.")

        default_exchange, underlying_type = INDEX_UNDERLYINGS[underlying]
        if request.exchange != default_exchange:
            raise HTTPException(status_code=400, detail=f"{underlying} is available on {default_exchange} for the current scalper view.")

        call_contract, put_contract = self._resolve_option_pair(request)

        underlying_panel = self._build_panel(
            request=request,
            instrument=underlying,
            display_name=underlying,
            instrument_type=underlying_type,
        )
        call_panel = self._build_panel(
            request=request,
            instrument=call_contract.display_name,
            display_name=call_contract.display_name,
            instrument_type="OPT",
        )
        put_panel = self._build_panel(
            request=request,
            instrument=put_contract.display_name,
            display_name=put_contract.display_name,
            instrument_type="OPT",
        )

        option_pair = ScalperResolvedOptionPair(
            underlying=underlying,
            exchange=request.exchange,
            expiry=call_contract.expiry_label or put_contract.expiry_label,
            strike_price=request.strike_price,
            call_display_name=call_contract.display_name,
            put_display_name=put_contract.display_name,
            lot_size=call_contract.lot_size or put_contract.lot_size,
            tick_size=call_contract.tick_size or put_contract.tick_size,
        )
        return ScalperSnapshotResponse(
            status="success",
            message="Scalper snapshot loaded from Nubra historical data.",
            underlying=underlying_panel,
            call_option=call_panel,
            put_option=put_panel,
            option_pair=option_pair,
        )


scalper_service = ScalperService()
