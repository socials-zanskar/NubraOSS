from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from google.protobuf.any_pb2 import Any
from websockets.sync.client import connect as ws_connect

from app.schemas import ScalperCandle, ScalperSnapshotRequest
from app.services.instrument_service import instrument_service
from app.services.market_history_service import HistoricalFetchRequest, market_history_service
from app.services.nubra_ws_proto import (
    BatchWebSocketIndexMessage,
    BatchWebSocketOrderbookMessage,
    GenericData,
)
from app.services.scalper_service import INDEX_HISTORY_SYMBOL_ALIASES, scalper_service

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
log = logging.getLogger(__name__)

_INTERVAL_SECONDS: dict[str, int] = {
    "1m": 60,
    "2m": 120,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
}

_RECONCILE_EVERY_S = 300
_WS_RECONNECT_SECONDS = 5
_FALLBACK_POLL_SECONDS = 3
_WEBSOCKET_STALE_AFTER_S = 6

_INDEX_UNDERLYING_BY_ALIAS = {
    alias.strip().upper(): canonical
    for canonical, aliases in INDEX_HISTORY_SYMBOL_ALIASES.items()
    for alias in aliases
}


def _canonical_underlying_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    return _INDEX_UNDERLYING_BY_ALIAS.get(normalized, normalized)


def _iter_live_symbol_aliases(symbol: str, instrument_type: str) -> tuple[str, ...]:
    canonical = _canonical_underlying_symbol(symbol)
    if instrument_type.strip().upper() != "INDEX":
        return (canonical,)

    seen: set[str] = set()
    aliases: list[str] = []
    for candidate in (canonical, *INDEX_HISTORY_SYMBOL_ALIASES.get(canonical, (canonical,))):
        normalized = candidate.strip().upper()
        if normalized and normalized not in seen:
            seen.add(normalized)
            aliases.append(normalized)
    return tuple(aliases)


def _normalize_epoch_seconds(raw_timestamp: object) -> int:
    timestamp = instrument_service._coerce_positive_int(raw_timestamp, 0) or 0  # noqa: SLF001
    if timestamp >= 10**18:
        return timestamp // 1_000_000_000
    if timestamp >= 10**15:
        return timestamp // 1_000_000
    if timestamp >= 10**12:
        return timestamp // 1000
    return timestamp


def _coerce_live_instrument_ids(row: dict) -> tuple[int, ...]:
    seen: set[int] = set()
    ids: list[int] = []
    for key in ("ref_id", "inst_id", "instrument_ref_id"):
        value = instrument_service._coerce_positive_int(row.get(key))  # noqa: SLF001
        if value is None or value in seen:
            continue
        seen.add(value)
        ids.append(value)
    return tuple(ids)


def _coerce_tick_instrument_id(item: object) -> int | None:
    for key in ("ref_id", "inst_id", "instrument_ref_id"):
        value = instrument_service._coerce_positive_int(getattr(item, key, None))  # noqa: SLF001
        if value is not None:
            return value
    return None


class LiveCandle:
    __slots__ = ("epoch_s", "time_ist", "open", "high", "low", "close", "volume")

    def __init__(self, c: ScalperCandle) -> None:
        self.epoch_s: int = c.epoch_ms // 1000
        self.time_ist: str = c.time_ist
        self.open: float = c.open
        self.high: float = c.high
        self.low: float = c.low
        self.close: float = c.close
        self.volume: float = c.volume or 0.0

    def as_wire(self) -> dict:
        return {
            "time": self.epoch_s,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }


class ScalperLiveSession:
    """
    Live scalper session backed by Nubra real-time websocket streams.

    Flow:
      1. Load the historical seed from Nubra REST.
      2. Subscribe to the underlying via the `index` stream.
      3. Subscribe to CE / PE contracts via the `orderbook` stream.
      4. Aggregate every incoming tick into the active candle for the selected timeframe.
      5. Periodically reconcile from REST to avoid long-run drift.
    """

    def __init__(self, request: ScalperSnapshotRequest) -> None:
        self._req = request
        self._ws: WebSocket | None = None
        self._closed = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._event_queue: asyncio.Queue[dict] | None = None
        self._feed_stop = threading.Event()
        self._feed_thread: threading.Thread | None = None
        self._reconcile_task: asyncio.Task | None = None
        self._fallback_task: asyncio.Task | None = None

        self._candles: dict[str, list[LiveCandle]] = {
            "underlying": [],
            "call_option": [],
            "put_option": [],
        }
        self._meta: dict[str, dict] = {}
        self._panel_lookup: dict[str, str] = {}
        self._last_total_volume: dict[str, float | None] = {
            "underlying": None,
            "call_option": None,
            "put_option": None,
        }
        self._index_symbols: list[str] = []
        self._orderbook_ref_ids: list[int] = []
        self._last_websocket_tick_at: dict[str, float] = {
            "underlying": 0.0,
            "call_option": 0.0,
            "put_option": 0.0,
        }

    async def run(self, ws: WebSocket) -> None:
        self._ws = ws
        self._loop = asyncio.get_running_loop()
        self._event_queue = asyncio.Queue()

        try:
            await self._send("status", message="Loading historical candles from Nubra...")

            snapshot = await asyncio.get_running_loop().run_in_executor(
                None, scalper_service.snapshot, self._req
            )

            for panel, data in (
                ("underlying", snapshot.underlying),
                ("call_option", snapshot.call_option),
                ("put_option", snapshot.put_option),
            ):
                self._candles[panel] = [LiveCandle(c) for c in data.candles]
                self._meta[panel] = {
                    "instrument": data.instrument,
                    "display_name": data.display_name,
                    "exchange": data.exchange,
                    "instrument_type": data.instrument_type,
                    "interval": data.interval,
                    "last_price": data.last_price,
                    "ref_id": None,
                    "live_ids": (),
                }
                for symbol_alias in _iter_live_symbol_aliases(data.instrument, data.instrument_type):
                    self._panel_lookup[symbol_alias] = panel
                for symbol_alias in _iter_live_symbol_aliases(data.display_name, data.instrument_type):
                    self._panel_lookup[symbol_alias] = panel
                # Historical candles expose bucket volume, while the websocket feed carries
                # cumulative session volume. Seeding the live baseline from the last bucket
                # volume creates an artificial first-tick spike that crushes the histogram.
                # Start the cumulative baseline on the first live tick instead.
                self._last_total_volume[panel] = None

            self._resolve_tick_subscriptions()

            await ws.send_json({
                "type": "init",
                "option_pair": snapshot.option_pair.model_dump(),
                "panels": {
                    panel: {
                        **self._meta[panel],
                        "candles": [c.as_wire() for c in self._candles[panel]],
                    }
                    for panel in ("underlying", "call_option", "put_option")
                },
            })

            await self._send(
                "status",
                message="Connecting to Nubra live tick stream for the current candle.",
            )

            self._start_feed_thread()
            self._reconcile_task = asyncio.create_task(self._reconcile_loop())
            self._fallback_task = asyncio.create_task(self._quote_fallback_loop())
            await self._consume_events()

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            log.exception("ScalperLiveSession error")
            try:
                await self._send("error", message=str(exc))
            except Exception:
                pass
        finally:
            await self._shutdown()

    async def _consume_events(self) -> None:
        if self._event_queue is None:
            return

        while not self._closed:
            event = await self._event_queue.get()
            if self._closed:
                break

            event_type = str(event.get("type") or "")
            if event_type == "status":
                await self._send("status", message=str(event.get("message") or ""))
                continue

            if event_type == "tick":
                panel = str(event.get("panel") or "")
                epoch_s = int(event.get("epoch_s") or 0)
                price = float(event.get("price") or 0.0)
                total_volume_raw = event.get("total_volume")
                total_volume = float(total_volume_raw) if total_volume_raw is not None else None
                if str(event.get("source") or "") == "websocket" and panel:
                    self._last_websocket_tick_at[panel] = time.monotonic()
                if panel and epoch_s > 0 and price > 0:
                    await self._apply_tick(panel, epoch_s, price, total_volume)

    def _start_feed_thread(self) -> None:
        self._feed_stop.clear()
        self._feed_thread = threading.Thread(
            target=self._run_feed_loop,
            daemon=True,
            name="scalper-live-feed",
        )
        self._feed_thread.start()

    def _run_feed_loop(self) -> None:
        ws_url = self._get_ws_url(self._req.environment)
        token = self._req.session_token
        index_payload = json.dumps({"indexes": self._index_symbols, "instruments": []}, separators=(",", ":"))
        orderbook_payload = json.dumps({"indexes": [], "instruments": self._orderbook_ref_ids}, separators=(",", ":"))

        while not self._feed_stop.is_set() and not self._closed:
            try:
                self._queue_event({
                    "type": "status",
                    "message": "Connecting to Nubra live tick stream...",
                })
                with ws_connect(
                    ws_url,
                    additional_headers={"x-device-id": self._req.device_id},
                    max_size=None,
                    open_timeout=20,
                    close_timeout=5,
                ) as websocket:
                    if self._index_symbols:
                        websocket.send(f"batch_subscribe {token} index {index_payload} {self._req.exchange}")
                    if self._orderbook_ref_ids:
                        websocket.send(f"batch_subscribe {token} orderbook {orderbook_payload}")

                    self._queue_event({
                        "type": "status",
                        "message": "Live websocket connected. Current candle now updates on every Nubra tick.",
                    })

                    for message in websocket:
                        if self._feed_stop.is_set() or self._closed:
                            break
                        if not isinstance(message, (bytes, bytearray)):
                            continue
                        self._dispatch_tick_message(bytes(message))
            except Exception as exc:
                if self._feed_stop.is_set() or self._closed:
                    break
                log.warning("Scalper live websocket error: %s", exc)
                self._queue_event({
                    "type": "status",
                    "message": f"Live feed reconnecting after websocket interruption: {exc}",
                })
                if self._feed_stop.wait(_WS_RECONNECT_SECONDS):
                    break

    def _dispatch_tick_message(self, raw: bytes) -> None:
        channel = ""
        payload = b""
        type_url = ""

        try:
            envelope = GenericData()
            envelope.ParseFromString(raw)
            channel = str(getattr(envelope, "key", "") or "").strip().lower()
            payload = bytes(getattr(envelope.data, "value", b"") or b"")
            type_url = str(getattr(envelope.data, "type_url", "") or "")
        except Exception as exc:
            log.debug("Failed to decode scalper GenericData payload: %s", exc)

        if not payload:
            try:
                outer = Any()
                outer.ParseFromString(raw)
                inner = Any()
                inner.ParseFromString(outer.value)
                payload = bytes(inner.value)
                type_url = str(inner.type_url or "")
            except Exception as exc:
                log.debug("Failed to decode scalper tick payload: %s", exc)
                return

        if channel == "index" or type_url.endswith("BatchWebSocketIndexMessage"):
            message = BatchWebSocketIndexMessage()
            message.ParseFromString(payload)
            for item in list(message.indexes) + list(message.instruments):
                raw_symbol = str(getattr(item, "indexname", "") or "").strip().upper()
                symbol = _canonical_underlying_symbol(raw_symbol)
                panel = self._panel_lookup.get(symbol) or self._panel_lookup.get(raw_symbol)
                if not panel:
                    continue
                epoch_s = _normalize_epoch_seconds(getattr(item, "timestamp", 0))
                price = float(getattr(item, "index_value", 0) or 0) / 100.0
                total_volume = float(getattr(item, "volume", 0) or 0.0)
                if epoch_s > 0 and price > 0:
                    self._queue_event({
                        "type": "tick",
                        "panel": panel,
                        "epoch_s": epoch_s,
                        "price": price,
                        "total_volume": total_volume,
                        "source": "websocket",
                    })
            return

        if channel == "orderbook" or type_url.endswith("BatchWebSocketOrderbookMessage"):
            message = BatchWebSocketOrderbookMessage()
            message.ParseFromString(payload)
            ref_to_panel: dict[int, str] = {}
            for panel, meta in self._meta.items():
                live_ids = tuple(int(value) for value in meta.get("live_ids") or ())
                if not live_ids and meta.get("ref_id") is not None:
                    live_ids = (int(meta["ref_id"]),)
                for value in live_ids:
                    ref_to_panel[value] = panel
            for item in list(message.instruments):
                instrument_id = _coerce_tick_instrument_id(item)
                panel = ref_to_panel.get(instrument_id) if instrument_id is not None else None
                if not panel:
                    continue
                epoch_s = _normalize_epoch_seconds(getattr(item, "timestamp", 0))
                price = float(getattr(item, "ltp", 0) or 0) / 100.0
                total_volume = float(getattr(item, "volume", 0) or 0.0)
                if epoch_s > 0 and price > 0:
                    self._queue_event({
                        "type": "tick",
                        "panel": panel,
                        "epoch_s": epoch_s,
                        "price": price,
                        "total_volume": total_volume,
                        "source": "websocket",
                    })

    def _queue_event(self, event: dict) -> None:
        if self._loop is None or self._event_queue is None or self._closed:
            return
        self._loop.call_soon_threadsafe(self._event_queue.put_nowait, event)

    def _get_ws_url(self, environment: str) -> str:
        return "wss://uatapi.nubra.io/apibatch/ws" if environment == "UAT" else "wss://api.nubra.io/apibatch/ws"

    def _resolve_tick_subscriptions(self) -> None:
        rows = instrument_service._get_cached_rows(  # noqa: SLF001
            self._req.session_token,
            self._req.environment,
            self._req.device_id,
        )

        call_symbol = self._meta["call_option"]["instrument"].strip().upper()
        put_symbol = self._meta["put_option"]["instrument"].strip().upper()
        underlying_symbol = self._meta["underlying"]["instrument"].strip().upper()
        underlying_type = str(self._meta["underlying"]["instrument_type"] or "").strip().upper()

        option_ref_ids: list[int] = []
        underlying_ref_ids: list[int] = []

        for row in rows:
            exchange = str(row.get("exchange") or "").strip().upper()
            if exchange != self._req.exchange:
                continue

            names = {
                str(row.get("display_name") or "").strip().upper(),
                str(row.get("symbol") or "").strip().upper(),
                str(row.get("stock_name") or "").strip().upper(),
            }
            live_ids = _coerce_live_instrument_ids(row)
            if not live_ids:
                continue
            primary_live_id = live_ids[0]

            if call_symbol in names:
                option_ref_ids.append(primary_live_id)
                self._meta["call_option"]["ref_id"] = primary_live_id
                self._meta["call_option"]["live_ids"] = live_ids
            if put_symbol in names:
                option_ref_ids.append(primary_live_id)
                self._meta["put_option"]["ref_id"] = primary_live_id
                self._meta["put_option"]["live_ids"] = live_ids
            if underlying_type != "INDEX" and underlying_symbol in names:
                underlying_ref_ids.append(primary_live_id)
                self._meta["underlying"]["ref_id"] = primary_live_id
                self._meta["underlying"]["live_ids"] = live_ids

        if len(option_ref_ids) < 2:
            raise HTTPException(
                status_code=404,
                detail="Unable to resolve live option ref_ids for the selected CE / PE contracts.",
            )

        self._orderbook_ref_ids = sorted(set(option_ref_ids + underlying_ref_ids))
        self._index_symbols = list(_iter_live_symbol_aliases(underlying_symbol, underlying_type)) if underlying_type == "INDEX" else []

    async def _apply_tick(self, panel: str, epoch_s: int, price: float, total_volume: float | None) -> None:
        state = self._candles.get(panel)
        if state is None:
            return

        interval_s = _INTERVAL_SECONDS.get(self._req.interval, 60)
        if not state:
            bucket_epoch_s = epoch_s - (epoch_s % interval_s)
        else:
            last_epoch_s = state[-1].epoch_s
            if epoch_s < last_epoch_s:
                return
            if epoch_s < last_epoch_s + interval_s:
                bucket_epoch_s = last_epoch_s
            else:
                bucket_epoch_s = last_epoch_s + ((epoch_s - last_epoch_s) // interval_s) * interval_s

        volume_delta = 0.0
        if total_volume is not None:
            previous_total = self._last_total_volume.get(panel)
            if previous_total is not None and total_volume >= previous_total:
                volume_delta = total_volume - previous_total
            self._last_total_volume[panel] = total_volume

        if state and bucket_epoch_s == state[-1].epoch_s:
            live_candle = state[-1]
            live_candle.high = max(live_candle.high, price)
            live_candle.low = min(live_candle.low, price)
            live_candle.close = price
            live_candle.volume = max(0.0, live_candle.volume + volume_delta)
        else:
            live_candle = LiveCandle(
                ScalperCandle(
                    time_ist=datetime.fromtimestamp(bucket_epoch_s, tz=UTC).astimezone(IST).strftime("%d %b %H:%M"),
                    epoch_ms=bucket_epoch_s * 1000,
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=max(0.0, volume_delta),
                )
            )
            state.append(live_candle)
            if len(state) > 600:
                del state[:-600]

        self._meta[panel]["last_price"] = live_candle.close
        await self._emit_update(panel, live_candle)

    async def _quote_fallback_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(_FALLBACK_POLL_SECONDS)
            if self._closed:
                break

            stale_panels = [
                panel
                for panel in ("underlying", "call_option", "put_option")
                if (time.monotonic() - self._last_websocket_tick_at.get(panel, 0.0)) >= _WEBSOCKET_STALE_AFTER_S
            ]
            if not stale_panels:
                continue

            try:
                events = await asyncio.to_thread(self._poll_stale_quotes, tuple(stale_panels))
            except Exception as exc:
                log.debug("Scalper fallback quote polling failed: %s", exc)
                continue

            for event in events:
                self._queue_event(event)

    def _poll_stale_quotes(self, panels: tuple[str, ...]) -> list[dict]:
        if not panels:
            return []

        base_url = scalper_service._get_base_url(self._req.environment)  # noqa: SLF001
        headers = scalper_service._request_headers(self._req.session_token, self._req.device_id)  # noqa: SLF001
        events: list[dict] = []

        with httpx.Client(timeout=10.0) as client:
            for panel in panels:
                meta = self._meta.get(panel) or {}
                instrument = str(meta.get("instrument") or "").strip().upper()
                instrument_type = str(meta.get("instrument_type") or "").strip().upper()
                ref_id = instrument_service._coerce_positive_int(meta.get("ref_id"))  # noqa: SLF001

                try:
                    if panel == "underlying" and (instrument_type == "INDEX" or ref_id is None):
                        params = {"exchange": self._req.exchange} if self._req.exchange == "BSE" else None
                        response = client.get(
                            f"{base_url}/optionchains/{instrument}/price",
                            params=params,
                            headers=headers,
                        )
                        if response.status_code >= 400:
                            continue
                        payload = response.json()
                        price_raw = payload.get("price")
                        epoch_s = _normalize_epoch_seconds(payload.get("timestamp") or payload.get("ts") or int(time.time()))
                        total_volume: float | None = None
                    else:
                        live_id = ref_id or next(
                            (
                                instrument_service._coerce_positive_int(value)  # noqa: SLF001
                                for value in meta.get("live_ids") or ()
                                if instrument_service._coerce_positive_int(value) is not None  # noqa: SLF001
                            ),
                            None,
                        )
                        if live_id is None:
                            continue
                        response = client.get(
                            f"{base_url}/orderbooks/{live_id}",
                            params={"levels": 1},
                            headers=headers,
                        )
                        if response.status_code >= 400:
                            continue
                        payload = response.json().get("orderBook") or {}
                        price_raw = payload.get("ltp") or payload.get("last_traded_price")
                        epoch_s = _normalize_epoch_seconds(payload.get("ts") or payload.get("timestamp") or int(time.time()))
                        volume_raw = payload.get("volume")
                        total_volume = float(volume_raw) if isinstance(volume_raw, (int, float)) else None
                except Exception:
                    continue

                if not isinstance(price_raw, (int, float)) or float(price_raw) <= 0:
                    continue

                events.append({
                    "type": "tick",
                    "panel": panel,
                    "epoch_s": epoch_s,
                    "price": float(price_raw) / 100.0,
                    "total_volume": total_volume,
                    "source": "poll",
                })
        return events

    async def _reconcile_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(_RECONCILE_EVERY_S)
            if self._closed:
                break
            await self._reconcile(n=12)

    def _lookback_start(self, n_candles: int) -> datetime:
        interval_s = _INTERVAL_SECONDS.get(self._req.interval, 300)
        return datetime.now(IST) - timedelta(seconds=interval_s * n_candles + 600)

    async def _fetch(
        self,
        symbols: tuple[str, ...],
        instrument_type: str,
        start_dt: datetime,
    ) -> dict[str, pd.DataFrame]:
        return await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: market_history_service.fetch(
                HistoricalFetchRequest(
                    session_token=self._req.session_token,
                    device_id=self._req.device_id,
                    environment=self._req.environment,
                    exchange=self._req.exchange,
                    instrument_type=instrument_type,
                    interval=self._req.interval,
                    symbols=symbols,
                    start_dt=start_dt,
                    end_dt=datetime.now(IST),
                )
            ),
        )

    async def _reconcile(self, n: int = 12) -> None:
        start = self._lookback_start(n + 4)
        ul = self._meta["underlying"]["instrument"]
        ul_type = self._meta["underlying"]["instrument_type"]
        call = self._meta["call_option"]["instrument"]
        put = self._meta["put_option"]["instrument"]

        try:
            idx_frames, opt_frames = await asyncio.gather(
                self._fetch((ul,), ul_type, start),
                self._fetch((call, put), "OPT", start),
            )
        except Exception as exc:
            log.warning("Reconcile fetch failed: %s", exc)
            return

        all_frames: dict[str, pd.DataFrame] = {**idx_frames, **opt_frames}
        panel_sym = {
            "underlying": ul.upper(),
            "call_option": call.upper(),
            "put_option": put.upper(),
        }

        for panel, sym in panel_sym.items():
            frame = all_frames.get(sym)
            if frame is None or frame.empty:
                continue

            recent = frame.tail(n)
            wire_candles: list[dict] = []

            for ts, row in recent.iterrows():
                epoch_s = int(ts.timestamp())
                bucket_volume = row.get("bucket_volume")
                volume = float(bucket_volume) if pd.notna(bucket_volume) else 0.0
                wire_candles.append({
                    "time": epoch_s,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": volume,
                })

            self._candles[panel] = [
                LiveCandle(
                    ScalperCandle(
                        time_ist=datetime.fromtimestamp(int(candle["time"]), tz=UTC).astimezone(IST).strftime("%d %b %H:%M"),
                        epoch_ms=int(candle["time"]) * 1000,
                        open=float(candle["open"]),
                        high=float(candle["high"]),
                        low=float(candle["low"]),
                        close=float(candle["close"]),
                        volume=float(candle["volume"]),
                    )
                )
                for candle in sorted(
                    ({c.epoch_s: c.as_wire() for c in self._candles[panel]}) |
                    ({int(candle["time"]): candle for candle in wire_candles}),
                    key=lambda candle_epoch: candle_epoch,
                )[-600:]
                for candle in [(({c.epoch_s: c.as_wire() for c in self._candles[panel]}) |
                                ({int(item["time"]): item for item in wire_candles}))[candle]]
            ]

            if wire_candles:
                self._meta[panel]["last_price"] = float(wire_candles[-1]["close"])
                self._last_total_volume[panel] = float(wire_candles[-1]["volume"])
            await self._send("reconcile", panel=panel, candles=wire_candles)

    async def _emit_update(self, panel: str, candle: LiveCandle) -> None:
        await self._send(
            "candle_update",
            panel=panel,
            candle=candle.as_wire(),
            last_price=candle.close,
        )

    async def _send(self, msg_type: str, **kwargs) -> None:
        if self._ws is None or self._closed:
            return
        try:
            await self._ws.send_json({"type": msg_type, **kwargs})
        except Exception:
            self._closed = True

    async def _shutdown(self) -> None:
        self._closed = True
        self._feed_stop.set()

        if self._fallback_task is not None:
            self._fallback_task.cancel()
            try:
                await self._fallback_task
            except asyncio.CancelledError:
                pass

        if self._reconcile_task is not None:
            self._reconcile_task.cancel()
            try:
                await self._reconcile_task
            except asyncio.CancelledError:
                pass

        if self._feed_thread and self._feed_thread.is_alive():
            await asyncio.to_thread(self._feed_thread.join, 2.0)
