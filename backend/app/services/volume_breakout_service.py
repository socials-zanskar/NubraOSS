from __future__ import annotations

import csv
import logging
import queue
import threading
import time as _time
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from itertools import islice
from pathlib import Path
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import HTTPException

from app.db import (
    connect_db,
    load_dashboard_universe_members,
    load_latest_ohlcv_1m_bars,
    load_ohlcv_1m_bars,
    load_ohlcv_1m_bars_delta,
    load_stock_liquidity_ranks,
    load_volume_dashboard_snapshot,
    prune_ohlcv_1m_bars,
    replace_dashboard_universe_members,
    save_volume_dashboard_snapshot,
    upsert_dashboard_universe,
    upsert_instruments,
    upsert_ohlcv_1m_bars,
    upsert_stock_liquidity_ranks,
)
from app.schemas import (
    VolumeBreakoutDrilldownPoint,
    VolumeBreakoutDrilldownRequest,
    VolumeBreakoutDrilldownResponse,
    VolumeBreakoutStartRequest,
    VolumeBreakoutStatusResponse,
    VolumeBreakoutStockRow,
    VolumeBreakoutSummary,
    VolumeBreakoutSyncStatus,
)
from app.services.instrument_service import instrument_service
from app.services.market_history_service import HistoricalFetchRequest, market_history_service

IST = ZoneInfo("Asia/Kolkata")
MIN_BASELINE_SESSIONS = 3
logger = logging.getLogger(__name__)
DEFAULT_UNIVERSE_CSV = Path(__file__).resolve().parents[3] / "data" / "universes" / "nifty300_symbols.csv"
CURATED_UNIVERSE_LIMITS = {
    "top120": 120,
    "top300": 300,
}
ALL_NSE_BOOTSTRAP_LIMIT = 120
LIQUIDITY_LOOKBACK_DAYS = 20
LIQUIDITY_HISTORY_DAYS = 45
LIQUIDITY_MIN_ACTIVE_DAYS = 8
LIQUIDITY_MIN_LAST_CLOSE = 5.0
LIQUIDITY_SCORE_SOURCE = "nubra_historical_1d_adtv"
SCAN_MIN_AVERAGE_VOLUME = 1000.0
SCAN_MIN_CURRENT_VOLUME = 1000.0
SCAN_MIN_AVERAGE_TRADED_VALUE = 2_500_000.0
EXCLUDED_SYMBOL_TOKENS = (
    "BEES",
    "ETF",
    "LIQUID",
    "GILT",
    "SDL",
    "NIFTY",
    "SENSEX",
)
INTERVAL_MINUTES = {
    "1m": 1,
    "2m": 2,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
}
INTERVAL_RULES = {
    "1m": "1min",
    "2m": "2min",
    "3m": "3min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "60min",
}


@dataclass
class VolumeBreakoutRuntime:
    request: VolumeBreakoutStartRequest
    running: bool = True
    last_run_ist: str | None = None
    next_run_ist: str | None = None
    last_error: str | None = None
    summary: VolumeBreakoutSummary = field(
        default_factory=lambda: VolumeBreakoutSummary(
            tracked_stocks=0,
            active_breakouts=0,
            fresh_breakouts=0,
            leaders_with_price_breakout=0,
            latest_candle_ist=None,
            market_status="bootstrapping",
        )
    )
    sync: VolumeBreakoutSyncStatus = field(
        default_factory=lambda: VolumeBreakoutSyncStatus(
            db_enabled=False,
            cache_mode="memory",
            universe_ready=False,
            symbols_synced=0,
            symbols_missing_history=0,
            history_range_ist=None,
            last_history_sync_ist=None,
            next_refresh_ist=None,
        )
    )
    universe_size: int = 0
    universe_rows: list[dict[str, Any]] = field(default_factory=list)
    base_frames: dict[str, pd.DataFrame] = field(default_factory=dict)
    market_breakouts: list[VolumeBreakoutStockRow] = field(default_factory=list)
    recent_breakouts: list[VolumeBreakoutStockRow] = field(default_factory=list)
    confirmed_breakouts: list[VolumeBreakoutStockRow] = field(default_factory=list)
    movers_up: list[VolumeBreakoutStockRow] = field(default_factory=list)
    movers_down: list[VolumeBreakoutStockRow] = field(default_factory=list)
    partial_scan_rows: dict[str, VolumeBreakoutStockRow] = field(default_factory=dict)
    last_breakout_keys: set[str] = field(default_factory=set)
    last_snapshot_ist: str | None = None
    symbol_latest_timestamps: dict[tuple[str, str], datetime] = field(default_factory=dict)
    in_flight_syncs: dict[str, datetime] = field(default_factory=dict)


class VolumeBreakoutService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._runtime: VolumeBreakoutRuntime | None = None
        self._sync_lock = threading.Lock()
        self._event_queues: list[queue.SimpleQueue] = []
        self._event_queues_lock = threading.Lock()
        self._liquidity_warmups: set[str] = set()
        self._liquidity_warmups_lock = threading.Lock()
        self._last_cached_snapshot: VolumeBreakoutStatusResponse | None = None

    def _current_ist(self) -> datetime:
        return datetime.now(IST)

    def _is_default_dashboard_universe(self, universe_slug: str) -> bool:
        return universe_slug == "volume-dashboard-default"

    def _universe_label(self, universe_mode: str) -> str:
        if universe_mode == "all_nse":
            return "All NSE"
        if universe_mode == "top120":
            return "Top 120"
        return "Top 300"

    def _is_tradeable_equity_symbol(self, symbol: str) -> bool:
        normalized = str(symbol or "").strip().upper()
        if not normalized:
            return False
        return not any(token in normalized for token in EXCLUDED_SYMBOL_TOKENS)

    def _snapshot_has_rows(self, snapshot: VolumeBreakoutStatusResponse) -> bool:
        return (
            snapshot.summary.tracked_stocks > 0
            or bool(snapshot.market_breakouts)
            or bool(snapshot.movers_up)
            or bool(snapshot.movers_down)
        )

    def _snapshot_matches_request(
        self,
        snapshot: VolumeBreakoutStatusResponse | None,
        request: VolumeBreakoutStartRequest,
    ) -> bool:
        if snapshot is None:
            return False
        return (
            snapshot.universe_slug == request.universe_slug
            and snapshot.interval == request.interval
            and snapshot.lookback_days == request.lookback_days
            and float(snapshot.min_volume_ratio) == float(request.min_volume_ratio)
        )

    def _load_persisted_snapshot(self, request: VolumeBreakoutStartRequest) -> VolumeBreakoutStatusResponse | None:
        try:
            with connect_db() as connection:
                payload = load_volume_dashboard_snapshot(
                    connection,
                    universe_slug=request.universe_slug,
                    interval=request.interval,
                    lookback_days=request.lookback_days,
                    min_volume_ratio=request.min_volume_ratio,
                )
        except Exception as exc:
            logger.warning("volume_dashboard.snapshot_cache.load_failed error=%s", exc)
            return None
        if not payload:
            return None
        try:
            snapshot = VolumeBreakoutStatusResponse.model_validate(payload)
        except Exception as exc:
            logger.warning("volume_dashboard.snapshot_cache.invalid error=%s", exc)
            return None
        snapshot.running = True
        snapshot.is_cached_snapshot = True
        snapshot.summary.market_status = "cached"
        return snapshot if self._snapshot_has_rows(snapshot) else None

    def _persist_snapshot(self, runtime: VolumeBreakoutRuntime, *, is_cached: bool = False) -> None:
        snapshot = self._snapshot_from(runtime, is_cached=is_cached)
        if not self._snapshot_has_rows(snapshot):
            return
        self._last_cached_snapshot = snapshot
        if not runtime.sync.db_enabled:
            return
        try:
            with connect_db() as connection:
                save_volume_dashboard_snapshot(
                    connection,
                    universe_slug=runtime.request.universe_slug,
                    interval=runtime.request.interval,
                    lookback_days=runtime.request.lookback_days,
                    min_volume_ratio=runtime.request.min_volume_ratio,
                    payload=snapshot.model_dump(mode="json"),
                )
        except Exception as exc:
            logger.warning("volume_dashboard.snapshot_cache.save_failed error=%s", exc)

    def _bootstrap_universe_rows(self, runtime: VolumeBreakoutRuntime) -> list[dict[str, Any]]:
        if runtime.request.universe_mode != "all_nse":
            return runtime.universe_rows

        try:
            bootstrap_request = runtime.request.model_copy(
                update={
                    "universe_mode": "top120",
                    "universe_limit": ALL_NSE_BOOTSTRAP_LIMIT,
                    "limit": max(runtime.request.limit, 20),
                }
            )
            _, bootstrap_rows = self._select_default_universe(bootstrap_request)
            if bootstrap_rows:
                bootstrap_keys = {
                    (str(row.get("symbol") or "").strip().upper(), str(row.get("exchange") or "NSE").strip().upper())
                    for row in bootstrap_rows
                }
                prioritized = [
                    row for row in runtime.universe_rows
                    if (str(row.get("symbol") or "").strip().upper(), str(row.get("exchange") or "NSE").strip().upper()) in bootstrap_keys
                ]
                if prioritized:
                    return prioritized
        except Exception as exc:
            logger.warning("volume_dashboard.bootstrap_universe_failed error=%s", exc)

        return runtime.universe_rows[:ALL_NSE_BOOTSTRAP_LIMIT]

    def _is_market_open(self) -> bool:
        now = self._current_ist()
        if now.weekday() >= 5:
            return False
        t = now.time()
        return time(hour=9, minute=15) <= t <= time(hour=15, minute=30)

    def _last_trading_session_date(self) -> str:
        now = self._current_ist()
        candidate = now
        if now.weekday() < 5 and now.time() < time(hour=9, minute=15):
            candidate = now - timedelta(days=1)
        while candidate.weekday() >= 5:
            candidate = candidate - timedelta(days=1)
        return candidate.strftime("%Y-%m-%d")

    def _next_market_open_ist(self) -> datetime:
        now = self._current_ist()
        candidate = now.replace(hour=9, minute=15, second=0, microsecond=0)
        if candidate <= now or now.weekday() >= 5:
            candidate = candidate + timedelta(days=1)
        while candidate.weekday() >= 5:
            candidate = candidate + timedelta(days=1)
        return candidate

    def _last_trading_day(self) -> datetime:
        now = self._current_ist()
        candidate = now
        if now.weekday() >= 5:
            candidate = now - timedelta(days=1)
        elif now.time() < time(hour=9, minute=15):
            candidate = now - timedelta(days=1)
        while candidate.weekday() >= 5:
            candidate = candidate - timedelta(days=1)
        return candidate

    def _market_open_ist(self, day: datetime | None = None) -> datetime:
        today = (day or self._current_ist()).astimezone(IST)
        return datetime.combine(today.date(), time(hour=9, minute=15), tzinfo=IST)

    def _market_close_ist(self, day: datetime | None = None) -> datetime:
        today = (day or self._current_ist()).astimezone(IST)
        return datetime.combine(today.date(), time(hour=15, minute=30), tzinfo=IST)

    def _history_end_ist(self) -> datetime:
        if self._is_market_open():
            return self._current_ist()
        return self._market_close_ist(self._last_trading_day())

    def _history_start_ist(self, lookback_days: int) -> datetime:
        return self._market_open_ist(self._last_trading_day()) - timedelta(days=lookback_days + 7)

    def _chunked(self, values: Iterable[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
        iterator = iter(values)
        while True:
            chunk = list(islice(iterator, size))
            if not chunk:
                return
            yield chunk

    def _db_enabled(self) -> bool:
        try:
            connection = connect_db()
        except Exception:
            return False
        connection.close()
        return True

    def register_event_queue(self, q: queue.SimpleQueue) -> None:
        with self._event_queues_lock:
            self._event_queues.append(q)

    def unregister_event_queue(self, q: queue.SimpleQueue) -> None:
        with self._event_queues_lock:
            if q in self._event_queues:
                self._event_queues.remove(q)

    def has_event_subscribers(self) -> bool:
        with self._event_queues_lock:
            return bool(self._event_queues)

    def _push_event(self, event: dict[str, Any]) -> None:
        with self._event_queues_lock:
            queues = list(self._event_queues)
        for q in queues:
            try:
                q.put_nowait(event)
            except Exception:
                pass

    def _instrument_rows_from_refdata(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in items:
            rows.append(
                {
                    "symbol": str(item.get("symbol") or item.get("instrument") or "").strip().upper(),
                    "display_name": str(item.get("display_name") or item.get("instrument") or "").strip().upper(),
                    "exchange": str(item.get("exchange") or "NSE").strip().upper(),
                    "ref_id": int(item.get("ref_id") or 0),
                    "tick_size": int(item.get("tick_size") or 1),
                    "lot_size": int(item.get("lot_size") or 1),
                    "instrument_type": "STOCK",
                    "is_active": True,
                    "source": "nubra_refdata_rest",
                    "raw_json": "{}",
                }
            )
        return [row for row in rows if row["symbol"] and row["ref_id"] > 0]

    def _load_curated_universe_rows(self) -> list[dict[str, str]]:
        if not DEFAULT_UNIVERSE_CSV.exists():
            return []
        with DEFAULT_UNIVERSE_CSV.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            rows = [
                {
                    "symbol": str(row.get("symbol") or "").strip().upper(),
                    "exchange": str(row.get("exchange") or "NSE").strip().upper(),
                    "sector": str(row.get("sector") or "").strip() or None,
                    "industry": str(row.get("industry") or "").strip() or None,
                }
                for row in reader
            ]
        return [row for row in rows if row["symbol"] and row["exchange"]]

    def _rank_date(self) -> str:
        return self._last_trading_session_date()

    def _liquidity_history_window(self) -> tuple[datetime, datetime]:
        end_ist = self._market_close_ist(self._last_trading_day())
        return end_ist - timedelta(days=LIQUIDITY_HISTORY_DAYS), end_ist

    def _compute_liquidity_ranks(
        self,
        request: VolumeBreakoutStartRequest,
        cash_stocks: list[dict[str, Any]],
        *,
        as_of_date: str,
    ) -> list[dict[str, Any]]:
        start_ist, end_ist = self._liquidity_history_window()
        item_by_symbol = {str(item["symbol"]).strip().upper(): item for item in cash_stocks}
        scored: list[dict[str, Any]] = []

        for batch in self._chunked(cash_stocks, 10):
            symbols = tuple(str(item["symbol"]).strip().upper() for item in batch)
            try:
                frames = market_history_service.fetch(
                    HistoricalFetchRequest(
                        session_token=request.session_token,
                        device_id=request.device_id,
                        environment=request.environment,
                        symbols=symbols,
                        exchange="NSE",
                        interval="1d",
                        start_dt=start_ist,
                        end_dt=end_ist,
                    )
                )
            except HTTPException as exc:
                logger.warning(
                    "volume_dashboard.liquidity_rank.batch_skipped status=%s symbols=%s detail=%s",
                    exc.status_code,
                    list(symbols),
                    exc.detail,
                )
                continue

            for symbol, frame in frames.items():
                if frame.empty or symbol not in item_by_symbol:
                    continue
                recent = frame.sort_index().tail(LIQUIDITY_LOOKBACK_DAYS).copy()
                recent["traded_value"] = recent["close"] * recent["bucket_volume"].fillna(0)
                valid = recent[recent["traded_value"] > 0]
                active_days = int(len(valid))
                if active_days < LIQUIDITY_MIN_ACTIVE_DAYS:
                    continue
                last_close = float(recent["close"].dropna().iloc[-1]) if not recent["close"].dropna().empty else 0.0
                if last_close < LIQUIDITY_MIN_LAST_CLOSE:
                    continue

                avg_traded_value = float(valid["traded_value"].mean())
                median_traded_value = float(valid["traded_value"].median())
                avg_volume = float(valid["bucket_volume"].mean())
                liquidity_score = (0.7 * avg_traded_value) + (0.3 * median_traded_value)
                scored.append(
                    {
                        "as_of_date": as_of_date,
                        "symbol": symbol,
                        "exchange": "NSE",
                        "liquidity_score": round(liquidity_score, 2),
                        "avg_traded_value_20d": round(avg_traded_value, 2),
                        "median_traded_value_20d": round(median_traded_value, 2),
                        "avg_volume_20d": round(avg_volume, 2),
                        "active_days": active_days,
                        "last_close": round(last_close, 2),
                        "source": LIQUIDITY_SCORE_SOURCE,
                    }
                )

        scored.sort(key=lambda row: (-float(row["liquidity_score"]), str(row["symbol"])))
        for index, row in enumerate(scored, start=1):
            row["rank"] = index
        logger.info(
            "volume_dashboard.liquidity_rank.computed as_of_date=%s candidates=%s ranked=%s",
            as_of_date,
            len(cash_stocks),
            len(scored),
        )
        return scored

    def _load_cached_liquidity_ranks(
        self,
        *,
        as_of_date: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        with connect_db() as connection:
            cached = load_stock_liquidity_ranks(
                connection,
                exchange="NSE",
                as_of_date=as_of_date,
                limit=limit,
            )
        logger.info(
            "volume_dashboard.liquidity_rank.cache_lookup requested_as_of_date=%s cached=%s limit=%s source=%s",
            as_of_date,
            len(cached),
            limit,
            cached[0].get("source") if cached else None,
        )
        return cached

    def _start_liquidity_rank_warmup(
        self,
        request: VolumeBreakoutStartRequest,
        cash_stocks: list[dict[str, Any]],
        curated_by_key: dict[tuple[str, str], dict[str, Any]],
        *,
        as_of_date: str,
    ) -> None:
        with self._liquidity_warmups_lock:
            if as_of_date in self._liquidity_warmups:
                return
            self._liquidity_warmups.add(as_of_date)

        request_copy = VolumeBreakoutStartRequest(**request.model_dump())
        cash_stock_copy = [dict(item) for item in cash_stocks]
        curated_copy = {key: dict(value) for key, value in curated_by_key.items()}

        def worker() -> None:
            try:
                logger.info(
                    "volume_dashboard.liquidity_rank.warmup_start as_of_date=%s candidates=%s",
                    as_of_date,
                    len(cash_stock_copy),
                )
                ranked = self._compute_liquidity_ranks(request_copy, cash_stock_copy, as_of_date=as_of_date)
                if ranked:
                    with connect_db() as connection:
                        upsert_stock_liquidity_ranks(connection, ranked)
                        _, ranked_rows = self._rows_from_liquidity_ranks(
                            request_copy,
                            cash_stock_copy,
                            curated_copy,
                            ranked[: min(CURATED_UNIVERSE_LIMITS.get(request_copy.universe_mode, 300), request_copy.universe_limit)],
                        )
                        if ranked_rows:
                            upsert_dashboard_universe(
                                connection,
                                slug=request_copy.universe_slug,
                                title="Volume Dashboard Liquidity Ranked Universe",
                                description="Auto-generated NSE cash-stock universe ranked by recent traded value.",
                            )
                            replace_dashboard_universe_members(
                                connection,
                                universe_slug=request_copy.universe_slug,
                                rows=ranked_rows,
                            )
                logger.info(
                    "volume_dashboard.liquidity_rank.warmup_complete as_of_date=%s ranked=%s",
                    as_of_date,
                    len(ranked),
                )
            except Exception as exc:
                logger.exception("volume_dashboard.liquidity_rank.warmup_failed as_of_date=%s error=%s", as_of_date, exc)
            finally:
                with self._liquidity_warmups_lock:
                    self._liquidity_warmups.discard(as_of_date)

        threading.Thread(target=worker, daemon=True, name="volume-dashboard-liquidity-rank").start()

    def _rows_from_liquidity_ranks(
        self,
        request: VolumeBreakoutStartRequest,
        cash_stocks: list[dict[str, Any]],
        curated_by_key: dict[tuple[str, str], dict[str, Any]],
        liquidity_rows: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        ref_by_key = {
            (str(item["symbol"]).strip().upper(), str(item["exchange"]).strip().upper()): item
            for item in cash_stocks
        }
        selected_refdata: list[dict[str, Any]] = []
        selected_universe_rows: list[dict[str, Any]] = []

        for liquidity_row in liquidity_rows:
            key = (str(liquidity_row["symbol"]).strip().upper(), str(liquidity_row["exchange"]).strip().upper())
            item = ref_by_key.get(key)
            if not item:
                continue
            curated_meta = curated_by_key.get(key, {})
            selected_refdata.append(item)
            selected_universe_rows.append(
                {
                    "universe_slug": request.universe_slug,
                    "symbol": key[0],
                    "exchange": key[1],
                    "sector": curated_meta.get("sector"),
                    "industry": curated_meta.get("industry"),
                    "sort_order": len(selected_universe_rows) + 1,
                    "is_active": True,
                }
            )

        return selected_refdata, selected_universe_rows

    def _select_liquidity_ranked_universe(
        self,
        request: VolumeBreakoutStartRequest,
        cash_stocks: list[dict[str, Any]],
        curated_by_key: dict[tuple[str, str], dict[str, Any]],
        *,
        limit: int,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        as_of_date = self._rank_date()
        liquidity_rows = self._load_cached_liquidity_ranks(as_of_date=as_of_date, limit=limit)
        if len(liquidity_rows) < limit:
            self._start_liquidity_rank_warmup(request, cash_stocks, curated_by_key, as_of_date=as_of_date)
        return self._rows_from_liquidity_ranks(request, cash_stocks, curated_by_key, liquidity_rows[:limit])

    def _select_default_universe(self, request: VolumeBreakoutStartRequest) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        cash_stocks = instrument_service.list_cash_stocks(
            session_token=request.session_token,
            environment=request.environment,
            device_id=request.device_id,
            exchanges=("NSE",),
        )
        curated_rows = self._load_curated_universe_rows()
        curated_by_key = {
            (str(row["symbol"]).strip().upper(), str(row["exchange"]).strip().upper()): row
            for row in curated_rows
        }
        ref_by_key = {
            (str(item["symbol"]).strip().upper(), str(item["exchange"]).strip().upper()): item
            for item in cash_stocks
        }

        selected_refdata: list[dict[str, Any]] = []
        selected_universe_rows: list[dict[str, Any]] = []

        if request.universe_mode == "all_nse":
            for item in cash_stocks:
                key = (str(item["symbol"]).strip().upper(), str(item["exchange"]).strip().upper())
                if not self._is_tradeable_equity_symbol(key[0]):
                    continue
                curated_meta = curated_by_key.get(key, {})
                selected_refdata.append(item)
                selected_universe_rows.append(
                    {
                        "universe_slug": request.universe_slug,
                        "symbol": key[0],
                        "exchange": key[1],
                        "sector": curated_meta.get("sector"),
                        "industry": curated_meta.get("industry"),
                        "sort_order": len(selected_universe_rows) + 1,
                        "is_active": True,
                    }
                )
            logger.info(
                "volume_dashboard.default_universe source=nubra_refdata_full_nse selected=%s requested_limit=%s mode=%s",
                len(selected_universe_rows),
                request.universe_limit,
                request.universe_mode,
            )
            return selected_refdata, selected_universe_rows

        curated_limit = min(CURATED_UNIVERSE_LIMITS.get(request.universe_mode, 300), request.universe_limit)
        if self._db_enabled():
            try:
                ranked_refdata, ranked_rows = self._select_liquidity_ranked_universe(
                    request,
                    cash_stocks,
                    curated_by_key,
                    limit=curated_limit,
                )
                if ranked_rows:
                    logger.info(
                        "volume_dashboard.default_universe source=liquidity_rank selected=%s requested_limit=%s mode=%s",
                        len(ranked_rows),
                        request.universe_limit,
                        request.universe_mode,
                    )
                    return ranked_refdata, ranked_rows
            except Exception as exc:
                logger.warning(
                    "volume_dashboard.default_universe liquidity_rank_failed mode=%s error=%s",
                    request.universe_mode,
                    exc,
                )

        for row in curated_rows:
            key = (str(row["symbol"]).strip().upper(), str(row["exchange"]).strip().upper())
            if not self._is_tradeable_equity_symbol(key[0]):
                continue
            item = ref_by_key.get(key)
            if not item:
                continue
            selected_refdata.append(item)
            selected_universe_rows.append(
                {
                    "universe_slug": request.universe_slug,
                    "symbol": key[0],
                    "exchange": key[1],
                    "sector": row.get("sector"),
                    "industry": row.get("industry"),
                    "sort_order": len(selected_universe_rows) + 1,
                    "is_active": True,
                }
            )
            if len(selected_universe_rows) >= curated_limit:
                break

        if selected_universe_rows:
            logger.info(
                "volume_dashboard.default_universe source=curated_csv selected=%s requested_limit=%s mode=%s",
                len(selected_universe_rows),
                request.universe_limit,
                request.universe_mode,
            )
            return selected_refdata, selected_universe_rows

        fallback = cash_stocks[: curated_limit]
        logger.warning(
            "volume_dashboard.default_universe source=refdata_fallback selected=%s requested_limit=%s mode=%s",
            len(fallback),
            request.universe_limit,
            request.universe_mode,
        )
        return fallback, [
            {
                "universe_slug": request.universe_slug,
                "symbol": str(item["symbol"]).strip().upper(),
                "exchange": str(item["exchange"]).strip().upper(),
                "sector": None,
                "industry": None,
                "sort_order": index + 1,
                "is_active": True,
            }
            for index, item in enumerate(fallback)
        ]

    def _ensure_universe(self, runtime: VolumeBreakoutRuntime) -> list[dict[str, Any]]:
        request = runtime.request
        if not self._db_enabled():
            runtime.sync.db_enabled = False
            runtime.sync.cache_mode = "memory"
            items, selected_rows = self._select_default_universe(request)
            runtime.universe_rows = [
                {
                    **row,
                    "display_name": str(item["display_name"]).strip().upper(),
                }
                for row, item in zip(selected_rows, items, strict=False)
            ]
            runtime.sync.universe_ready = bool(runtime.universe_rows)
            logger.info(
                "volume_dashboard.ensure_universe memory universe_ready=%s count=%s",
                runtime.sync.universe_ready,
                len(runtime.universe_rows),
            )
            return runtime.universe_rows

        runtime.sync.db_enabled = True
        runtime.sync.cache_mode = "database"
        with connect_db() as connection:
            members = load_dashboard_universe_members(connection, universe_slug=request.universe_slug)
            members = [
                row for row in members
                if self._is_tradeable_equity_symbol(str(row.get("symbol") or ""))
            ]
            if members:
                if request.universe_mode in CURATED_UNIVERSE_LIMITS:
                    curated_limit = min(CURATED_UNIVERSE_LIMITS[request.universe_mode], request.universe_limit)
                    cached_ranks = load_stock_liquidity_ranks(
                        connection,
                        exchange="NSE",
                        as_of_date=self._rank_date(),
                        limit=curated_limit,
                    )
                    if len(cached_ranks) >= curated_limit:
                        chosen_items, ranked_rows = self._select_default_universe(request)
                        if ranked_rows:
                            current_symbols = [str(row["symbol"]).strip().upper() for row in members]
                            ranked_symbols = [str(row["symbol"]).strip().upper() for row in ranked_rows]
                            if current_symbols != ranked_symbols:
                                upsert_instruments(connection, self._instrument_rows_from_refdata(chosen_items))
                                upsert_dashboard_universe(
                                    connection,
                                    slug=request.universe_slug,
                                    title="Volume Dashboard Liquidity Ranked Universe",
                                    description="Auto-generated NSE cash-stock universe ranked by recent traded value.",
                                )
                                replace_dashboard_universe_members(
                                    connection,
                                    universe_slug=request.universe_slug,
                                    rows=ranked_rows,
                                )
                                members = load_dashboard_universe_members(connection, universe_slug=request.universe_slug)
                                logger.info(
                                    "volume_dashboard.ensure_universe db_refreshed_from_liquidity_rank universe_slug=%s count=%s",
                                    request.universe_slug,
                                    len(members),
                                )
                    else:
                        # Existing fallback members keep the UI warm, but they must not prevent
                        # the background ranker from producing the real Top 120/300 universe.
                        self._select_default_universe(request)
                runtime.sync.universe_ready = True
                runtime.universe_rows = members
                logger.info(
                    "volume_dashboard.ensure_universe db_hit universe_slug=%s count=%s default_universe=%s",
                    request.universe_slug,
                    len(members),
                    self._is_default_dashboard_universe(request.universe_slug),
                )
                return members

            chosen_items, default_rows = self._select_default_universe(request)
            upsert_instruments(connection, self._instrument_rows_from_refdata(chosen_items))
            upsert_dashboard_universe(
                connection,
                slug=request.universe_slug,
                title="Volume Dashboard Default Universe",
                description="Auto-generated NSE cash-stock universe for the API-first volume dashboard.",
            )
            replace_dashboard_universe_members(connection, universe_slug=request.universe_slug, rows=default_rows)
            members = load_dashboard_universe_members(connection, universe_slug=request.universe_slug)

        runtime.sync.universe_ready = bool(members)
        runtime.universe_rows = members
        logger.info(
            "volume_dashboard.ensure_universe db_seeded universe_slug=%s count=%s",
            request.universe_slug,
            len(members),
        )
        return members

    def _load_base_frames_from_db(
        self,
        runtime: VolumeBreakoutRuntime,
        delta_only: bool = False,
        target_rows: list[dict[str, Any]] | None = None,
    ) -> dict[str, pd.DataFrame]:
        if not runtime.sync.db_enabled:
            return runtime.base_frames
        target_symbols = {
            str(row.get("symbol") or "").strip().upper()
            for row in target_rows or []
            if str(row.get("symbol") or "").strip()
        }
        with connect_db() as connection:
            if delta_only and runtime.symbol_latest_timestamps:
                rows = load_ohlcv_1m_bars_delta(
                    connection,
                    universe_slug=runtime.request.universe_slug,
                    symbol_since=runtime.symbol_latest_timestamps,
                )
            else:
                rows = load_ohlcv_1m_bars(
                    connection,
                    universe_slug=runtime.request.universe_slug,
                    since_timestamp=self._history_start_ist(runtime.request.lookback_days).astimezone(UTC),
                    symbols=target_symbols or None,
                )
        new_frames = self._rows_to_frames(rows)
        if delta_only and new_frames:
            self._merge_memory_frames(runtime, new_frames)
            return runtime.base_frames
        return new_frames

    def _hydrate_db_cache_state(
        self,
        runtime: VolumeBreakoutRuntime,
        *,
        end_ist: datetime,
    ) -> dict[tuple[str, str], datetime]:
        if not runtime.sync.db_enabled:
            runtime.sync.symbols_synced = len(runtime.base_frames)
            runtime.sync.symbols_missing_history = max(runtime.universe_size - len(runtime.base_frames), 0)
            return {}

        latest_buckets: dict[tuple[str, str], datetime]
        with connect_db() as connection:
            latest_buckets = load_latest_ohlcv_1m_bars(connection, universe_slug=runtime.request.universe_slug)

        runtime.base_frames = self._load_base_frames_from_db(runtime)
        runtime.symbol_latest_timestamps = latest_buckets
        runtime.sync.symbols_synced = len(runtime.base_frames)
        runtime.sync.symbols_missing_history = max(runtime.universe_size - len(runtime.base_frames), 0)
        history_start = self._history_start_ist(runtime.request.lookback_days)
        runtime.sync.history_range_ist = (
            f"{history_start.strftime('%d %b %H:%M')} - {end_ist.strftime('%d %b %H:%M %Z')}"
        )
        return latest_buckets

    def _symbols_needing_sync(
        self,
        runtime: VolumeBreakoutRuntime,
        *,
        latest_buckets: dict[tuple[str, str], datetime],
        end_ist: datetime,
    ) -> list[str]:
        sync_cutoff_utc = (end_ist - timedelta(minutes=INTERVAL_MINUTES["1m"])).astimezone(UTC)
        missing_or_stale: list[str] = []
        for row in runtime.universe_rows:
            symbol = str(row.get("symbol") or "").strip().upper()
            exchange = str(row.get("exchange") or "NSE").strip().upper()
            latest_bucket = latest_buckets.get((symbol, exchange))
            if latest_bucket is None or latest_bucket < sync_cutoff_utc:
                missing_or_stale.append(symbol)
        runtime.sync.symbols_missing_history = len(missing_or_stale)
        return missing_or_stale

    def _start_eod_cache_warmup(
        self,
        runtime: VolumeBreakoutRuntime,
        *,
        end_ist: datetime,
        reason: str,
    ) -> None:
        def run() -> None:
            logger.info(
                "volume_dashboard.eod.background_sync.start reason=%s universe=%s",
                reason,
                runtime.universe_size,
            )
            try:
                with self._sync_lock:
                    self._sync_history(runtime, end_ist=end_ist)
            except Exception as exc:
                runtime.last_error = str(exc)
                logger.exception("volume_dashboard.eod.background_sync.failed error=%s", exc)
                return
            logger.info(
                "volume_dashboard.eod.background_sync.complete universe=%s synced=%s missing=%s",
                runtime.universe_size,
                runtime.sync.symbols_synced,
                runtime.sync.symbols_missing_history,
            )

        threading.Thread(
            target=run,
            daemon=True,
            name="volume-dashboard-eod-cache-warmup",
        ).start()

    def _rows_to_frames(self, rows: list[dict[str, Any]]) -> dict[str, pd.DataFrame]:
        if not rows:
            return {}
        frames: dict[str, pd.DataFrame] = {}
        for symbol, symbol_rows in pd.DataFrame(rows).groupby("symbol", sort=True):
            frame = symbol_rows.copy()
            frame["bucket_timestamp"] = pd.to_datetime(frame["bucket_timestamp"], utc=True).dt.tz_convert(IST)
            frame = frame.sort_values("bucket_timestamp").drop_duplicates(subset=["bucket_timestamp"], keep="last")
            frame = frame.set_index("bucket_timestamp")
            base = pd.DataFrame(
                {
                    "open": pd.to_numeric(frame["open_price"], errors="coerce"),
                    "high": pd.to_numeric(frame["high_price"], errors="coerce"),
                    "low": pd.to_numeric(frame["low_price"], errors="coerce"),
                    "close": pd.to_numeric(frame["close_price"], errors="coerce"),
                    "bucket_volume": pd.to_numeric(frame["bucket_volume"], errors="coerce"),
                    "cumulative_volume": pd.to_numeric(frame["cumulative_volume"], errors="coerce"),
                }
            ).dropna(subset=["open", "high", "low", "close"], how="any")
            if not base.empty:
                frames[str(symbol).strip().upper()] = base
        return frames

    def _prepare_frame(self, frame: pd.DataFrame, interval: str) -> pd.DataFrame:
        working = frame.sort_index()
        if interval != "1m":
            working = self._resample_frame(working, interval)
        if working.empty:
            return working
        working["session_date"] = pd.Index(working.index.date)
        working["time_slot"] = working.index.strftime("%H:%M:%S")
        return working

    def _resample_frame(self, frame: pd.DataFrame, interval: str) -> pd.DataFrame:
        rule = INTERVAL_RULES[interval]
        session_frames: list[pd.DataFrame] = []
        for _, session_frame in frame.groupby(frame.index.date):
            resampled = session_frame.resample(
                rule,
                label="right",
                closed="right",
                origin="start_day",
                offset="15min",
            ).agg(
                {
                    "open": "first",
                    "high": "max",
                    "low": "min",
                    "close": "last",
                    "bucket_volume": "sum",
                    "cumulative_volume": "last",
                }
            )
            resampled = resampled.dropna(subset=["open", "high", "low", "close"], how="any")
            if not resampled.empty:
                session_frames.append(resampled)
        if not session_frames:
            return pd.DataFrame(columns=frame.columns)
        return pd.concat(session_frames).sort_index()

    def _drop_incomplete_candle(self, frame: pd.DataFrame, interval: str) -> pd.DataFrame:
        if frame.empty:
            return frame
        latest_ts = frame.index[-1]
        if self._current_ist() < latest_ts + timedelta(minutes=INTERVAL_MINUTES[interval]):
            return frame.iloc[:-1].copy()
        return frame.copy()

    def _baseline_volumes(self, frame: pd.DataFrame, current_ts: pd.Timestamp, lookback_days: int) -> pd.Series:
        session_dates = sorted(pd.unique(frame["session_date"]))
        previous_sessions = [session_date for session_date in session_dates if session_date < current_ts.date()]
        baseline_sessions = previous_sessions[-lookback_days:]
        time_slot = current_ts.strftime("%H:%M:%S")
        mask = frame["session_date"].isin(baseline_sessions) & (frame["time_slot"] == time_slot)
        baseline = frame.loc[mask, "bucket_volume"].dropna()
        if len(baseline) >= min(lookback_days, MIN_BASELINE_SESSIONS):
            return baseline
        trailing = frame.loc[frame.index < current_ts, "bucket_volume"].dropna().tail(max(lookback_days * 3, 20))
        return trailing

    def _prior_price_bars(self, frame: pd.DataFrame, current_ts: pd.Timestamp, lookback_days: int) -> pd.DataFrame:
        current_session = current_ts.date()
        session_dates = sorted(pd.unique(frame["session_date"]))
        previous_sessions = [session_date for session_date in session_dates if session_date < current_session]
        relevant_sessions = previous_sessions[-lookback_days:] + [current_session]
        mask = frame["session_date"].isin(relevant_sessions) & (frame.index < current_ts)
        return frame.loc[mask]

    def _scan_symbol(
        self,
        meta: dict[str, Any],
        frame: pd.DataFrame,
        request: VolumeBreakoutStartRequest,
    ) -> VolumeBreakoutStockRow | None:
        symbol = str(meta.get("symbol") or "").strip().upper()
        if not self._is_tradeable_equity_symbol(symbol):
            return None
        working = self._drop_incomplete_candle(self._prepare_frame(frame, request.interval), request.interval)
        if len(working) < 2:
            return None

        latest = working.iloc[-1]
        current_ts = working.index[-1]
        baseline = self._baseline_volumes(working, current_ts, request.lookback_days)
        baseline_days = int(len(baseline))
        if baseline_days < min(request.lookback_days, MIN_BASELINE_SESSIONS):
            return None

        average_volume = float(baseline.mean())
        current_volume = float(latest["bucket_volume"]) if pd.notna(latest["bucket_volume"]) else 0.0
        if average_volume <= 0 or current_volume <= 0:
            return None

        volume_ratio = current_volume / average_volume
        prior_bars = self._prior_price_bars(working, current_ts, request.lookback_days)
        lookback_high = float(prior_bars["high"].max()) if not prior_bars.empty else float("nan")
        prev_close = float(working.iloc[-2]["close"])
        current_close = float(latest["close"])
        current_open = float(latest["open"])
        if (
            average_volume < SCAN_MIN_AVERAGE_VOLUME
            or current_volume < SCAN_MIN_CURRENT_VOLUME
            or current_close * average_volume < SCAN_MIN_AVERAGE_TRADED_VALUE
        ):
            return None
        day_open_candidates = working.loc[working["session_date"] == current_ts.date(), "open"]
        day_open = float(day_open_candidates.iloc[0]) if not day_open_candidates.empty else current_open
        price_change_pct = ((current_close - prev_close) / prev_close * 100.0) if prev_close > 0 else None
        day_change_pct = ((current_close - day_open) / day_open * 100.0) if day_open > 0 else None
        price_breakout_pct = (
            ((current_close - lookback_high) / lookback_high * 100.0)
            if pd.notna(lookback_high) and lookback_high > 0
            else None
        )
        is_price_breakout = bool(pd.notna(lookback_high) and current_close > lookback_high)

        return VolumeBreakoutStockRow(
            symbol=str(meta["symbol"]),
            display_name=str(meta.get("display_name") or meta["symbol"]),
            exchange=str(meta.get("exchange") or "NSE"),
            sector=str(meta.get("sector")).strip() if meta.get("sector") else None,
            industry=str(meta.get("industry")).strip() if meta.get("industry") else None,
            candle_time_ist=current_ts.strftime("%Y-%m-%d %H:%M:%S %Z"),
            last_price=round(current_close, 2),
            current_volume=round(current_volume, 2),
            average_volume=round(average_volume, 2),
            volume_ratio=round(volume_ratio, 2),
            price_change_pct=round(price_change_pct, 2) if price_change_pct is not None else None,
            day_change_pct=round(day_change_pct, 2) if day_change_pct is not None else None,
            price_breakout_pct=round(price_breakout_pct, 2) if price_breakout_pct is not None else None,
            is_green=current_close >= current_open,
            is_price_breakout=is_price_breakout,
            meets_breakout=volume_ratio >= request.min_volume_ratio,
            baseline_days=baseline_days,
        )

    def _latest_candle_label(self, frames: list[pd.DataFrame], interval: str) -> str | None:
        latest_ts = self._latest_candle_timestamp(frames, interval)
        return latest_ts.strftime("%Y-%m-%d %H:%M:%S %Z") if latest_ts is not None else None

    def _latest_candle_timestamp(self, frames: list[pd.DataFrame], interval: str) -> pd.Timestamp | None:
        latest_timestamps: list[pd.Timestamp] = []
        for frame in frames:
            working = self._drop_incomplete_candle(self._prepare_frame(frame, interval), interval)
            if not working.empty:
                latest_timestamps.append(working.index[-1])
        if not latest_timestamps:
            return None
        return max(latest_timestamps)

    def _scan_batch_symbols(
        self,
        runtime: VolumeBreakoutRuntime,
        symbols: list[str],
    ) -> tuple[list[VolumeBreakoutStockRow], pd.Timestamp | None]:
        """Scan only specific symbols and return results + latest candle timestamp."""
        rows: list[VolumeBreakoutStockRow] = []
        prepared_frames: list[pd.DataFrame] = []
        for symbol in symbols:
            symbol_upper = str(symbol).strip().upper()
            meta = next((row for row in runtime.universe_rows if str(row.get("symbol") or "").strip().upper() == symbol_upper), None)
            if not meta:
                continue
            frame = runtime.base_frames.get(symbol_upper)
            if frame is None or frame.empty:
                continue
            prepared_frames.append(frame)
            row = self._scan_symbol(meta, frame, runtime.request)
            if row:
                rows.append(row)

        latest_candle_ts = self._latest_candle_timestamp(prepared_frames, runtime.request.interval)
        return rows, latest_candle_ts

    def _merge_scan_results(
        self,
        runtime: VolumeBreakoutRuntime,
        new_rows: list[VolumeBreakoutStockRow],
        latest_candle_ts: pd.Timestamp | None,
    ) -> None:
        """Incrementally merge partial scan rows into the live dashboard state."""
        if not new_rows:
            return

        latest_session_date = latest_candle_ts.date() if latest_candle_ts is not None else None
        live_rows = [
            item
            for item in new_rows
            if latest_session_date is None or item.candle_time_ist.startswith(latest_session_date.isoformat())
        ]

        if not live_rows:
            return

        for row in live_rows:
            runtime.partial_scan_rows[row.symbol] = row

        merged_rows = list(runtime.partial_scan_rows.values())
        merged_rows.sort(key=lambda item: (-item.volume_ratio, -(item.current_volume), item.symbol))
        breakout_rows = [item for item in merged_rows if item.meets_breakout]
        current_keys = {f"{item.symbol}:{item.candle_time_ist}" for item in breakout_rows}
        fresh_rows = [item for item in breakout_rows if f"{item.symbol}:{item.candle_time_ist}" not in runtime.last_breakout_keys]
        confirmed_rows = [item for item in breakout_rows if item.is_price_breakout]
        movers_up = sorted(
            [item for item in merged_rows if (item.day_change_pct or 0) > 0],
            key=lambda item: (-(item.day_change_pct or 0), -item.volume_ratio, item.symbol),
        )
        movers_down = sorted(
            [item for item in merged_rows if (item.day_change_pct or 0) < 0],
            key=lambda item: ((item.day_change_pct or 0), -item.volume_ratio, item.symbol),
        )

        runtime.last_breakout_keys = current_keys
        runtime.market_breakouts = merged_rows[: runtime.request.limit]
        runtime.recent_breakouts = fresh_rows[: runtime.request.limit]
        runtime.confirmed_breakouts = confirmed_rows[: runtime.request.limit]
        runtime.movers_up = movers_up[: runtime.request.limit]
        runtime.movers_down = movers_down[: runtime.request.limit]
        runtime.summary = VolumeBreakoutSummary(
            tracked_stocks=len(merged_rows),
            active_breakouts=len(breakout_rows),
            fresh_breakouts=len(fresh_rows),
            leaders_with_price_breakout=len(confirmed_rows),
            latest_candle_ist=latest_candle_ts.strftime("%Y-%m-%d %H:%M:%S %Z") if latest_candle_ts is not None else runtime.summary.latest_candle_ist,
            market_status="bootstrapping" if len(merged_rows) < runtime.universe_size else "running",
        )
        runtime.last_run_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.next_run_ist = (
            self._current_ist() + timedelta(seconds=runtime.request.refresh_seconds)
        ).strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.sync.next_refresh_ist = runtime.next_run_ist
        self._persist_snapshot(runtime)

    def _run_scan(self, runtime: VolumeBreakoutRuntime) -> None:
        rows: list[VolumeBreakoutStockRow] = []
        prepared_frames: list[pd.DataFrame] = []
        for item in runtime.universe_rows:
            symbol = str(item["symbol"]).strip().upper()
            frame = runtime.base_frames.get(symbol)
            if frame is None or frame.empty:
                continue
            prepared_frames.append(frame)
            row = self._scan_symbol(item, frame, runtime.request)
            if row:
                rows.append(row)

        latest_candle_ts = self._latest_candle_timestamp(prepared_frames, runtime.request.interval)
        latest_session_date = latest_candle_ts.date() if latest_candle_ts is not None else None
        live_rows = [
            item
            for item in rows
            if latest_session_date is None or item.candle_time_ist.startswith(latest_session_date.isoformat())
        ]
        stale_rows = len(rows) - len(live_rows)
        if stale_rows:
            logger.info(
                "volume_dashboard.scan.filtered_stale_rows stale=%s live=%s latest_session_date=%s",
                stale_rows,
                len(live_rows),
                latest_session_date,
            )

        live_rows.sort(key=lambda item: (-item.volume_ratio, -(item.current_volume), item.symbol))
        breakout_rows = [item for item in live_rows if item.meets_breakout]
        current_keys = {f"{item.symbol}:{item.candle_time_ist}" for item in breakout_rows}
        fresh_rows = [item for item in breakout_rows if f"{item.symbol}:{item.candle_time_ist}" not in runtime.last_breakout_keys]
        confirmed_rows = [item for item in breakout_rows if item.is_price_breakout]
        movers_up = sorted(
            [item for item in live_rows if (item.day_change_pct or 0) > 0],
            key=lambda item: (-(item.day_change_pct or 0), -item.volume_ratio, item.symbol),
        )
        movers_down = sorted(
            [item for item in live_rows if (item.day_change_pct or 0) < 0],
            key=lambda item: ((item.day_change_pct or 0), -item.volume_ratio, item.symbol),
        )

        runtime.last_breakout_keys = current_keys
        runtime.partial_scan_rows = {item.symbol: item for item in live_rows}
        runtime.market_breakouts = live_rows[: runtime.request.limit]
        runtime.recent_breakouts = fresh_rows[: runtime.request.limit]
        runtime.confirmed_breakouts = confirmed_rows[: runtime.request.limit]
        runtime.movers_up = movers_up[: runtime.request.limit]
        runtime.movers_down = movers_down[: runtime.request.limit]
        runtime.summary = VolumeBreakoutSummary(
            tracked_stocks=len(live_rows),
            active_breakouts=len(breakout_rows),
            fresh_breakouts=len(fresh_rows),
            leaders_with_price_breakout=len(confirmed_rows),
            latest_candle_ist=latest_candle_ts.strftime("%Y-%m-%d %H:%M:%S %Z") if latest_candle_ts is not None else None,
            market_status="running" if runtime.universe_size else "idle",
        )
        runtime.last_run_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.next_run_ist = (
            self._current_ist() + timedelta(seconds=runtime.request.refresh_seconds)
        ).strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.sync.next_refresh_ist = runtime.next_run_ist
        runtime.last_error = None
        self._persist_snapshot(runtime)

    def _sector_heatmap_rows(self, runtime: VolumeBreakoutRuntime) -> list[VolumeBreakoutStockRow]:
        rows = list(runtime.partial_scan_rows.values())
        if not rows:
            rows = (
                list(runtime.market_breakouts)
                + list(runtime.recent_breakouts)
                + list(runtime.confirmed_breakouts)
                + list(runtime.movers_up)
                + list(runtime.movers_down)
            )
        by_symbol: dict[str, VolumeBreakoutStockRow] = {}
        for row in rows:
            if not row.sector:
                continue
            by_symbol[row.symbol] = row
        return sorted(
            by_symbol.values(),
            key=lambda item: (
                -int(item.meets_breakout),
                -int(item.is_price_breakout),
                -max(item.volume_ratio, 0),
                -abs(item.day_change_pct or 0),
                item.symbol,
            ),
        )[:500]

    def _to_db_rows(
        self,
        frames: dict[str, pd.DataFrame],
        *,
        exchange: str,
    ) -> list[dict[str, Any]]:
        return market_history_service.to_db_rows(frames, exchange=exchange, source="volume_dashboard_rest_sync")

    def _merge_memory_frames(self, runtime: VolumeBreakoutRuntime, frames: dict[str, pd.DataFrame]) -> None:
        for symbol, frame in frames.items():
            existing = runtime.base_frames.get(symbol)
            if existing is None or existing.empty:
                runtime.base_frames[symbol] = frame.copy()
            else:
                merged = pd.concat([existing, frame]).sort_index()
                merged = merged[~merged.index.duplicated(keep="last")]
                runtime.base_frames[symbol] = merged

    def _sync_history(
        self,
        runtime: VolumeBreakoutRuntime,
        *,
        end_ist: datetime | None = None,
        on_batch_complete: Callable[[list[str], int, int, int], None] | None = None,
        target_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        request = runtime.request
        history_start_ist = self._history_start_ist(request.lookback_days)
        sync_end_ist = end_ist or self._history_end_ist()
        latest_buckets: dict[tuple[str, str], datetime] = {}

        if runtime.sync.db_enabled:
            with connect_db() as connection:
                latest_buckets = load_latest_ohlcv_1m_bars(connection, universe_slug=request.universe_slug)

        synced_symbols = 0
        missing_symbols = 0
        exchange_groups: dict[str, list[dict[str, Any]]] = {}
        rows_to_sync = target_rows if target_rows is not None else runtime.universe_rows
        for row in rows_to_sync:
            exchange_groups.setdefault(str(row.get("exchange") or "NSE").upper(), []).append(row)

        total_batches = sum(
            len(list(self._chunked(rows, 10))) for rows in exchange_groups.values()
        )
        done_batches = 0
        total_symbols = len(rows_to_sync)

        for exchange, rows in exchange_groups.items():
            for batch in self._chunked(rows, 10):
                symbols = [str(item["symbol"]).strip().upper() for item in batch]

                syncing_symbols = [s for s in symbols if self._is_symbol_syncing(runtime, s)]
                symbols_to_fetch = [s for s in symbols if s not in syncing_symbols]

                if syncing_symbols:
                    logger.info(
                        "volume_dashboard.sync_history.skip_in_flight exchange=%s symbols=%s reason=already_syncing",
                        exchange,
                        syncing_symbols,
                    )
                    synced_symbols += len(syncing_symbols)

                if not symbols_to_fetch:
                    done_batches += 1
                    if on_batch_complete:
                        on_batch_complete(symbols_to_fetch or syncing_symbols, 0, done_batches, total_batches)
                    continue

                batch_latest = [latest_buckets.get((symbol, exchange)) for symbol in symbols_to_fetch]
                if any(item is None for item in batch_latest):
                    missing_symbols += sum(1 for item in batch_latest if item is None)
                    start_dt = history_start_ist
                else:
                    earliest_latest = min(item for item in batch_latest if item is not None)
                    start_dt = max(history_start_ist, earliest_latest.astimezone(IST) - timedelta(minutes=10))

                self._push_event({
                    "type": "sync_progress",
                    "payload": {
                        "phase": "batch_start",
                        "message": f"Checking {len(symbols_to_fetch)} symbols: {', '.join(symbols_to_fetch[:3])}{'...' if len(symbols_to_fetch) > 3 else ''}",
                        "pct_complete": int(done_batches / total_batches * 100) if total_batches else 100,
                        "symbols_done": min(done_batches * 10, total_symbols),
                        "symbols_total": total_symbols,
                        "batch_index": done_batches + 1,
                        "total_batches": total_batches,
                        "current_symbols": symbols_to_fetch,
                        "bars_written": 0,
                    },
                })

                if start_dt >= sync_end_ist:
                    synced_symbols += len(symbols_to_fetch)
                    done_batches += 1
                    if on_batch_complete:
                        on_batch_complete(symbols_to_fetch, 0, done_batches, total_batches)
                    continue

                self._mark_sync_start(runtime, symbols_to_fetch)
                logger.info(
                    "volume_dashboard.sync_history.batch exchange=%s symbols=%s start=%s end=%s",
                    exchange,
                    symbols_to_fetch,
                    start_dt.isoformat(),
                    sync_end_ist.isoformat(),
                )
                try:
                    frames = market_history_service.fetch(
                        HistoricalFetchRequest(
                            session_token=request.session_token,
                            device_id=request.device_id,
                            environment=request.environment,
                            symbols=tuple(symbols_to_fetch),
                            exchange=exchange,
                            interval="1m",
                            start_dt=start_dt,
                            end_dt=sync_end_ist,
                        )
                    )
                except HTTPException as exc:
                    logger.warning(
                        "volume_dashboard.sync_history.batch_skipped status=%s exchange=%s symbols=%s detail=%s",
                        exc.status_code,
                        exchange,
                        symbols_to_fetch,
                        exc.detail,
                    )
                    runtime.last_error = f"Skipped {len(symbols_to_fetch)} symbols during history sync: {exc.detail}"
                    self._mark_sync_complete(runtime, symbols_to_fetch)
                    done_batches += 1
                    if on_batch_complete:
                        on_batch_complete(symbols_to_fetch, 0, done_batches, total_batches)
                    continue
                if runtime.sync.db_enabled:
                    with connect_db() as connection:
                        rows_written = upsert_ohlcv_1m_bars(connection, self._to_db_rows(frames, exchange=exchange))
                        logger.info(
                            "volume_dashboard.sync_history.persist exchange=%s symbols=%s frame_symbols=%s rows_written=%s",
                            exchange,
                            symbols_to_fetch,
                            list(frames.keys()),
                            rows_written,
                        )
                self._merge_memory_frames(runtime, frames)
                self._mark_sync_complete(runtime, symbols_to_fetch)
                synced_symbols += len(symbols_to_fetch)
                done_batches += 1
                if on_batch_complete:
                    on_batch_complete(symbols_to_fetch, len(frames), done_batches, total_batches)

        if runtime.sync.db_enabled:
            runtime.base_frames = self._load_base_frames_from_db(runtime)
            with connect_db() as connection:
                runtime.symbol_latest_timestamps = load_latest_ohlcv_1m_bars(connection, universe_slug=runtime.request.universe_slug)
        runtime.sync.symbols_synced = len(runtime.base_frames)
        runtime.sync.symbols_missing_history = max(runtime.universe_size - len(runtime.base_frames), 0)
        runtime.sync.history_range_ist = (
            f"{history_start_ist.strftime('%d %b %H:%M')} - {sync_end_ist.strftime('%d %b %H:%M %Z')}"
        )
        runtime.sync.last_history_sync_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
        logger.info(
            "volume_dashboard.sync_history.complete universe=%s synced=%s missing=%s db_enabled=%s",
            runtime.universe_size,
            runtime.sync.symbols_synced,
            runtime.sync.symbols_missing_history,
            runtime.sync.db_enabled,
        )
        if runtime.universe_size and not runtime.base_frames:
            raise ValueError("Nubra returned no historical candles for the current volume-dashboard universe.")

    def _sync_and_scan(self, runtime: VolumeBreakoutRuntime) -> None:
        runtime.universe_rows = self._ensure_universe(runtime)
        runtime.universe_size = len(runtime.universe_rows)
        if not runtime.universe_rows:
            raise ValueError("Unable to build a stock universe from Nubra refdata for the volume dashboard.")
        with self._sync_lock:
            self._sync_history(runtime)
        self._run_scan(runtime)

    def _gap_fill_background(self, runtime: VolumeBreakoutRuntime) -> None:
        t_start = _time.monotonic()
        total_bars_written = 0
        if not runtime.universe_rows:
            logger.info("volume_dashboard.gap_fill.deferred reason=universe_not_ready")
            return
        self._push_event({
            "type": "sync_progress",
            "payload": {
                "phase": "gap_fill_start",
                "message": "Checking cached bars and filling missing history.",
                "pct_complete": 0,
                "symbols_done": 0,
                "universe_size": runtime.universe_size,
                "symbols_total": runtime.universe_size,
                "symbols_synced": runtime.sync.symbols_synced,
                "symbols_missing_history": runtime.sync.symbols_missing_history,
                "bars_written": 0,
            },
        })

        def on_batch_complete(symbols: list[str], bars_written: int, done_batches: int, total_batches: int) -> None:
            nonlocal total_bars_written
            total_bars_written += bars_written
            if runtime.sync.db_enabled and bars_written > 0:
                self._load_base_frames_from_db(runtime, delta_only=True)
                for symbol in symbols:
                    if symbol in runtime.base_frames:
                        frame = runtime.base_frames[symbol]
                        if not frame.empty:
                            latest_ts = frame.index[-1]
                            runtime.symbol_latest_timestamps[(symbol, "NSE")] = pd.Timestamp(latest_ts).to_pydatetime().astimezone(UTC)
            runtime.sync.symbols_synced = len(runtime.base_frames)
            runtime.sync.symbols_missing_history = max(runtime.universe_size - runtime.sync.symbols_synced, 0)
            try:
                self._run_scan(runtime)
                runtime.last_snapshot_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
            except Exception as exc:
                logger.exception("volume_dashboard.gap_fill.batch_scan_failed error=%s", exc)
            pct = int(done_batches / total_batches * 100) if total_batches else 100
            self._push_event({
                "type": "scan_update",
                "payload": {
                    **self._scan_payload(runtime, is_partial=True),
                    "gap_fill_progress": {
                        "phase": "batch_complete",
                        "message": f"Updated {len(symbols)} symbols; rescanning leaders.",
                        "pct_complete": pct,
                        "symbols_done": min(done_batches * 10, runtime.universe_size),
                        "symbols_total": runtime.universe_size,
                        "batch_index": done_batches,
                        "total_batches": total_batches,
                        "current_symbols": symbols,
                        "bars_written": total_bars_written,
                    },
                },
            })

        try:
            with self._sync_lock:
                self._sync_history(runtime, on_batch_complete=on_batch_complete)
        except Exception as exc:
            runtime.last_error = str(exc)

        duration = round(_time.monotonic() - t_start, 1)
        try:
            self._run_scan(runtime)
            self._push_event({"type": "scan_update", "payload": self._scan_payload(runtime, is_partial=False)})
        except Exception as exc:
            logger.exception("volume_dashboard.gap_fill.final_scan_failed error=%s", exc)
        self._push_event({
            "type": "gap_fill_complete",
            "payload": {
                "total_bars_written": total_bars_written,
                "duration_seconds": duration,
            },
        })

    def _run_loop(self) -> None:
        first_cycle = True
        while not self._stop_event.wait(0):
            with self._lock:
                runtime = self._runtime
            if runtime is None:
                return

            if first_cycle:
                first_cycle = False
                if self._stop_event.wait(runtime.request.refresh_seconds):
                    return

            try:
                self._sync_and_scan(runtime)
                self._push_event({"type": "scan_update", "payload": self._scan_payload(runtime)})
            except Exception as exc:
                runtime.last_error = str(exc)
                runtime.summary.market_status = "error"

            if self._stop_event.wait(runtime.request.refresh_seconds):
                return

    def _snapshot_from(self, runtime: VolumeBreakoutRuntime, is_cached: bool = False) -> VolumeBreakoutStatusResponse:
        return VolumeBreakoutStatusResponse(
            running=runtime.running,
            universe_slug=runtime.request.universe_slug,
            universe_mode=runtime.request.universe_mode,
            universe_label=self._universe_label(runtime.request.universe_mode),
            interval=runtime.request.interval,
            lookback_days=runtime.request.lookback_days,
            refresh_seconds=runtime.request.refresh_seconds,
            min_volume_ratio=runtime.request.min_volume_ratio,
            universe_size=runtime.universe_size,
            sync=runtime.sync,
            last_run_ist=runtime.last_run_ist,
            next_run_ist=runtime.next_run_ist,
            last_error=runtime.last_error,
            summary=runtime.summary,
            market_breakouts=list(runtime.market_breakouts),
            recent_breakouts=list(runtime.recent_breakouts),
            confirmed_breakouts=list(runtime.confirmed_breakouts),
            movers_up=list(runtime.movers_up),
            movers_down=list(runtime.movers_down),
            sector_heatmap_rows=self._sector_heatmap_rows(runtime),
            is_cached_snapshot=is_cached,
        )

    def _snapshot(self) -> VolumeBreakoutStatusResponse:
        runtime = self._runtime
        if runtime is None:
            return VolumeBreakoutStatusResponse(
                running=False,
                universe_slug="volume-dashboard-liquidity-top300",
                universe_mode="top300",
                universe_label=self._universe_label("top300"),
                interval="5m",
                lookback_days=10,
                refresh_seconds=30,
                min_volume_ratio=1.5,
                universe_size=0,
                sync=VolumeBreakoutSyncStatus(
                    db_enabled=False,
                    cache_mode="memory",
                    universe_ready=False,
                    symbols_synced=0,
                    symbols_missing_history=0,
                    history_range_ist=None,
                    last_history_sync_ist=None,
                    next_refresh_ist=None,
                ),
                last_run_ist=None,
                next_run_ist=None,
                last_error=None,
                summary=VolumeBreakoutSummary(
                    tracked_stocks=0,
                    active_breakouts=0,
                    fresh_breakouts=0,
                    leaders_with_price_breakout=0,
                    latest_candle_ist=None,
                    market_status="idle",
                ),
                market_breakouts=[],
                recent_breakouts=[],
                confirmed_breakouts=[],
                movers_up=[],
                movers_down=[],
                is_cached_snapshot=False,
            )
        return self._snapshot_from(runtime)

    def _get_last_cached_snapshot(self) -> VolumeBreakoutStatusResponse | None:
        with self._lock:
            runtime = self._runtime
            if runtime and runtime.last_snapshot_ist:
                return self._snapshot_from(runtime, is_cached=True)
        return None

    def _is_symbol_syncing(self, runtime: VolumeBreakoutRuntime, symbol: str, within_minutes: int = 5) -> bool:
        """Check if symbol fetch is already in-flight within the last N minutes."""
        if symbol not in runtime.in_flight_syncs:
            return False
        started_at = runtime.in_flight_syncs[symbol]
        elapsed = (self._current_ist() - started_at).total_seconds() / 60
        return elapsed < within_minutes

    def _mark_sync_start(self, runtime: VolumeBreakoutRuntime, symbols: list[str]) -> None:
        """Mark symbols as being synced."""
        now = self._current_ist()
        for symbol in symbols:
            runtime.in_flight_syncs[symbol] = now

    def _mark_sync_complete(self, runtime: VolumeBreakoutRuntime, symbols: list[str]) -> None:
        """Remove symbols from in-flight tracking after sync completes."""
        for symbol in symbols:
            runtime.in_flight_syncs.pop(symbol, None)

    def _scan_payload(self, runtime: VolumeBreakoutRuntime, is_cached: bool = False, is_partial: bool = False) -> dict[str, Any]:
        return {
            "running": runtime.running,
            "universe_slug": runtime.request.universe_slug,
            "universe_mode": runtime.request.universe_mode,
            "universe_label": self._universe_label(runtime.request.universe_mode),
            "interval": runtime.request.interval,
            "lookback_days": runtime.request.lookback_days,
            "refresh_seconds": runtime.request.refresh_seconds,
            "min_volume_ratio": runtime.request.min_volume_ratio,
            "summary": runtime.summary.model_dump(),
            "sync": runtime.sync.model_dump(),
            "market_breakouts": [r.model_dump() for r in runtime.market_breakouts],
            "recent_breakouts": [r.model_dump() for r in runtime.recent_breakouts],
            "confirmed_breakouts": [r.model_dump() for r in runtime.confirmed_breakouts],
            "movers_up": [r.model_dump() for r in runtime.movers_up],
            "movers_down": [r.model_dump() for r in runtime.movers_down],
            "last_run_ist": runtime.last_run_ist,
            "next_run_ist": runtime.next_run_ist,
            "last_error": runtime.last_error,
            "universe_size": runtime.universe_size,
            "is_cached_snapshot": is_cached,
            "is_partial_scan": is_partial,
        }

    def start(self, payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStatusResponse:
        with self._lock:
            if self._runtime and self._runtime.request.universe_slug == payload.universe_slug and self._runtime.running:
                current = self._snapshot()
                if self._snapshot_has_rows(current):
                    return current
                cached = self._load_persisted_snapshot(payload)
                if cached:
                    return cached

        self.stop()
        runtime = VolumeBreakoutRuntime(request=payload)
        with self._lock:
            self._runtime = runtime
            self._stop_event = threading.Event()

        cached_snapshot = (
            self._last_cached_snapshot
            if self._snapshot_matches_request(self._last_cached_snapshot, payload)
            else None
        )
        if cached_snapshot is None:
            cached_snapshot = self._load_persisted_snapshot(payload)
        early_return = cached_snapshot if cached_snapshot else self._snapshot()
        if early_return:
            early_return.is_cached_snapshot = True
            early_return.summary.market_status = "updating" if self.has_event_subscribers() else "bootstrapping"

        def _start_gap_fill_thread() -> None:
            gap_fill = threading.Thread(
                target=self._gap_fill_background,
                args=(runtime,),
                daemon=True,
                name="volume-dashboard-gap-fill",
            )
            gap_fill.start()

        def _async_initialize() -> None:
            try:
                runtime.universe_rows = self._ensure_universe(runtime)
                runtime.universe_size = len(runtime.universe_rows)
            except Exception as exc:
                runtime.last_error = str(exc)
                runtime.summary.market_status = "error"
                logger.exception("volume_dashboard.start.universe_failed error=%s", exc)
                self._push_event({"type": "scan_ready", "payload": self._snapshot_from(runtime, is_cached=False).model_dump()})
                return

            if not runtime.universe_rows:
                runtime.last_error = "Unable to build a stock universe from Nubra refdata for the volume dashboard."
                runtime.summary.market_status = "error"
                logger.warning("volume_dashboard.start.universe_empty")
                self._push_event({"type": "scan_ready", "payload": self._snapshot_from(runtime, is_cached=False).model_dump()})
                return

            prune_since = self._history_start_ist(runtime.request.lookback_days)
            if runtime.sync.db_enabled:
                try:
                    with connect_db() as connection:
                        prune_ohlcv_1m_bars(connection, universe_slug=payload.universe_slug, keep_since=prune_since)
                except Exception:
                    pass

            bootstrap_rows = self._bootstrap_universe_rows(runtime) if runtime.request.universe_mode == "all_nse" else []
            if runtime.sync.db_enabled:
                with connect_db() as connection:
                    runtime.symbol_latest_timestamps = load_latest_ohlcv_1m_bars(connection, universe_slug=runtime.request.universe_slug)
                runtime.base_frames = self._load_base_frames_from_db(
                    runtime,
                    target_rows=bootstrap_rows or None,
                )
                runtime.sync.symbols_synced = len(runtime.base_frames)
                now_ist = self._history_end_ist()
                history_start = self._history_start_ist(runtime.request.lookback_days)
                runtime.sync.history_range_ist = (
                    f"{history_start.strftime('%d %b %H:%M')} - {now_ist.strftime('%d %b %H:%M %Z')}"
                )
                if runtime.base_frames:
                    try:
                        self._run_scan(runtime)
                        runtime.last_snapshot_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
                        self._push_event({"type": "scan_update", "payload": self._scan_payload(runtime, is_cached=True, is_partial=True)})
                    except Exception as exc:
                        runtime.last_error = str(exc)
                        logger.exception("volume_dashboard.start.cached_bootstrap_scan_failed error=%s", exc)
            if bootstrap_rows:
                def on_bootstrap_batch_complete(symbols: list[str], bars_written: int, done_batches: int, total_batches: int) -> None:
                    try:
                        runtime.sync.symbols_synced = len(runtime.base_frames)
                        runtime.sync.symbols_missing_history = max(runtime.universe_size - runtime.sync.symbols_synced, 0)
                        self._run_scan(runtime)
                        runtime.last_snapshot_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
                    except Exception as exc:
                        logger.exception("volume_dashboard.bootstrap.batch_scan_failed error=%s", exc)
                    pct = int(done_batches / total_batches * 100) if total_batches else 100
                    self._push_event({
                        "type": "scan_update",
                        "payload": {
                            **self._scan_payload(runtime, is_partial=True),
                            "gap_fill_progress": {
                                "phase": "bootstrap_batch_complete",
                                "message": f"Bootstrapped {done_batches * 10} starter symbols; loading more.",
                                "pct_complete": pct,
                                "symbols_done": min(done_batches * 10, len(bootstrap_rows)),
                                "symbols_total": runtime.universe_size,
                                "batch_index": done_batches,
                                "total_batches": total_batches,
                                "current_symbols": symbols,
                                "bars_written": bars_written,
                            },
                        },
                    })
                try:
                    with self._sync_lock:
                        self._sync_history(runtime, target_rows=bootstrap_rows, on_batch_complete=on_bootstrap_batch_complete)
                except Exception as exc:
                    runtime.last_error = str(exc)
                    logger.exception("volume_dashboard.start.bootstrap_sync_failed error=%s", exc)
            if runtime.base_frames:
                try:
                    self._run_scan(runtime)
                    runtime.last_snapshot_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
                except Exception as exc:
                    runtime.last_error = str(exc)
                    logger.exception("volume_dashboard.start.scan_failed error=%s", exc)

            self._push_event({"type": "scan_ready", "payload": self._snapshot_from(runtime, is_cached=False).model_dump()})
            logger.info("volume_dashboard.start.complete universe=%s synced=%s", runtime.universe_size, runtime.sync.symbols_synced)
            if not self._stop_event.is_set():
                _start_gap_fill_thread()

        init_thread = threading.Thread(target=_async_initialize, daemon=True, name="volume-dashboard-init")
        init_thread.start()

        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="volume-dashboard-refresh")
        self._thread.start()

        return early_return

    def market_status_info(self) -> dict[str, Any]:
        now = self._current_ist()
        is_open = self._is_market_open()
        next_open = self._next_market_open_ist()
        return {
            "is_open": is_open,
            "reason": "NSE market hours Mon-Fri 09:15-15:30 IST" if not is_open else "Market is open",
            "last_session_date": self._last_trading_session_date(),
            "next_open_ist": next_open.strftime("%Y-%m-%d %H:%M IST"),
            "current_ist": now.strftime("%Y-%m-%d %H:%M:%S IST"),
        }

    def eod_snapshot(self, payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStatusResponse:
        # ── Fast-path: return persisted snapshot if available ──
        cached = self._load_persisted_snapshot(payload)
        if cached is not None:
            cached.running = False
            cached.summary.market_status = "closed"
            cached.is_cached_snapshot = True
            logger.info(
                "volume_dashboard.eod.fast_path_cache_hit universe_slug=%s tracked=%s breakouts=%s",
                payload.universe_slug,
                cached.summary.tracked_stocks,
                cached.summary.active_breakouts,
            )
            return cached

        # ── Also check in-memory cache ──
        if self._last_cached_snapshot and self._snapshot_has_rows(self._last_cached_snapshot):
            snapshot = self._last_cached_snapshot.model_copy()
            snapshot.running = False
            snapshot.summary.market_status = "closed"
            snapshot.is_cached_snapshot = True
            logger.info(
                "volume_dashboard.eod.memory_cache_hit universe_slug=%s tracked=%s",
                payload.universe_slug,
                snapshot.summary.tracked_stocks,
            )
            return snapshot

        # ── No cache available — fall through to full DB load ──
        runtime = VolumeBreakoutRuntime(request=payload)
        runtime.running = False
        sync_end_ist = self._history_end_ist()
        logger.info(
            "volume_dashboard.eod.start universe_slug=%s interval=%s lookback_days=%s",
            payload.universe_slug,
            payload.interval,
            payload.lookback_days,
        )
        try:
            runtime.universe_rows = self._ensure_universe(runtime)
            runtime.universe_size = len(runtime.universe_rows)
        except Exception as exc:
            runtime.last_error = str(exc)
            return self._snapshot_from(runtime)

        latest_buckets: dict[tuple[str, str], datetime] = {}
        if runtime.sync.db_enabled:
            latest_buckets = self._hydrate_db_cache_state(runtime, end_ist=sync_end_ist)

        if runtime.base_frames:
            try:
                self._run_scan(runtime)
                runtime.summary.market_status = "closed"
            except Exception as exc:
                runtime.last_error = str(exc)
            symbols_needing_sync = self._symbols_needing_sync(
                runtime,
                latest_buckets=latest_buckets,
                end_ist=sync_end_ist,
            )
            if symbols_needing_sync:
                logger.info(
                    "volume_dashboard.eod.cache_hit_partial universe=%s synced=%s stale_or_missing=%s",
                    runtime.universe_size,
                    runtime.sync.symbols_synced,
                    len(symbols_needing_sync),
                )
                self._start_eod_cache_warmup(
                    runtime,
                    end_ist=sync_end_ist,
                    reason="partial_db_coverage",
                )
            else:
                logger.info(
                    "volume_dashboard.eod.cache_hit_complete universe=%s synced=%s",
                    runtime.universe_size,
                    runtime.sync.symbols_synced,
                )
        else:
            try:
                with self._sync_lock:
                    self._sync_history(runtime, end_ist=sync_end_ist)
            except Exception as exc:
                runtime.last_error = str(exc)
                logger.exception("volume_dashboard.eod.sync_failed error=%s", exc)

            if runtime.base_frames:
                try:
                    self._run_scan(runtime)
                    runtime.summary.market_status = "closed"
                except Exception as exc:
                    runtime.last_error = str(exc)
            else:
                runtime.summary.market_status = "closed"

        logger.info(
            "volume_dashboard.eod.complete universe=%s synced=%s last_error=%s latest_candle=%s",
            runtime.universe_size,
            runtime.sync.symbols_synced,
            runtime.last_error,
            runtime.summary.latest_candle_ist,
        )
        return self._snapshot_from(runtime)

    def drilldown(self, payload: VolumeBreakoutDrilldownRequest) -> VolumeBreakoutDrilldownResponse:
        runtime = VolumeBreakoutRuntime(request=VolumeBreakoutStartRequest(**payload.model_dump(exclude={"symbol", "points"})))
        runtime.running = False
        symbol = payload.symbol.strip().upper()
        sync_end_ist = self._history_end_ist()

        runtime.universe_rows = self._ensure_universe(runtime)
        runtime.universe_size = len(runtime.universe_rows)
        meta = next((row for row in runtime.universe_rows if str(row.get("symbol") or "").strip().upper() == symbol), None)
        if meta is None:
            raise HTTPException(status_code=404, detail=f"{symbol} is not part of the current volume dashboard universe.")

        if runtime.sync.db_enabled:
            self._hydrate_db_cache_state(runtime, end_ist=sync_end_ist)

        frame = runtime.base_frames.get(symbol)
        if frame is None or frame.empty:
            raise HTTPException(status_code=404, detail=f"No cached history available for {symbol}.")

        working = self._drop_incomplete_candle(self._prepare_frame(frame, runtime.request.interval), runtime.request.interval)
        if working.empty:
            raise HTTPException(status_code=404, detail=f"No completed candles available for {symbol}.")

        visible = working.tail(payload.points)
        latest_ts = working.index[-1]
        baseline = self._baseline_volumes(working, latest_ts, runtime.request.lookback_days)
        baseline_average_volume = float(baseline.mean()) if not baseline.empty else None

        return VolumeBreakoutDrilldownResponse(
            symbol=symbol,
            display_name=str(meta.get("display_name") or symbol),
            exchange=str(meta.get("exchange") or "NSE"),
            sector=str(meta.get("sector")).strip() if meta.get("sector") else None,
            interval=runtime.request.interval,
            latest_candle_ist=latest_ts.strftime("%Y-%m-%d %H:%M:%S %Z"),
            baseline_average_volume=round(baseline_average_volume, 2) if baseline_average_volume is not None else None,
            points=[
                VolumeBreakoutDrilldownPoint(
                    time_ist=index.strftime("%H:%M"),
                    close=round(float(row["close"]), 2),
                    volume=round(float(row["bucket_volume"]) if pd.notna(row["bucket_volume"]) else 0.0, 2),
                )
                for index, row in visible.iterrows()
            ],
        )

    def stop(self) -> VolumeBreakoutStatusResponse:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._thread = None
        with self._lock:
            if self._runtime:
                self._runtime.running = False
            snapshot = self._snapshot()
            self._last_cached_snapshot = snapshot
            self._runtime = None
        return snapshot

    def status(self) -> VolumeBreakoutStatusResponse:
        return self._snapshot()


volume_breakout_service = VolumeBreakoutService()
