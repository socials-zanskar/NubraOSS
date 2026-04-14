from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
from websockets.sync.client import connect as ws_connect

from app.config import settings
from app.db import connect_db, load_dashboard_universe_members, load_ohlcv_1m_bars
from app.schemas import (
    VolumeBreakoutStartRequest,
    VolumeBreakoutStatusResponse,
    VolumeBreakoutStockRow,
    VolumeBreakoutSummary,
)
from app.services.nubra_ws_proto import BatchWebSocketIndexBucketMessage, GenericData

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
MIN_BASELINE_SESSIONS = 3
WS_CHUNK_SIZE = 100
WS_RECONNECT_SECONDS = 5
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
WS_INTERVAL_MAP = {
    "1m": "1m",
    "2m": "2m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
}


@dataclass
class VolumeBreakoutRuntime:
    request: VolumeBreakoutStartRequest
    running: bool = True
    last_run_ist: str | None = None
    next_run_ist: str | None = None
    last_error: str | None = None
    live_status: str = "bootstrapping"
    live_last_event_ist: str | None = None
    live_subscribed_symbols: int = 0
    summary: VolumeBreakoutSummary = field(
        default_factory=lambda: VolumeBreakoutSummary(
            tracked_stocks=0,
            active_breakouts=0,
            leaders_with_price_breakout=0,
            latest_candle_ist=None,
            market_status="arming",
        )
    )
    market_breakouts: list[VolumeBreakoutStockRow] = field(default_factory=list)
    recent_breakouts: list[VolumeBreakoutStockRow] = field(default_factory=list)
    last_breakout_keys: set[str] = field(default_factory=set)
    universe_size: int = 0
    universe_rows: list[dict[str, object]] = field(default_factory=list)
    base_frames: dict[str, pd.DataFrame] = field(default_factory=dict)
    live_frames: dict[str, pd.DataFrame] = field(default_factory=dict)


class VolumeBreakoutService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._runtime: VolumeBreakoutRuntime | None = None

    def _current_ist(self) -> datetime:
        return datetime.now(IST)

    def _get_ws_url(self, environment: str) -> str:
        return "wss://uatapi.nubra.io/apibatch/ws" if environment == "UAT" else "wss://api.nubra.io/apibatch/ws"

    def _load_universe(self, universe_slug: str) -> list[dict[str, object]]:
        with connect_db() as connection:
            return load_dashboard_universe_members(connection, universe_slug=universe_slug)

    def _load_history_frames(
        self,
        *,
        universe_slug: str,
        lookback_days: int,
    ) -> dict[str, pd.DataFrame]:
        since_timestamp = datetime.now(UTC) - timedelta(days=lookback_days + 7)
        with connect_db() as connection:
            rows = load_ohlcv_1m_bars(
                connection,
                universe_slug=universe_slug,
                since_timestamp=since_timestamp,
            )

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
            )
            base = base.dropna(subset=["open", "high", "low", "close"], how="any")
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

    def _merge_frame(self, symbol: str, runtime: VolumeBreakoutRuntime) -> pd.DataFrame | None:
        base = runtime.base_frames.get(symbol)
        live = runtime.live_frames.get(symbol)
        if base is None and live is None:
            return None
        if base is None:
            merged = live.copy()
        elif live is None:
            merged = base.copy()
        else:
            merged = pd.concat([base, live]).sort_index()
            merged = merged[~merged.index.duplicated(keep="last")]
        return self._prepare_frame(merged, runtime.request.interval)

    def _drop_incomplete_candle(self, frame: pd.DataFrame, interval: str) -> pd.DataFrame:
        if frame.empty:
            return frame
        now_ist = self._current_ist()
        latest_ts = frame.index[-1]
        if now_ist < latest_ts + timedelta(minutes=INTERVAL_MINUTES[interval]):
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
        meta: dict[str, object],
        frame: pd.DataFrame,
        request: VolumeBreakoutStartRequest,
    ) -> VolumeBreakoutStockRow | None:
        working = self._drop_incomplete_candle(frame, request.interval)
        if len(working) < 2:
            return None

        latest = working.iloc[-1]
        current_ts = working.index[-1]
        baseline = self._baseline_volumes(working, current_ts, request.lookback_days)
        required_samples = min(request.lookback_days, MIN_BASELINE_SESSIONS)
        if len(baseline) < required_samples:
            return None

        average_volume = float(baseline.mean())
        current_volume = float(latest["bucket_volume"]) if pd.notna(latest["bucket_volume"]) else 0.0
        if average_volume <= 0 or current_volume <= 0:
            return None

        volume_ratio = current_volume / average_volume
        prior_bars = self._prior_price_bars(working, current_ts, request.lookback_days)
        lookback_high = float(prior_bars["high"].max()) if not prior_bars.empty else float("nan")
        current_close = float(latest["close"])
        current_open = float(latest["open"])
        prev_close = float(working.iloc[-2]["close"])
        price_change_pct = ((current_close - prev_close) / prev_close * 100.0) if prev_close > 0 else None
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
            candle_time_ist=current_ts.strftime("%Y-%m-%d %H:%M:%S %Z"),
            last_price=round(current_close, 2),
            current_volume=round(current_volume, 2),
            average_volume=round(average_volume, 2),
            volume_ratio=round(volume_ratio, 2),
            price_change_pct=round(price_change_pct, 2) if price_change_pct is not None else None,
            price_breakout_pct=round(price_breakout_pct, 2) if price_breakout_pct is not None else None,
            is_green=current_close >= current_open,
            is_price_breakout=is_price_breakout,
            meets_breakout=volume_ratio >= request.min_volume_ratio,
        )

    def _latest_candle_label(self, frames: list[pd.DataFrame], interval: str) -> str | None:
        latest_timestamps: list[pd.Timestamp] = []
        for frame in frames:
            working = self._drop_incomplete_candle(frame, interval)
            if not working.empty:
                latest_timestamps.append(working.index[-1])
        if not latest_timestamps:
            return None
        return max(latest_timestamps).strftime("%Y-%m-%d %H:%M:%S %Z")

    def _run_scan(self, runtime: VolumeBreakoutRuntime) -> None:
        rows: list[VolumeBreakoutStockRow] = []
        merged_frames: list[pd.DataFrame] = []
        for item in runtime.universe_rows:
            symbol = str(item["symbol"]).strip().upper()
            frame = self._merge_frame(symbol, runtime)
            if frame is None or frame.empty:
                continue
            merged_frames.append(frame)
            row = self._scan_symbol(item, frame, runtime.request)
            if row:
                rows.append(row)

        rows.sort(key=lambda item: (-item.volume_ratio, -item.current_volume, item.symbol))
        breakout_rows = [item for item in rows if item.meets_breakout]
        current_keys = {f"{item.symbol}:{item.candle_time_ist}" for item in breakout_rows}
        new_rows = [
            item for item in breakout_rows if f"{item.symbol}:{item.candle_time_ist}" not in runtime.last_breakout_keys
        ]

        runtime.last_breakout_keys = current_keys
        runtime.market_breakouts = rows[: runtime.request.limit]
        runtime.recent_breakouts = new_rows[: runtime.request.limit]
        runtime.summary = VolumeBreakoutSummary(
            tracked_stocks=runtime.universe_size,
            active_breakouts=len(breakout_rows),
            leaders_with_price_breakout=sum(1 for item in breakout_rows if item.is_price_breakout),
            latest_candle_ist=self._latest_candle_label(merged_frames, runtime.request.interval),
            market_status="running" if runtime.live_status in {"connected", "connecting", "reconnecting"} else "stale",
        )
        runtime.last_run_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.next_run_ist = (
            self._current_ist() + timedelta(seconds=runtime.request.refresh_seconds)
        ).strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.last_error = None

    def _prime_runtime(self, runtime: VolumeBreakoutRuntime) -> None:
        runtime.universe_rows = self._load_universe(runtime.request.universe_slug)
        runtime.universe_size = len(runtime.universe_rows)
        if not runtime.universe_rows:
            raise ValueError(
                f"No tracked stocks found for universe '{runtime.request.universe_slug}'. "
                "Populate the Supabase market-data store from the external updater first."
            )
        runtime.base_frames = self._load_history_frames(
            universe_slug=runtime.request.universe_slug,
            lookback_days=runtime.request.lookback_days,
        )
        if not runtime.base_frames:
            raise ValueError(
                "No historical bars are available for the selected universe yet. "
                "Populate the Supabase market-data store from the external updater before starting the dashboard."
            )
        self._run_scan(runtime)

    def _update_live_bucket(self, runtime: VolumeBreakoutRuntime, symbol: str, payload) -> None:
        timestamp_ns = int(payload.bucket_timestamp or payload.timestamp)
        if timestamp_ns <= 0:
            return
        bucket_ts = pd.to_datetime(timestamp_ns, unit="ns", utc=True).tz_convert(IST)
        row = pd.DataFrame(
            {
                "open": [float(payload.open) / 100.0],
                "high": [float(payload.high) / 100.0],
                "low": [float(payload.low) / 100.0],
                "close": [float(payload.close) / 100.0],
                "bucket_volume": [float(payload.bucket_volume)],
                "cumulative_volume": [float(payload.cumulative_volume)],
            },
            index=[bucket_ts],
        )
        existing = runtime.live_frames.get(symbol)
        if existing is None or existing.empty:
            runtime.live_frames[symbol] = row
        else:
            merged = pd.concat([existing, row]).sort_index()
            merged = merged[~merged.index.duplicated(keep="last")]
            runtime.live_frames[symbol] = merged.tail(600)

    def _subscribe_socket(self, websocket, runtime: VolumeBreakoutRuntime) -> None:
        token = runtime.request.session_token
        interval = WS_INTERVAL_MAP[runtime.request.interval]
        websocket.send(f"batch_subscribe {token} socket_interval index_bucket {interval}")
        symbols = [str(item["symbol"]).strip().upper() for item in runtime.universe_rows if item.get("exchange") == "NSE"]
        runtime.live_subscribed_symbols = len(symbols)
        for index in range(0, len(symbols), WS_CHUNK_SIZE):
            chunk = symbols[index : index + WS_CHUNK_SIZE]
            payload = json.dumps({"indexes": chunk}, separators=(",", ":"))
            websocket.send(f"batch_subscribe {token} index_bucket {payload} {interval} NSE")

    def _run_live_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._lock:
                runtime = self._runtime
            if runtime is None:
                return

            try:
                runtime.live_status = "connecting"
                with ws_connect(
                    self._get_ws_url(runtime.request.environment),
                    additional_headers={"x-device-id": runtime.request.device_id},
                    max_size=None,
                    open_timeout=20,
                    close_timeout=5,
                ) as websocket:
                    self._subscribe_socket(websocket, runtime)
                    runtime.live_status = "connected"
                    for message in websocket:
                        if self._stop_event.is_set():
                            break
                        if not isinstance(message, (bytes, bytearray)):
                            continue
                        envelope = GenericData()
                        envelope.ParseFromString(bytes(message))
                        if envelope.key != "index_bucket":
                            continue
                        bucket_message = BatchWebSocketIndexBucketMessage()
                        bucket_message.ParseFromString(envelope.data.value)

                        updated = False
                        for item in list(bucket_message.instruments) + list(bucket_message.indexes):
                            symbol = str(item.indexname).strip().upper()
                            if not symbol:
                                continue
                            with self._lock:
                                live_runtime = self._runtime
                                if live_runtime is None:
                                    return
                                self._update_live_bucket(live_runtime, symbol, item)
                                live_runtime.live_last_event_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
                                updated = True
                        if updated:
                            with self._lock:
                                live_runtime = self._runtime
                                if live_runtime is None:
                                    return
                                self._run_scan(live_runtime)
            except Exception as exc:
                if runtime is not None:
                    runtime.live_status = "reconnecting"
                    runtime.last_error = str(exc)
                    runtime.summary = VolumeBreakoutSummary(
                        tracked_stocks=runtime.universe_size,
                        active_breakouts=runtime.summary.active_breakouts,
                        leaders_with_price_breakout=runtime.summary.leaders_with_price_breakout,
                        latest_candle_ist=runtime.summary.latest_candle_ist,
                        market_status="stale",
                    )
                if self._stop_event.wait(WS_RECONNECT_SECONDS):
                    return

    def _snapshot(self) -> VolumeBreakoutStatusResponse:
        runtime = self._runtime
        if runtime is None:
            return VolumeBreakoutStatusResponse(
                running=False,
                universe_slug="volume-breakout-v1",
                interval="5m",
                lookback_days=10,
                refresh_seconds=30,
                min_volume_ratio=1.5,
                universe_size=0,
                live_mode=False,
                live_status="idle",
                live_last_event_ist=None,
                live_subscribed_symbols=0,
                last_run_ist=None,
                next_run_ist=None,
                last_error=None,
                summary=VolumeBreakoutSummary(
                    tracked_stocks=0,
                    active_breakouts=0,
                    leaders_with_price_breakout=0,
                    latest_candle_ist=None,
                    market_status="idle",
                ),
                market_breakouts=[],
                recent_breakouts=[],
            )
        return VolumeBreakoutStatusResponse(
            running=runtime.running,
            universe_slug=runtime.request.universe_slug,
            interval=runtime.request.interval,
            lookback_days=runtime.request.lookback_days,
            refresh_seconds=runtime.request.refresh_seconds,
            min_volume_ratio=runtime.request.min_volume_ratio,
            universe_size=runtime.universe_size,
            live_mode=True,
            live_status=runtime.live_status,
            live_last_event_ist=runtime.live_last_event_ist,
            live_subscribed_symbols=runtime.live_subscribed_symbols,
            last_run_ist=runtime.last_run_ist,
            next_run_ist=runtime.next_run_ist,
            last_error=runtime.last_error,
            summary=runtime.summary,
            market_breakouts=list(runtime.market_breakouts),
            recent_breakouts=list(runtime.recent_breakouts),
        )

    def start(self, payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStatusResponse:
        self.stop()
        runtime = VolumeBreakoutRuntime(request=payload)
        with self._lock:
            self._runtime = runtime
            self._stop_event = threading.Event()
        try:
            self._prime_runtime(runtime)
        except Exception as exc:
            runtime.last_error = str(exc)
            runtime.live_status = "error"
            runtime.summary = VolumeBreakoutSummary(
                tracked_stocks=runtime.universe_size,
                active_breakouts=0,
                leaders_with_price_breakout=0,
                latest_candle_ist=None,
                market_status="error",
            )
        self._thread = threading.Thread(target=self._run_live_loop, daemon=True, name="volume-breakout-live")
        self._thread.start()
        return self._snapshot()

    def stop(self) -> VolumeBreakoutStatusResponse:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._thread = None
        with self._lock:
            if self._runtime:
                self._runtime.running = False
                self._runtime.live_status = "stopped"
            snapshot = self._snapshot()
            self._runtime = None
        return snapshot

    def status(self) -> VolumeBreakoutStatusResponse:
        return self._snapshot()


volume_breakout_service = VolumeBreakoutService()
