from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from app.schemas import (
    DeltaNeutralPairRow,
    DeltaNeutralPairsRequest,
    DeltaNeutralPairsResponse,
    ExpiryHeatmapRequest,
    ExpiryHeatmapResponse,
    ExpiryHeatmapRow,
    ScalperOrderRequest,
    ScalperOrderResponse,
    ScalperCandle,
    ScalperChartPanel,
    ScalperResolvedOptionPair,
    ScalperSnapshotRequest,
    ScalperSnapshotResponse,
    ScalperVolumeBreakoutRequest,
    ScalperVolumeBreakoutResponse,
    ScalperVolumeBreakoutRow,
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

INDEX_HISTORY_SYMBOL_ALIASES = {
    "NIFTY": ("NIFTY", "NIFTY 50"),
    "BANKNIFTY": ("BANKNIFTY", "NIFTY BANK"),
    "FINNIFTY": ("FINNIFTY", "NIFTY FIN SERVICE"),
    "MIDCPNIFTY": ("MIDCPNIFTY", "NIFTY MID SELECT"),
    "SENSEX": ("SENSEX",),
    "BANKEX": ("BANKEX",),
}


@dataclass(frozen=True, slots=True)
class OptionContract:
    ref_id: int | None
    display_name: str
    option_type: str
    strike_price: int
    expiry_label: str | None
    lot_size: int | None
    tick_size: int | None


class ScalperService:
    def _coerce_float(self, value: object) -> float | None:
        try:
            result = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if result != result:
            return None
        return result

    def _history_candidates(self, instrument: str, instrument_type: str) -> list[tuple[str, str]]:
        normalized_instrument = instrument.strip().upper()
        if instrument_type != "INDEX":
            return [(instrument_type, normalized_instrument)]

        aliases = INDEX_HISTORY_SYMBOL_ALIASES.get(normalized_instrument, (normalized_instrument,))
        candidates: list[tuple[str, str]] = []
        for alias in aliases:
            normalized_alias = alias.strip().upper()
            candidates.append(("INDEX", normalized_alias))

        # Some historical endpoints resolve index chart history using stock-like
        # symbol labels even when the live feed uses index aliases. Try both
        # styles before giving up so weekend fallbacks still paint the last
        # trading snapshot.
        for alias in aliases:
            normalized_alias = alias.strip().upper()
            fallback_candidate = ("STOCK", normalized_alias)
            if fallback_candidate not in candidates:
                candidates.append(fallback_candidate)
        return candidates

    def _expiry_sort_key(self, expiry_label: str | None) -> tuple[int, str]:
        if not expiry_label:
            return (10**9, "")
        normalized = self._normalize_expiry_request(expiry_label)
        if normalized and len(normalized) == 8 and normalized.isdigit():
            return (int(normalized), normalized)
        return (10**9, str(expiry_label).strip().upper())

    def _last_trading_close(self, value: datetime) -> datetime:
        cursor = value.astimezone(IST)
        while cursor.weekday() >= 5:
            cursor = cursor - timedelta(days=1)
        return cursor.replace(hour=15, minute=30, second=0, microsecond=0)

    def _fetch_latest_history_frame(
        self,
        *,
        request: ScalperSnapshotRequest,
        instrument: str,
        instrument_type: str,
    ):
        lookback_span = timedelta(days=max(request.lookback_days + 2, 7))
        end_dt = self._last_trading_close(datetime.now(IST))
        history_candidates = self._history_candidates(instrument, instrument_type)

        for _ in range(6):
            start_dt = end_dt - lookback_span
            for candidate_type, candidate_symbol in history_candidates:
                frames = market_history_service.fetch(
                    HistoricalFetchRequest(
                        session_token=request.session_token,
                        device_id=request.device_id,
                        environment=request.environment,
                        exchange=request.exchange,
                        instrument_type=candidate_type,
                        interval=request.interval,
                        symbols=(candidate_symbol,),
                        start_dt=start_dt,
                        end_dt=end_dt,
                    )
                )
                frame = frames.get(candidate_symbol.upper())
                if frame is not None and not frame.empty:
                    return frame
            end_dt = self._last_trading_close(end_dt - timedelta(days=1))
        return None

    def _session_baseline_metrics(self, frame, *, lookback_days: int) -> tuple[float | None, float | None, float | None]:
        if frame is None or frame.empty:
            return None, None, None

        localized_index = frame.index.tz_convert(IST) if frame.index.tz is not None else frame.index.tz_localize(IST)
        frame_with_dates = frame.copy()
        frame_with_dates["_session_date"] = [stamp.date() for stamp in localized_index]

        session_dates = list(dict.fromkeys(frame_with_dates["_session_date"].tolist()))
        if not session_dates:
            return None, None, None

        latest_session = session_dates[-1]
        latest_rows = frame_with_dates[frame_with_dates["_session_date"] == latest_session]
        if latest_rows.empty:
            return None, None, None

        latest_row = latest_rows.iloc[-1]
        current_volume = self._coerce_float(latest_row.get("bucket_volume"))
        session_open = self._coerce_float(latest_rows.iloc[0].get("open"))
        session_close = self._coerce_float(latest_row.get("close"))
        price_change_pct: float | None = None
        if session_open is not None and session_open > 0 and session_close is not None:
            price_change_pct = ((session_close - session_open) / session_open) * 100.0

        prior_dates = session_dates[:-1][-lookback_days:]
        prior_volumes = [
            volume
            for session_date in prior_dates
            if (volume := self._coerce_float(frame_with_dates[frame_with_dates["_session_date"] == session_date].iloc[-1].get("bucket_volume"))) is not None
        ]
        if not prior_volumes:
            recent_bars = frame.tail(max(lookback_days, 3) + 1).iloc[:-1]
            prior_volumes = [
                volume
                for volume in (self._coerce_float(value) for value in recent_bars.get("bucket_volume", []))
                if volume is not None
            ]

        average_volume = (sum(prior_volumes) / len(prior_volumes)) if prior_volumes else None
        return current_volume, average_volume, price_change_pct

    def _normalize_underlying(self, underlying: str) -> str:
        return underlying.strip().upper()

    def _normalize_expiry_request(self, expiry: str | None) -> str | None:
        if not expiry:
            return None
        cleaned = expiry.strip().upper()
        if not cleaned:
            return None
        for fmt in ("%d %b %y", "%d %B %y", "%Y%m%d", "%d-%m-%Y", "%d-%b-%Y", "%d%b%y", "%d%b%Y", "%d%B%y", "%d%B%Y"):
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
                normalized = self._normalize_expiry_request(text)
                return normalized or text
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

        normalized_rows = self._normalize_option_contracts(option_rows, request.expiry)
        if not normalized_rows:
            raise HTTPException(status_code=404, detail="No option contracts matched the selected expiry.")

        call_candidates = [row for row in normalized_rows if row.option_type == "CE"]
        put_candidates = [row for row in normalized_rows if row.option_type == "PE"]
        if not call_candidates or not put_candidates:
            raise HTTPException(status_code=404, detail="Could not resolve both CE and PE contracts for the selected strike.")

        call = min(call_candidates, key=lambda row: (abs(row.strike_price - int(request.ce_strike_price)), row.expiry_label or "", row.display_name))
        put = min(put_candidates, key=lambda row: (abs(row.strike_price - int(request.pe_strike_price)), row.expiry_label or "", row.display_name))
        return call, put

    def _normalize_option_contracts(self, option_rows: list[dict], expiry: str | None) -> list[OptionContract]:
        target_expiry = self._normalize_expiry_request(expiry)
        normalized_rows: list[OptionContract] = []
        for row in option_rows:
            strike = self._normalize_row_strike(row.get("strike_price"))
            display_name = str(row.get("display_name") or row.get("symbol") or row.get("stock_name") or "").strip().upper()
            if strike is None or not display_name:
                continue
            normalized_rows.append(
                OptionContract(
                    ref_id=instrument_service._coerce_positive_int(row.get("ref_id")),  # noqa: SLF001
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
        elif normalized_rows:
            nearest_expiry = min(
                (row.expiry_label for row in normalized_rows if row.expiry_label),
                key=self._expiry_sort_key,
                default=None,
            )
            if nearest_expiry:
                normalized_rows = [row for row in normalized_rows if row.expiry_label == nearest_expiry]
        return normalized_rows

    def _nearest_expiry_and_atm_strike(
        self,
        *,
        request: ScalperVolumeBreakoutRequest,
        underlying: str,
        spot_price: float | None,
    ) -> tuple[str | None, int | None]:
        option_rows = self._iter_option_rows(
            self._build_scalper_request(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                underlying=underlying,
                exchange=request.exchange,
                interval=request.interval,
                expiry=None,
            )
        )
        normalized_rows = self._normalize_option_contracts(option_rows, None)
        if not normalized_rows:
            return None, None

        nearest_expiry = next((row.expiry_label for row in normalized_rows if row.expiry_label), None)
        strikes = sorted({row.strike_price for row in normalized_rows})
        if not strikes:
            return nearest_expiry, None

        if spot_price is None:
            return nearest_expiry, strikes[len(strikes) // 2]
        return nearest_expiry, min(strikes, key=lambda strike: abs(strike - spot_price))

    def _build_scalper_request(
        self,
        *,
        session_token: str,
        device_id: str,
        environment: str,
        underlying: str,
        exchange: str,
        interval: str,
        expiry: str | None,
    ) -> ScalperSnapshotRequest:
        return ScalperSnapshotRequest(
            session_token=session_token,
            device_id=device_id,
            environment=environment,
            underlying=underlying,
            exchange=exchange,
            interval=interval,
            ce_strike_price=1,
            pe_strike_price=1,
            expiry=expiry,
            lookback_days=5,
        )

    def _latest_option_metrics(
        self,
        *,
        request: ScalperSnapshotRequest,
        instrument: str,
    ) -> dict[str, float | None]:
        frame = self._fetch_latest_history_frame(
            request=request,
            instrument=instrument,
            instrument_type="OPT",
        )
        if frame is None or frame.empty:
            return {
                "last_price": None,
                "volume": None,
                "change_pct": None,
            }

        recent = frame.tail(2)
        latest = recent.iloc[-1]
        last_price = float(latest["close"])
        bucket_volume = latest.get("bucket_volume")
        volume = float(bucket_volume) if bucket_volume is not None else None

        change_pct: float | None = None
        if len(recent) > 1:
            previous_close = float(recent.iloc[-2]["close"])
            if previous_close > 0:
                change_pct = ((last_price - previous_close) / previous_close) * 100.0

        return {
            "last_price": last_price,
            "volume": volume,
            "change_pct": change_pct,
        }

    def _get_base_url(self, environment: str) -> str:
        if environment == "UAT":
            from app.config import settings
            return settings.nubra_uat_base_url
        from app.config import settings
        return settings.nubra_prod_base_url

    def _request_headers(self, session_token: str, device_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": device_id,
        }

    def _compute_aggressive_limit_price(self, order_side: str, ltp_price: float | None, tick_size: int | None) -> int:
        normalized_tick = max(int(tick_size or 1), 1)
        ltp_paise = max(int(round((ltp_price or 0.0) * 100)), normalized_tick)
        if order_side == "ORDER_SIDE_BUY":
            aggressive_price = int(ltp_paise * 1.02)
            remainder = aggressive_price % normalized_tick
            if remainder:
                aggressive_price += normalized_tick - remainder
        else:
            aggressive_price = int(ltp_paise * 0.98)
            aggressive_price -= aggressive_price % normalized_tick
            if aggressive_price <= 0:
                aggressive_price = normalized_tick
        return max(aggressive_price, normalized_tick)

    def _get_underlying_spot(self, request: DeltaNeutralPairsRequest) -> float | None:
        base_url = self._get_base_url(request.environment)
        params = {"exchange": request.exchange} if request.exchange == "BSE" else None
        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.get(
                    f"{base_url}/optionchains/{request.underlying}/price",
                    params=params,
                    headers=self._request_headers(request.session_token, request.device_id),
                )
                if response.status_code >= 400:
                    return None
                payload = response.json()
        except Exception:
            return None
        price = payload.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            return None
        return float(price) / 100.0

    def _get_scalper_underlying_spot(self, request: ScalperVolumeBreakoutRequest, underlying: str) -> float | None:
        return self._get_underlying_spot(
            DeltaNeutralPairsRequest(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                underlying=underlying,
                exchange=request.exchange,
                expiry=None,
                limit=5,
            )
        )

    def _get_option_chain_snapshot(self, request: DeltaNeutralPairsRequest) -> dict | None:
        base_url = self._get_base_url(request.environment)
        params: dict[str, str] = {"exchange": request.exchange} if request.exchange == "BSE" else {}
        normalized_expiry = self._normalize_expiry_request(request.expiry)
        if normalized_expiry:
            params["expiry"] = normalized_expiry
        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.get(
                    f"{base_url}/optionchains/{request.underlying}",
                    params=params or None,
                    headers=self._request_headers(request.session_token, request.device_id),
                )
                if response.status_code >= 400:
                    return None
                payload = response.json()
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        return payload

    def _extract_option_chain_delta_maps(
        self,
        request: DeltaNeutralPairsRequest,
        normalized_rows: list[OptionContract],
    ) -> tuple[dict[int, float], dict[int, float], str | None]:
        payload = self._get_option_chain_snapshot(request)
        if not payload:
            return {}, {}, None

        selected_expiry = next((row.expiry_label for row in normalized_rows if row.expiry_label), None)
        payload_expiry = self._normalize_expiry_request(str(payload.get("expiry") or "").strip()) if payload.get("expiry") else None
        effective_expiry = selected_expiry or payload_expiry

        call_delta_by_strike: dict[int, float] = {}
        put_delta_by_strike: dict[int, float] = {}

        ce_rows = payload.get("ce") or payload.get("calls") or []
        pe_rows = payload.get("pe") or payload.get("puts") or []

        if isinstance(ce_rows, list):
            for row in ce_rows:
                if not isinstance(row, dict):
                    continue
                strike = self._normalize_row_strike(row.get("sp") if row.get("sp") is not None else row.get("strike_price"))
                delta = self._coerce_float(row.get("delta"))
                if strike is None or delta is None:
                    continue
                call_delta_by_strike[strike] = abs(delta)

        if isinstance(pe_rows, list):
            for row in pe_rows:
                if not isinstance(row, dict):
                    continue
                strike = self._normalize_row_strike(row.get("sp") if row.get("sp") is not None else row.get("strike_price"))
                delta = self._coerce_float(row.get("delta"))
                if strike is None or delta is None:
                    continue
                put_delta_by_strike[strike] = -abs(delta)

        return call_delta_by_strike, put_delta_by_strike, effective_expiry

    def delta_neutral_pairs(self, request: DeltaNeutralPairsRequest) -> DeltaNeutralPairsResponse:
        option_rows = self._iter_option_rows(
            self._build_scalper_request(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                underlying=request.underlying,
                exchange=request.exchange,
                interval="1m",
                expiry=request.expiry,
            )
        )
        normalized_rows = self._normalize_option_contracts(option_rows, request.expiry)
        if not normalized_rows:
            raise HTTPException(status_code=404, detail="No option contracts matched the selected expiry.")

        spot_price = self._get_underlying_spot(request)
        strikes = sorted({row.strike_price for row in normalized_rows})
        if not strikes:
            raise HTTPException(status_code=404, detail="No valid option strikes were found for the selected underlying.")

        if spot_price is not None:
            center_strike = min(strikes, key=lambda strike: abs(strike - spot_price))
        else:
            center_strike = strikes[len(strikes) // 2]

        calls_by_strike = {row.strike_price: row for row in normalized_rows if row.option_type == "CE"}
        puts_by_strike = {row.strike_price: row for row in normalized_rows if row.option_type == "PE"}
        call_delta_by_strike, put_delta_by_strike, effective_expiry = self._extract_option_chain_delta_maps(request, normalized_rows)

        candidate_call_strikes = sorted(calls_by_strike, key=lambda strike: abs(strike - center_strike))[: max(request.limit + 4, 8)]
        candidate_put_strikes = sorted(puts_by_strike, key=lambda strike: abs(strike - center_strike))[: max(request.limit + 4, 8)]

        scored_pairs: list[tuple[float, int, float, DeltaNeutralPairRow]] = []
        seen_pairs: set[tuple[int, int]] = set()

        for ce_strike in candidate_call_strikes:
            call_contract = calls_by_strike.get(ce_strike)
            call_delta = call_delta_by_strike.get(ce_strike)
            if not call_contract or call_delta is None:
                continue
            for pe_strike in candidate_put_strikes:
                put_contract = puts_by_strike.get(pe_strike)
                put_delta = put_delta_by_strike.get(pe_strike)
                if not put_contract or put_delta is None:
                    continue
                pair_key = (ce_strike, pe_strike)
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                width_points = abs(ce_strike - pe_strike)
                midpoint_distance = abs(((ce_strike + pe_strike) / 2) - center_strike)
                net_delta = call_delta + put_delta
                neutrality_score = max(0.0, 100.0 - (abs(net_delta) * 100.0))
                scored_pairs.append(
                    (
                        abs(net_delta),
                        width_points,
                        midpoint_distance,
                        DeltaNeutralPairRow(
                            rank=0,
                            underlying=request.underlying,
                            exchange=request.exchange,
                            expiry=effective_expiry or call_contract.expiry_label or put_contract.expiry_label,
                            ce_strike_price=ce_strike,
                            pe_strike_price=pe_strike,
                            call_display_name=call_contract.display_name,
                            put_display_name=put_contract.display_name,
                            spot_price=spot_price,
                            center_strike=center_strike,
                            width_points=width_points,
                            call_delta=round(call_delta, 4),
                            put_delta=round(put_delta, 4),
                            net_delta=round(net_delta, 4),
                            neutrality_score=round(neutrality_score, 2),
                            lot_size=call_contract.lot_size or put_contract.lot_size,
                            tick_size=call_contract.tick_size or put_contract.tick_size,
                        ),
                    ),
                  )

        used_delta_fallback = False
        if not scored_pairs:
            used_delta_fallback = True
            strike_step = min(
                (abs(right - left) for left, right in zip(strikes, strikes[1:]) if abs(right - left) > 0),
                default=50,
            )
            for ce_strike in candidate_call_strikes:
                call_contract = calls_by_strike.get(ce_strike)
                if not call_contract:
                    continue
                for pe_strike in candidate_put_strikes:
                    put_contract = puts_by_strike.get(pe_strike)
                    if not put_contract:
                        continue
                    pair_key = (ce_strike, pe_strike)
                    if pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)
                    width_points = abs(ce_strike - pe_strike)
                    midpoint_distance = abs(((ce_strike + pe_strike) / 2) - center_strike)
                    width_steps = width_points / max(strike_step, 1)
                    midpoint_steps = midpoint_distance / max(strike_step, 1)
                    neutrality_score = max(0.0, 100.0 - (width_steps * 12.0) - (midpoint_steps * 6.0))
                    scored_pairs.append(
                        (
                            width_points,
                            int(midpoint_distance),
                            ce_strike + pe_strike,
                            DeltaNeutralPairRow(
                                rank=0,
                                underlying=request.underlying,
                                exchange=request.exchange,
                                expiry=effective_expiry or call_contract.expiry_label or put_contract.expiry_label,
                                ce_strike_price=ce_strike,
                                pe_strike_price=pe_strike,
                                call_display_name=call_contract.display_name,
                                put_display_name=put_contract.display_name,
                                spot_price=spot_price,
                                center_strike=center_strike,
                                width_points=width_points,
                                call_delta=None,
                                put_delta=None,
                                net_delta=None,
                                neutrality_score=round(neutrality_score, 2),
                                lot_size=call_contract.lot_size or put_contract.lot_size,
                                tick_size=call_contract.tick_size or put_contract.tick_size,
                            ),
                        ),
                    )

        scored_pairs.sort(key=lambda item: (item[0], item[1], item[2]))
        pairs: list[DeltaNeutralPairRow] = []
        for index, (_, _, _, row) in enumerate(scored_pairs[: request.limit], start=1):
            row.rank = index
            pairs.append(row)

        return DeltaNeutralPairsResponse(
            status="success",
            message=(
                "Delta-neutral candidate pairs ranked using Nubra option delta values."
                if not used_delta_fallback
                else "Live delta values were unavailable, so the nearest structured CE / PE pairs are shown for demo selection."
            ),
            pairs=pairs,
        )

    def volume_breakout_finder(self, request: ScalperVolumeBreakoutRequest) -> ScalperVolumeBreakoutResponse:
        candidate_underlyings = [symbol for symbol, (exchange, _) in INDEX_UNDERLYINGS.items() if exchange == request.exchange]
        if not candidate_underlyings:
            return ScalperVolumeBreakoutResponse(
                status="success",
                message="No option-tradable underlyings are configured for this exchange yet.",
                lookback_days=request.lookback_days,
                rows=[],
            )

        breakout_rows: list[ScalperVolumeBreakoutRow] = []
        for underlying in candidate_underlyings:
            _, instrument_type = INDEX_UNDERLYINGS[underlying]
            history_request = self._build_scalper_request(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                underlying=underlying,
                exchange=request.exchange,
                interval=request.interval,
                expiry=None,
            )
            history_request.lookback_days = request.lookback_days
            frame = self._fetch_latest_history_frame(
                request=history_request,
                instrument=underlying,
                instrument_type=instrument_type,
            )
            if frame is None or frame.empty:
                continue

            current_volume, average_volume, price_change_pct = self._session_baseline_metrics(frame, lookback_days=request.lookback_days)
            latest_close = self._coerce_float(frame.iloc[-1].get("close"))
            volume_ratio = (current_volume / average_volume) if current_volume is not None and average_volume and average_volume > 0 else 0.0
            breakout_strength = max(0.0, min(100.0, (volume_ratio * 35.0) + (abs(price_change_pct or 0.0) * 8.0)))

            if volume_ratio >= 2.25:
                status_label = "Strong"
            elif volume_ratio >= 1.5:
                status_label = "Active"
            else:
                status_label = "Watching"

            spot_price = self._get_scalper_underlying_spot(request, underlying) or latest_close
            nearest_expiry, atm_strike = self._nearest_expiry_and_atm_strike(
                request=request,
                underlying=underlying,
                spot_price=spot_price,
            )

            breakout_rows.append(
                ScalperVolumeBreakoutRow(
                    rank=0,
                    underlying=underlying,
                    display_name=underlying,
                    exchange=request.exchange,
                    last_price=spot_price,
                    current_volume=current_volume,
                    average_volume=average_volume,
                    volume_ratio=round(volume_ratio, 2),
                    price_change_pct=round(price_change_pct, 2) if price_change_pct is not None else None,
                    breakout_strength=round(breakout_strength, 1),
                    status_label=status_label,
                    nearest_expiry=nearest_expiry,
                    atm_strike=atm_strike,
                )
            )

        breakout_rows.sort(
            key=lambda row: (
                -(row.volume_ratio or 0.0),
                -(abs(row.price_change_pct or 0.0)),
                row.underlying,
            )
        )
        rows = []
        for rank, row in enumerate(breakout_rows[: request.limit], start=1):
            row.rank = rank
            rows.append(row)

        return ScalperVolumeBreakoutResponse(
            status="success",
            message=(
                "Top option-tradable underlyings ranked by latest volume breakout signal. "
                "Live data is used when available, with recent trading-session fallback after market hours."
                if rows
                else "No breakout candidates are available for the selected lookback yet."
            ),
            lookback_days=request.lookback_days,
            rows=rows,
        )

    def place_order(self, request: ScalperOrderRequest) -> ScalperOrderResponse:
        base_url = self._get_base_url(request.environment)
        order_qty = max(int(request.lots), 1) * max(int(request.lot_size), 1)
        order_price = self._compute_aggressive_limit_price(
            request.order_side,
            request.ltp_price,
            request.tick_size,
        )
        payload = {
            "ref_id": request.instrument_ref_id,
            "order_type": "ORDER_TYPE_REGULAR",
            "order_qty": order_qty,
            "order_side": request.order_side,
            "order_delivery_type": request.order_delivery_type,
            "validity_type": "IOC",
            "price_type": "LIMIT",
            "order_price": order_price,
            "tag": request.tag or f"nubraoss_scalper_{request.option_leg.lower()}",
            "algo_params": {},
        }
        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    f"{base_url}/orders/v2/single",
                    json=payload,
                    headers=self._request_headers(request.session_token, request.device_id),
                )
                if response.status_code >= 400:
                    try:
                        detail = response.json()
                    except Exception:
                        detail = response.text
                    raise HTTPException(status_code=response.status_code, detail=detail)
                order = response.json()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Order placement failed: {exc}") from exc

        raw_order_price = self._coerce_float(order.get("order_price"))
        normalized_order_price = raw_order_price / 100.0 if raw_order_price is not None and raw_order_price > 1000 else raw_order_price
        return ScalperOrderResponse(
            status="success",
            message=f"{'Buy' if request.order_side == 'ORDER_SIDE_BUY' else 'Sell'} order sent for {request.instrument_display_name}.",
            order_id=instrument_service._coerce_positive_int(order.get("order_id")),  # noqa: SLF001
            order_status=str(order.get("order_status") or "").strip().upper() or None,
            order_side=request.order_side,
            order_qty=order_qty,
            order_price=normalized_order_price,
            lots=request.lots,
            instrument_display_name=request.instrument_display_name,
        )

    def expiry_heatmap(self, request: ExpiryHeatmapRequest) -> ExpiryHeatmapResponse:
        option_rows = self._iter_option_rows(
            self._build_scalper_request(
                session_token=request.session_token,
                device_id=request.device_id,
                environment=request.environment,
                underlying=request.underlying,
                exchange=request.exchange,
                interval=request.interval,
                expiry=request.expiry,
            )
        )
        normalized_rows = self._normalize_option_contracts(option_rows, request.expiry)
        if not normalized_rows:
            raise HTTPException(status_code=404, detail="No option contracts matched the selected expiry.")

        delta_request = DeltaNeutralPairsRequest(
            session_token=request.session_token,
            device_id=request.device_id,
            environment=request.environment,
            underlying=request.underlying,
            exchange=request.exchange,
            expiry=request.expiry,
            limit=5,
        )
        spot_price = self._get_underlying_spot(delta_request)

        strikes = sorted({row.strike_price for row in normalized_rows})
        if not strikes:
            raise HTTPException(status_code=404, detail="No valid strikes found for the selected expiry.")

        if spot_price is not None:
            center_strike = min(strikes, key=lambda strike: abs(strike - spot_price))
        else:
            center_strike = strikes[len(strikes) // 2]

        sorted_by_distance = sorted(strikes, key=lambda strike: (abs(strike - center_strike), strike))
        selected_strikes = sorted(sorted_by_distance[: request.limit])
        if not selected_strikes:
            raise HTTPException(status_code=404, detail="No strikes available for the heatmap.")

        calls_by_strike = {row.strike_price: row for row in normalized_rows if row.option_type == "CE"}
        puts_by_strike = {row.strike_price: row for row in normalized_rows if row.option_type == "PE"}
        history_request = self._build_scalper_request(
            session_token=request.session_token,
            device_id=request.device_id,
            environment=request.environment,
            underlying=request.underlying,
            exchange=request.exchange,
            interval=request.interval,
            expiry=request.expiry,
        )

        raw_rows: list[dict] = []
        for strike in selected_strikes:
            call_contract = calls_by_strike.get(strike)
            put_contract = puts_by_strike.get(strike)
            call_metrics = (
                self._latest_option_metrics(request=history_request, instrument=call_contract.display_name)
                if call_contract
                else {"last_price": None, "volume": None, "change_pct": None}
            )
            put_metrics = (
                self._latest_option_metrics(request=history_request, instrument=put_contract.display_name)
                if put_contract
                else {"last_price": None, "volume": None, "change_pct": None}
            )
            raw_rows.append(
                {
                    "strike_price": strike,
                    "expiry": (call_contract.expiry_label if call_contract else None) or (put_contract.expiry_label if put_contract else None),
                    "distance_from_spot": int(round(strike - spot_price)) if spot_price is not None else int(strike - center_strike),
                    "call_display_name": call_contract.display_name if call_contract else None,
                    "put_display_name": put_contract.display_name if put_contract else None,
                    "call_last_price": call_metrics["last_price"],
                    "put_last_price": put_metrics["last_price"],
                    "call_volume": call_metrics["volume"],
                    "put_volume": put_metrics["volume"],
                    "call_change_pct": call_metrics["change_pct"],
                    "put_change_pct": put_metrics["change_pct"],
                }
            )

        max_call_volume = max((float(row["call_volume"]) for row in raw_rows if row["call_volume"] is not None), default=0.0)
        max_put_volume = max((float(row["put_volume"]) for row in raw_rows if row["put_volume"] is not None), default=0.0)
        max_call_change = max((abs(float(row["call_change_pct"])) for row in raw_rows if row["call_change_pct"] is not None), default=0.0)
        max_put_change = max((abs(float(row["put_change_pct"])) for row in raw_rows if row["put_change_pct"] is not None), default=0.0)

        heatmap_rows: list[ExpiryHeatmapRow] = []
        for row in raw_rows:
            call_volume_ratio = (float(row["call_volume"]) / max_call_volume) if row["call_volume"] is not None and max_call_volume > 0 else 0.0
            put_volume_ratio = (float(row["put_volume"]) / max_put_volume) if row["put_volume"] is not None and max_put_volume > 0 else 0.0
            call_change_ratio = (abs(float(row["call_change_pct"])) / max_call_change) if row["call_change_pct"] is not None and max_call_change > 0 else 0.0
            put_change_ratio = (abs(float(row["put_change_pct"])) / max_put_change) if row["put_change_pct"] is not None and max_put_change > 0 else 0.0
            call_heat = round(((call_volume_ratio * 0.75) + (call_change_ratio * 0.25)) * 100.0, 1)
            put_heat = round(((put_volume_ratio * 0.75) + (put_change_ratio * 0.25)) * 100.0, 1)

            heatmap_rows.append(
                ExpiryHeatmapRow(
                    strike_price=int(row["strike_price"]),
                    expiry=row["expiry"],
                    distance_from_spot=int(row["distance_from_spot"]),
                    call_display_name=row["call_display_name"],
                    put_display_name=row["put_display_name"],
                    call_last_price=float(row["call_last_price"]) if row["call_last_price"] is not None else None,
                    put_last_price=float(row["put_last_price"]) if row["put_last_price"] is not None else None,
                    call_volume=float(row["call_volume"]) if row["call_volume"] is not None else None,
                    put_volume=float(row["put_volume"]) if row["put_volume"] is not None else None,
                    call_change_pct=float(row["call_change_pct"]) if row["call_change_pct"] is not None else None,
                    put_change_pct=float(row["put_change_pct"]) if row["put_change_pct"] is not None else None,
                    call_heat=call_heat,
                    put_heat=put_heat,
                )
            )

        resolved_expiry = next((row.expiry for row in heatmap_rows if row.expiry), None)
        return ExpiryHeatmapResponse(
            status="success",
            message="Expiry heatmap loaded from the latest available Nubra option snapshots.",
            underlying=request.underlying,
            exchange=request.exchange,
            expiry=resolved_expiry,
            interval=request.interval,
            spot_price=spot_price,
            center_strike=center_strike,
            rows=heatmap_rows,
        )

    def _build_panel(
        self,
        *,
        request: ScalperSnapshotRequest,
        instrument: str,
        display_name: str,
        instrument_type: str,
    ) -> ScalperChartPanel:
        frame = self._fetch_latest_history_frame(
            request=request,
            instrument=instrument,
            instrument_type=instrument_type,
        )
        if frame is None or frame.empty:
            raise HTTPException(status_code=404, detail=f"No chart data returned for {display_name}, even after checking recent trading sessions.")

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

        # Determine instrument type: indices have a fixed exchange mapping;
        # stocks/ETFs are passed through as-is with the exchange from the request.
        if underlying in INDEX_UNDERLYINGS:
            default_exchange, underlying_type = INDEX_UNDERLYINGS[underlying]
            if request.exchange != default_exchange:
                raise HTTPException(
                    status_code=400,
                    detail=f"{underlying} is available on {default_exchange} for the current scalper view.",
                )
        else:
            # Stock / ETF underlying — accept whatever exchange the client sent
            underlying_type = "STOCK"

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
            ce_strike_price=request.ce_strike_price,
            pe_strike_price=request.pe_strike_price,
            call_ref_id=call_contract.ref_id,
            put_ref_id=put_contract.ref_id,
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
