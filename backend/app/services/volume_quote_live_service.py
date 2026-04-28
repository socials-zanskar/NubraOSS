from __future__ import annotations

import asyncio
import json
import logging
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import WebSocket, WebSocketDisconnect
from google.protobuf.any_pb2 import Any
from websockets.sync.client import connect as ws_connect

from app.services.instrument_service import instrument_service
from app.services.nubra_ws_proto import (
    BatchWebSocketOrderbookMessage,
    GenericData,
)
from app.services.volume_breakout_service import volume_breakout_service

IST = ZoneInfo("Asia/Kolkata")
log = logging.getLogger(__name__)

_RECONNECT_SECONDS = 3
_MAX_SYMBOLS = 24


def _normalize_epoch_seconds(raw_timestamp: object) -> int:
    timestamp = instrument_service._coerce_positive_int(raw_timestamp, 0) or 0  # noqa: SLF001
    if timestamp >= 10**18:
        return timestamp // 1_000_000_000
    if timestamp >= 10**15:
        return timestamp // 1_000_000
    if timestamp >= 10**12:
        return timestamp // 1000
    return timestamp


def _coerce_tick_instrument_id(item: object) -> int | None:
    for key in ("ref_id", "inst_id", "instrument_ref_id"):
        value = instrument_service._coerce_positive_int(getattr(item, key, None))  # noqa: SLF001
        if value is not None:
            return value
    return None


class VolumeQuoteLiveSession:
    """Small live quote stream for the selected volume-dashboard symbols."""

    def __init__(self, init: dict) -> None:
        self._session_token = str(init.get("session_token") or "")
        self._device_id = str(init.get("device_id") or "")
        self._environment = str(init.get("environment") or "PROD")
        self._symbols = self._normalize_symbols(init.get("symbols"))
        self._ws: WebSocket | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._event_queue: asyncio.Queue[dict] | None = None
        self._closed = False
        self._feed_stop = threading.Event()
        self._feed_restart = threading.Event()
        self._feed_thread: threading.Thread | None = None
        self._symbol_lock = threading.RLock()
        self._ref_to_symbol: dict[int, str] = {}

    async def run(self, ws: WebSocket) -> None:
        self._ws = ws
        self._loop = asyncio.get_running_loop()
        self._event_queue = asyncio.Queue()
        await self._send("status", message="Preparing live quotes for selected leaders.")
        await self._emit_cached_quotes()
        self._start_feed_thread()

        receive_task = asyncio.create_task(self._receive_client_messages())
        consume_task = asyncio.create_task(self._consume_events())
        try:
            await asyncio.wait({receive_task, consume_task}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            receive_task.cancel()
            consume_task.cancel()
            await self._shutdown()

    async def _receive_client_messages(self) -> None:
        if self._ws is None:
            return
        try:
            while not self._closed:
                payload = await self._ws.receive_json()
                if str(payload.get("type") or "") == "set_symbols":
                    symbols = self._normalize_symbols(payload.get("symbols"))
                    with self._symbol_lock:
                        if symbols != self._symbols:
                            self._symbols = symbols
                            self._feed_restart.set()
                    await self._emit_cached_quotes()
        except WebSocketDisconnect:
            self._closed = True
        except Exception as exc:
            log.debug("Volume quote client receive loop ended: %s", exc)
            self._closed = True

    async def _consume_events(self) -> None:
        if self._event_queue is None:
            return
        while not self._closed:
            event = await self._event_queue.get()
            event_type = str(event.pop("type", ""))
            await self._send(event_type, **event)

    def _start_feed_thread(self) -> None:
        self._feed_stop.clear()
        self._feed_thread = threading.Thread(
            target=self._run_feed_loop,
            daemon=True,
            name="volume-quote-live-feed",
        )
        self._feed_thread.start()

    def _run_feed_loop(self) -> None:
        while not self._feed_stop.is_set() and not self._closed:
            symbols = self._current_symbols()
            ref_ids = self._resolve_ref_ids(symbols)
            if not ref_ids:
                self._queue_event("status", message="Waiting for symbols with resolved Nubra ref_ids.")
                if self._feed_stop.wait(_RECONNECT_SECONDS):
                    break
                continue

            ws_url = "wss://uatapi.nubra.io/apibatch/ws" if self._environment == "UAT" else "wss://api.nubra.io/apibatch/ws"
            payload = json.dumps({"indexes": [], "instruments": ref_ids}, separators=(",", ":"))
            self._feed_restart.clear()
            try:
                self._queue_event("status", message=f"Connecting live quotes for {len(ref_ids)} symbols.")
                with ws_connect(
                    ws_url,
                    additional_headers={"x-device-id": self._device_id},
                    max_size=None,
                    open_timeout=20,
                    close_timeout=5,
                ) as websocket:
                    websocket.send(f"batch_subscribe {self._session_token} orderbook {payload}")
                    self._queue_event("connected", symbols=symbols, ref_ids=ref_ids)
                    for message in websocket:
                        if self._feed_stop.is_set() or self._closed or self._feed_restart.is_set():
                            break
                        if isinstance(message, (bytes, bytearray)):
                            self._dispatch_orderbook(bytes(message))
            except Exception as exc:
                if self._feed_stop.is_set() or self._closed:
                    break
                self._queue_event("status", message=f"Live quote feed reconnecting: {exc}")
                if self._feed_stop.wait(_RECONNECT_SECONDS):
                    break

    def _dispatch_orderbook(self, raw: bytes) -> None:
        channel = ""
        payload = b""
        type_url = ""

        try:
            envelope = GenericData()
            envelope.ParseFromString(raw)
            channel = str(getattr(envelope, "key", "") or "").strip().lower()
            payload = bytes(getattr(envelope.data, "value", b"") or b"")
            type_url = str(getattr(envelope.data, "type_url", "") or "")
        except Exception:
            pass

        if not payload:
            try:
                outer = Any()
                outer.ParseFromString(raw)
                inner = Any()
                inner.ParseFromString(outer.value)
                payload = bytes(inner.value)
                type_url = str(inner.type_url or "")
            except Exception:
                return

        if channel not in {"", "orderbook"} and not type_url.endswith("BatchWebSocketOrderbookMessage"):
            return

        message = BatchWebSocketOrderbookMessage()
        message.ParseFromString(payload)
        for item in list(message.instruments):
            instrument_id = _coerce_tick_instrument_id(item)
            symbol = self._ref_to_symbol.get(instrument_id or 0)
            if not symbol:
                continue
            epoch_s = _normalize_epoch_seconds(getattr(item, "timestamp", 0))
            ltp = float(getattr(item, "ltp", 0) or 0) / 100.0
            volume = float(getattr(item, "volume", 0) or 0.0)
            if ltp <= 0:
                continue
            self._queue_event(
                "quote",
                quote={
                    "symbol": symbol,
                    "last_price": ltp,
                    "volume": volume,
                    "updated_at_ist": self._format_timestamp(epoch_s),
                    "source": "websocket",
                    "stale": False,
                },
            )

    def _resolve_ref_ids(self, symbols: list[str]) -> list[int]:
        ref_to_symbol: dict[int, str] = {}
        for symbol in symbols:
            try:
                ref_id, _lot_size, _tick_size = instrument_service.resolve_stock_meta(
                    self._session_token,
                    self._environment,
                    self._device_id,
                    symbol,
                )
            except Exception as exc:
                log.debug("Unable to resolve live quote ref_id for %s: %s", symbol, exc)
                continue
            ref_to_symbol[int(ref_id)] = symbol
        self._ref_to_symbol = ref_to_symbol
        return sorted(ref_to_symbol)

    async def _emit_cached_quotes(self) -> None:
        snapshot = volume_breakout_service.status()
        rows = (
            list(snapshot.market_breakouts)
            + list(snapshot.recent_breakouts)
            + list(snapshot.confirmed_breakouts)
            + list(snapshot.movers_up)
            + list(snapshot.movers_down)
        )
        by_symbol = {row.symbol.upper(): row for row in rows}
        quotes = []
        for symbol in self._current_symbols():
            row = by_symbol.get(symbol)
            if not row:
                continue
            quotes.append(
                {
                    "symbol": symbol,
                    "last_price": row.last_price,
                    "volume": row.current_volume,
                    "day_change_pct": row.day_change_pct,
                    "updated_at_ist": row.candle_time_ist,
                    "source": "scanner_cache",
                    "stale": True,
                }
            )
        if quotes:
            await self._send("snapshot", quotes=quotes)

    def _queue_event(self, event_type: str, **kwargs) -> None:
        if self._loop is None or self._event_queue is None or self._closed:
            return
        self._loop.call_soon_threadsafe(self._event_queue.put_nowait, {"type": event_type, **kwargs})

    async def _send(self, msg_type: str, **kwargs) -> None:
        if self._ws is None or self._closed:
            return
        try:
            await self._ws.send_json({"type": msg_type, **kwargs})
        except Exception:
            self._closed = True

    def _current_symbols(self) -> list[str]:
        with self._symbol_lock:
            return list(self._symbols)

    def _normalize_symbols(self, value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        symbols: list[str] = []
        seen: set[str] = set()
        for item in value:
            symbol = str(item or "").strip().upper()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            symbols.append(symbol)
            if len(symbols) >= _MAX_SYMBOLS:
                break
        return symbols

    def _format_timestamp(self, epoch_s: int) -> str:
        if epoch_s <= 0:
            return datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
        return datetime.fromtimestamp(epoch_s, tz=IST).strftime("%Y-%m-%d %H:%M:%S IST")

    async def _shutdown(self) -> None:
        self._closed = True
        self._feed_stop.set()
        self._feed_restart.set()
        if self._feed_thread and self._feed_thread.is_alive():
            await asyncio.to_thread(self._feed_thread.join, 2.0)
