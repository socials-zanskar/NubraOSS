from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import NamedTuple
from zoneinfo import ZoneInfo

import httpx
import pandas as pd

from app.config import settings
from app.schemas import (
    DeltaNeutralPairsRequest,
    ScalperSnapshotRequest,
    ScalperVolumeBreakoutRequest,
    ScalperVolumeBreakoutResponse,
    ScalperVolumeBreakoutRow,
)
from app.services.instrument_service import instrument_service
from app.services.market_history_service import HistoricalFetchRequest, market_history_service

IST = ZoneInfo("Asia/Kolkata")
logger = logging.getLogger(__name__)

# Fallback interval ladder — if the requested interval yields no data, try wider ones.
# Only includes intervals supported by the Nubra /charts/timeseries API.
# Order: narrowest → widest so we always prefer granular data when available.
_INTERVAL_FALLBACK_LADDER = ["1m", "3m", "5m", "15m", "30m", "1h"]


class _CacheEntry(NamedTuple):
    rows: list[ScalperVolumeBreakoutRow]
    scanned_at: datetime
    interval: str


class _BaselineCacheEntry(NamedTuple):
    average_volume: float
    lookback_high: float | None
    session_anchor: str

# Known index underlyings — kept for instrument_type resolution when we encounter them
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

# Concurrency cap for parallel history fetches
_SCAN_SEMAPHORE_SLOTS = 20
_MIN_BASELINE_SESSIONS = 3
_MIN_BREAKOUT_VOLUME_RATIO = 1.5


class ScalperVolumeBreakoutService:
    # In-memory last-good result cache keyed by (exchange, lookback_days)
    _last_good_cache: dict[tuple[str, int], _CacheEntry] = {}
    _baseline_cache: dict[tuple[str, str, str, int], _BaselineCacheEntry] = {}

    def _coerce_float(self, value: object) -> float | None:
        try:
            result = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if result != result:
            return None
        return result

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

    def _expiry_sort_key(self, expiry_label: str | None) -> tuple[int, str]:
        if not expiry_label:
            return (10**9, "")
        normalized = self._normalize_expiry_request(expiry_label)
        if normalized and len(normalized) == 8 and normalized.isdigit():
            return (int(normalized), normalized)
        return (10**9, str(expiry_label).strip().upper())

    def _history_candidates(self, instrument: str, instrument_type: str) -> list[tuple[str, str]]:
        normalized_instrument = instrument.strip().upper()
        if instrument_type != "INDEX":
            return [(instrument_type, normalized_instrument)]

        aliases = INDEX_HISTORY_SYMBOL_ALIASES.get(normalized_instrument, (normalized_instrument,))
        candidates: list[tuple[str, str]] = []
        for alias in aliases:
            normalized_alias = alias.strip().upper()
            candidates.append(("INDEX", normalized_alias))
        for alias in aliases:
            normalized_alias = alias.strip().upper()
            fallback_candidate = ("STOCK", normalized_alias)
            if fallback_candidate not in candidates:
                candidates.append(fallback_candidate)
        return candidates

    def _last_trading_close(self, value: datetime) -> datetime:
        cursor = value.astimezone(IST)
        while cursor.weekday() >= 5:
            cursor = cursor - timedelta(days=1)
        return cursor.replace(hour=15, minute=30, second=0, microsecond=0)

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

    def _fetch_latest_history_frame(
        self,
        *,
        request: ScalperSnapshotRequest,
        instrument: str,
        instrument_type: str,
    ):
        """
        Try to fetch a usable history frame for the instrument.

        Strategy (post-market resilience):
        1. Use the requested interval, walking backward up to 6 trading days.
        2. If still no data, walk through the fallback interval ladder (wider bars)
           so we always get at least daily candles — these are almost always available
           even after market close or on weekends.
        """
        lookback_span = timedelta(days=max(request.lookback_days + 2, 7))
        history_candidates = self._history_candidates(instrument, instrument_type)

        # Build the list of intervals to try: requested first, then wider fallbacks
        requested = request.interval
        fallback_intervals: list[str] = [requested]
        for iv in _INTERVAL_FALLBACK_LADDER:
            if iv != requested and iv not in fallback_intervals:
                fallback_intervals.append(iv)

        for interval in fallback_intervals:
            end_dt = self._last_trading_close(datetime.now(IST))

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
                            interval=interval,
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
            if (
                volume := self._coerce_float(
                    frame_with_dates[frame_with_dates["_session_date"] == session_date].iloc[-1].get("bucket_volume")
                )
            )
            is not None
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

    def _prepare_breakout_frame(self, frame):
        if frame is None or frame.empty:
            return frame
        working = frame.sort_index().copy()
        localized_index = working.index.tz_convert(IST) if working.index.tz is not None else working.index.tz_localize(IST)
        working.index = localized_index
        working["session_date"] = pd.Index(localized_index.date)
        working["time_slot"] = localized_index.strftime("%H:%M:%S")
        return working

    def _baseline_volumes(self, frame, current_ts, lookback_days: int):
        """
        Build a timeframe-wide historical baseline.

        Example:
        - interval = 1m
        - lookback_days = 5
        - current candle = latest 1m candle

        We compare the current candle volume against the average of *all* 1m candles
        from the previous 5 trading sessions, excluding today's session entirely.
        """
        session_dates = sorted(pd.unique(frame["session_date"]))
        previous_sessions = [session_date for session_date in session_dates if session_date < current_ts.date()]
        baseline_sessions = previous_sessions[-lookback_days:]
        mask = frame["session_date"].isin(baseline_sessions)
        baseline = frame.loc[mask, "bucket_volume"].dropna()
        required_sessions = min(lookback_days, _MIN_BASELINE_SESSIONS)
        observed_sessions = baseline_sessions if len(baseline_sessions) <= required_sessions else baseline_sessions[-required_sessions:]
        if len(observed_sessions) >= required_sessions and not baseline.empty:
            return baseline
        trailing = frame.loc[frame.index < current_ts, "bucket_volume"].dropna().tail(max(lookback_days * 30, 50))
        return trailing

    def _prior_price_bars(self, frame, current_ts, lookback_days: int):
        current_session = current_ts.date()
        session_dates = sorted(pd.unique(frame["session_date"]))
        previous_sessions = [session_date for session_date in session_dates if session_date < current_session]
        relevant_sessions = previous_sessions[-lookback_days:] + [current_session]
        mask = frame["session_date"].isin(relevant_sessions) & (frame.index < current_ts)
        return frame.loc[mask]

    def _baseline_cache_key(
        self,
        *,
        exchange: str,
        underlying: str,
        interval: str,
        lookback_days: int,
    ) -> tuple[str, str, str, int]:
        return (exchange.upper(), underlying.upper(), interval, lookback_days)

    def _resolve_baseline_metrics(
        self,
        *,
        frame,
        exchange: str,
        underlying: str,
        interval: str,
        lookback_days: int,
        current_ts,
    ) -> tuple[float | None, float | None]:
        current_session_anchor = current_ts.date().isoformat()
        cache_key = self._baseline_cache_key(
            exchange=exchange,
            underlying=underlying,
            interval=interval,
            lookback_days=lookback_days,
        )
        cached = ScalperVolumeBreakoutService._baseline_cache.get(cache_key)
        if cached and cached.session_anchor == current_session_anchor:
            return cached.average_volume, cached.lookback_high

        baseline = self._baseline_volumes(frame, current_ts, lookback_days)
        required_samples = min(lookback_days, _MIN_BASELINE_SESSIONS)
        if len(baseline) < required_samples:
            return None, None

        average_volume = float(baseline.mean())
        prior_bars = self._prior_price_bars(frame, current_ts, lookback_days)
        lookback_high = self._coerce_float(prior_bars["high"].max()) if not prior_bars.empty else None
        if average_volume > 0:
            ScalperVolumeBreakoutService._baseline_cache[cache_key] = _BaselineCacheEntry(
                average_volume=average_volume,
                lookback_high=lookback_high,
                session_anchor=current_session_anchor,
            )
        return average_volume, lookback_high

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

    def _normalize_option_contracts(self, option_rows: list[dict], expiry: str | None) -> list[dict]:
        target_expiry = self._normalize_expiry_request(expiry)
        normalized_rows: list[dict] = []
        for row in option_rows:
            strike = self._normalize_row_strike(row.get("strike_price"))
            display_name = str(row.get("display_name") or row.get("symbol") or row.get("stock_name") or "").strip().upper()
            if strike is None or not display_name:
                continue
            normalized_rows.append(
                {
                    "ref_id": instrument_service._coerce_positive_int(row.get("ref_id")),  # noqa: SLF001
                    "display_name": display_name,
                    "option_type": str(row.get("option_type") or "").strip().upper(),
                    "strike_price": strike,
                    "expiry_label": self._normalize_expiry_label(row),
                    "lot_size": instrument_service._coerce_positive_int(row.get("lot_size")),  # noqa: SLF001
                    "tick_size": instrument_service._coerce_positive_int(row.get("tick_size")),  # noqa: SLF001
                }
            )
        if target_expiry:
            normalized_rows = [row for row in normalized_rows if row["expiry_label"] == target_expiry]
        elif normalized_rows:
            nearest_expiry = min(
                (row["expiry_label"] for row in normalized_rows if row["expiry_label"]),
                key=self._expiry_sort_key,
                default=None,
            )
            if nearest_expiry:
                normalized_rows = [row for row in normalized_rows if row["expiry_label"] == nearest_expiry]
        return normalized_rows

    def _get_base_url(self, environment: str) -> str:
        if environment == "UAT":
            return settings.nubra_uat_base_url
        return settings.nubra_prod_base_url

    def _request_headers(self, session_token: str, device_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": device_id,
        }

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

        nearest_expiry = next((row["expiry_label"] for row in normalized_rows if row["expiry_label"]), None)
        strikes = sorted({row["strike_price"] for row in normalized_rows})
        if not strikes:
            return nearest_expiry, None

        if spot_price is None:
            return nearest_expiry, strikes[len(strikes) // 2]
        return nearest_expiry, min(strikes, key=lambda strike: abs(strike - spot_price))

    # ── Dynamic underlying discovery ──────────────────────────────────────────

    def _discover_option_underlyings(self, request: ScalperVolumeBreakoutRequest) -> list[tuple[str, str]]:
        """
        Return a deduplicated list of (underlying_symbol, instrument_type) for every
        instrument on the requested exchange that has option contracts in the refdata cache.

        instrument_type is 'INDEX' for known indexes, 'STOCK' for everything else.
        """
        rows = instrument_service._get_cached_rows(  # noqa: SLF001
            request.session_token, request.environment, request.device_id
        )

        seen: dict[str, str] = {}  # symbol -> instrument_type
        for row in rows:
            exchange = str(row.get("exchange") or "").strip().upper()
            if exchange != request.exchange:
                continue
            derivative_type = str(row.get("derivative_type") or "").strip().upper()
            option_type = str(row.get("option_type") or "").strip().upper()
            if derivative_type != "OPT" or option_type not in {"CE", "PE"}:
                continue

            # `asset` is the cleanest field — it holds the underlying symbol
            asset = str(row.get("asset") or "").strip().upper()
            if not asset:
                continue

            if asset not in seen:
                # If it's a known index, label it INDEX; otherwise STOCK
                if asset in INDEX_UNDERLYINGS:
                    seen[asset] = "INDEX"
                else:
                    seen[asset] = "STOCK"

        return list(seen.items())

    # ── Per-underlying scan (runs in thread pool via asyncio) ─────────────────

    def _scan_one_underlying(
        self,
        request: ScalperVolumeBreakoutRequest,
        underlying: str,
        instrument_type: str,
    ) -> ScalperVolumeBreakoutRow | None:
        """Fetch history and compute breakout metrics for a single underlying."""
        try:
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
                return None

            working = self._prepare_breakout_frame(frame)
            if working is None or working.empty or len(working) < 2:
                return None

            latest = working.iloc[-1]
            current_ts = working.index[-1]
            average_volume, lookback_high = self._resolve_baseline_metrics(
                frame=working,
                exchange=request.exchange,
                underlying=underlying,
                interval=request.interval,
                lookback_days=request.lookback_days,
                current_ts=current_ts,
            )
            if average_volume is None or average_volume <= 0:
                return None
            current_volume = self._coerce_float(latest.get("bucket_volume"))
            if current_volume is None or current_volume <= 0 or average_volume <= 0:
                return None

            latest_close = self._coerce_float(latest.get("close"))
            latest_open = self._coerce_float(latest.get("open"))
            prev_close = self._coerce_float(working.iloc[-2].get("close"))
            price_change_pct = None
            if prev_close is not None and prev_close > 0 and latest_close is not None:
                price_change_pct = ((latest_close - prev_close) / prev_close) * 100.0

            volume_ratio = (
                (current_volume / average_volume)
                if average_volume > 0
                else 0.0
            )

            price_breakout_pct = (
                ((latest_close - lookback_high) / lookback_high * 100.0)
                if latest_close is not None and lookback_high is not None and lookback_high > 0
                else None
            )
            is_price_breakout = bool(
                latest_close is not None and lookback_high is not None and latest_close > lookback_high
            )

            meets_breakout = volume_ratio >= _MIN_BREAKOUT_VOLUME_RATIO
            price_bonus = 18.0 if is_price_breakout else max(0.0, min(12.0, (price_breakout_pct or 0.0) * 6.0))
            momentum_bonus = min(8.0, abs(price_change_pct or 0.0) * 2.0)
            breakout_strength = max(
                0.0,
                min(100.0, (volume_ratio * 32.0) + price_bonus + momentum_bonus),
            )

            if volume_ratio >= 2.25 and is_price_breakout:
                status_label = "Strong"
            elif meets_breakout or is_price_breakout:
                status_label = "Active"
            else:
                status_label = "Watching"

            spot_price = self._get_scalper_underlying_spot(request, underlying) or latest_close
            nearest_expiry, atm_strike = self._nearest_expiry_and_atm_strike(
                request=request,
                underlying=underlying,
                spot_price=spot_price,
            )

            return ScalperVolumeBreakoutRow(
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
        except Exception as exc:
            logger.debug("volume_breakout scan skipped %s: %s", underlying, exc)
            return None

    # ── Async parallel scan with semaphore ────────────────────────────────────

    async def _scan_all_async(
        self,
        request: ScalperVolumeBreakoutRequest,
        candidates: list[tuple[str, str]],
    ) -> list[ScalperVolumeBreakoutRow]:
        semaphore = asyncio.Semaphore(_SCAN_SEMAPHORE_SLOTS)
        loop = asyncio.get_running_loop()

        async def _fetch_one(underlying: str, instrument_type: str) -> ScalperVolumeBreakoutRow | None:
            async with semaphore:
                return await loop.run_in_executor(
                    None,
                    self._scan_one_underlying,
                    request,
                    underlying,
                    instrument_type,
                )

        tasks = [_fetch_one(underlying, instrument_type) for underlying, instrument_type in candidates]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        rows: list[ScalperVolumeBreakoutRow] = []
        for result in results:
            if isinstance(result, ScalperVolumeBreakoutRow):
                rows.append(result)
        return rows

    # ── Public entry point ────────────────────────────────────────────────────

    def volume_breakout_finder(self, request: ScalperVolumeBreakoutRequest) -> ScalperVolumeBreakoutResponse:
        # 1. Discover all option-tradable underlyings dynamically
        candidates = self._discover_option_underlyings(request)

        if not candidates:
            return ScalperVolumeBreakoutResponse(
                status="success",
                message="No option-tradable underlyings found in the instrument cache for this exchange.",
                lookback_days=request.lookback_days,
                rows=[],
            )

        logger.info(
            "volume_breakout_finder: scanning %d option-tradable underlyings on %s",
            len(candidates),
            request.exchange,
        )

        # 2. Run parallel scan.
        # This method is called from a sync FastAPI route handler which FastAPI dispatches
        # in a thread pool — there is no running event loop on that thread, so asyncio.run()
        # is the correct and simplest approach.
        breakout_rows = asyncio.run(self._scan_all_async(request, candidates))

        # 3. Sort by breakout_strength descending, then volume_ratio, then price move.
        # Prefer genuine breakout candidates first, but still keep fallback rows for demos/off-hours.
        breakout_rows.sort(
            key=lambda row: (
                -(1 if row.volume_ratio >= _MIN_BREAKOUT_VOLUME_RATIO else 0),
                -row.breakout_strength,
                -(row.volume_ratio or 0.0),
                -(abs(row.price_change_pct or 0.0)),
                row.underlying,
            )
        )

        # 4. Assign ranks, return top N
        rows: list[ScalperVolumeBreakoutRow] = []
        for rank, row in enumerate(breakout_rows[: request.limit], start=1):
            row.rank = rank
            rows.append(row)

        cache_key = (request.exchange, request.lookback_days)

        # 5. If we got live results — store in cache and return them
        if rows:
            ScalperVolumeBreakoutService._last_good_cache[cache_key] = _CacheEntry(
                rows=rows,
                scanned_at=datetime.now(IST),
                interval=request.interval,
            )
            return ScalperVolumeBreakoutResponse(
                status="success",
                message=(
                    f"Top {len(rows)} option-tradable underlyings ranked by volume breakout strength "
                    f"(scanned {len(candidates)} total). "
                    "Live data is used when available, with recent trading-session fallback after market hours."
                ),
                lookback_days=request.lookback_days,
                rows=rows,
            )

        # 6. No live data — serve last known good result from cache
        cached = ScalperVolumeBreakoutService._last_good_cache.get(cache_key)
        if cached:
            age_minutes = int((datetime.now(IST) - cached.scanned_at).total_seconds() / 60)
            age_label = f"{age_minutes}m ago" if age_minutes < 60 else f"{age_minutes // 60}h {age_minutes % 60}m ago"
            logger.info(
                "volume_breakout_finder: no live data found — serving last cached snapshot (%s old, %d rows)",
                age_label,
                len(cached.rows),
            )
            return ScalperVolumeBreakoutResponse(
                status="success",
                message=(
                    f"Showing last session snapshot ({age_label}) — market is closed or data is unavailable. "
                    f"{len(cached.rows)} underlyings from the most recent active session."
                ),
                lookback_days=request.lookback_days,
                rows=cached.rows,
            )

        # 7. Nothing at all — empty response
        return ScalperVolumeBreakoutResponse(
            status="success",
            message=(
                "No breakout candidates found. The market may be closed and no prior session data is cached yet. "
                "Try again during or just after market hours."
            ),
            lookback_days=request.lookback_days,
            rows=[],
        )


scalper_volume_breakout_service = ScalperVolumeBreakoutService()
