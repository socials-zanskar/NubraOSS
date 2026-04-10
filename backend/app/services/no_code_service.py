from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from fastapi import HTTPException
from nubra_talib import add_talib, to_ohlcv_df

from app.config import settings
from app.schemas import (
    IndicatorType,
    NoCodeAlert,
    NoCodeDebugSnapshot,
    NoCodeExecutionState,
    NoCodeInstrumentMetaRequest,
    NoCodeInstrumentMetaResponse,
    NoCodeStartRequest,
    NoCodeStatusResponse,
    NoCodeTrackerRow,
)
from app.services.instrument_service import instrument_service
from app.services.nubra_order_updates import NubraOrderUpdateStream, OrderUpdateEvent

IST = ZoneInfo("Asia/Kolkata")
UTC = ZoneInfo("UTC")
MARKET_OPEN = dt_time(hour=9, minute=15)
MARKET_CLOSE = dt_time(hour=15, minute=30)
INTERVAL_MINUTES = {
    "1m": 1,
    "2m": 2,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
}
TIMEFRAME_MAP = {
    "1m": "1m",
    "2m": "2m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
}
INDEX_SYMBOLS = {
    "NIFTY": ("NSE", "INDEX"),
    "BANKNIFTY": ("NSE", "INDEX"),
    "FINNIFTY": ("NSE", "INDEX"),
    "MIDCPNIFTY": ("NSE", "INDEX"),
    "SENSEX": ("BSE", "INDEX"),
    "BANKEX": ("BSE", "INDEX"),
}


@dataclass
class NoCodeRuntime:
    request: NoCodeStartRequest
    running: bool = False
    market_status: str = "idle"
    last_run_ist: str | None = None
    next_run_ist: str | None = None
    last_signal: str | None = None
    last_error: str | None = None
    alerts: list[NoCodeAlert] | None = None
    tracker_rows: list[NoCodeTrackerRow] | None = None
    last_alert_key: str | None = None
    debug: NoCodeDebugSnapshot | None = None
    execution: NoCodeExecutionState | None = None
    order_update_stream: NubraOrderUpdateStream | None = None

    def __post_init__(self) -> None:
        if self.alerts is None:
            self.alerts = []
        if self.tracker_rows is None:
            self.tracker_rows = []
        if self.execution is None:
            self.execution = NoCodeExecutionState(
                enabled=True,
                instrument_ref_id=None,
                instrument_tick_size=None,
                instrument_lot_size=None,
                desired_side=None,
                position_side=None,
                position_qty=0,
                pending_order_id=None,
                pending_order_side=None,
                pending_order_action=None,
                pending_followup_signal=None,
                last_order_status=None,
                last_execution_status=None,
                last_order_update=None,
                last_positions_sync_ist=None,
            )


class NoCodeService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._runtime: NoCodeRuntime | None = None

    def _append_tracker_row(self, runtime: NoCodeRuntime, alert: str, side: str, position_state: str) -> None:
        if runtime.tracker_rows is None:
            runtime.tracker_rows = []
        runtime.tracker_rows.insert(
            0,
            NoCodeTrackerRow(
                alert=alert,
                side=side,
                position_state=position_state,
                time_ist=self._current_ist().strftime("%H:%M:%S %Z"),
            ),
        )
        runtime.tracker_rows = runtime.tracker_rows[:12]

    def _get_base_url(self, environment: str) -> str:
        if environment == "UAT":
            return settings.nubra_uat_base_url
        return settings.nubra_prod_base_url

    def _extract_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = payload.get("message") or payload.get("detail") or payload.get("error")
        if isinstance(detail, str) and detail.strip():
            return detail
        return f"Nubra request failed with status {response.status_code}."

    def _infer_instrument_context(self, instrument: str) -> tuple[str, str, str]:
        symbol = instrument.strip().upper()
        if symbol in INDEX_SYMBOLS:
            exchange, instrument_type = INDEX_SYMBOLS[symbol]
            return symbol, exchange, instrument_type

        parts = [part for part in symbol.replace('-', ' ').split() if part]
        last_part = parts[-1] if parts else symbol
        second_last = parts[-2] if len(parts) > 1 else ''

        is_option = (
            last_part in {"CE", "PE"}
            or second_last in {"CE", "PE"}
            or symbol.endswith("-CE")
            or symbol.endswith("-PE")
        )
        if is_option:
            return symbol, "NSE", "OPT"

        is_future = (
            last_part == "FUT"
            or symbol.endswith("-FUT")
            or symbol.endswith(" FUT")
        )
        if is_future:
            return symbol, "NSE", "FUT"

        return symbol, "NSE", "STOCK"

    def _current_ist(self) -> datetime:
        return datetime.now(IST)

    def _is_trading_day(self, dt: datetime) -> bool:
        return dt.weekday() < 5

    def _next_trading_day_open(self, dt: datetime) -> datetime:
        candidate = dt
        while True:
            candidate = candidate + timedelta(days=1)
            candidate = candidate.replace(
                hour=MARKET_OPEN.hour,
                minute=MARKET_OPEN.minute,
                second=0,
                microsecond=0,
            )
            if self._is_trading_day(candidate):
                return candidate

    def _compute_next_run(self, now_ist: datetime, interval: str) -> tuple[datetime, str]:
        interval_minutes = INTERVAL_MINUTES[interval]
        market_open_dt = now_ist.replace(
            hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0
        )
        market_close_dt = now_ist.replace(
            hour=MARKET_CLOSE.hour, minute=MARKET_CLOSE.minute, second=0, microsecond=0
        )

        if not self._is_trading_day(now_ist):
            return self._next_trading_day_open(now_ist), "market_closed"
        if now_ist < market_open_dt:
            return market_open_dt, "waiting_for_open"
        if now_ist >= market_close_dt:
            return self._next_trading_day_open(now_ist), "market_closed"

        elapsed_minutes = int((now_ist - market_open_dt).total_seconds() // 60)
        remainder = elapsed_minutes % interval_minutes
        next_run = now_ist.replace(second=0, microsecond=0)
        if remainder == 0 and now_ist.second == 0 and now_ist.microsecond == 0:
            return next_run, "armed"

        minutes_to_add = interval_minutes - remainder if remainder != 0 else interval_minutes
        next_run = next_run + timedelta(minutes=minutes_to_add)
        if next_run > market_close_dt:
            return self._next_trading_day_open(now_ist), "market_closed"
        return next_run, "armed"

    def _fetch_intraday_history(self, runtime: NoCodeRuntime, now_ist: datetime) -> pd.DataFrame:
        symbol, exchange, instrument_type = self._infer_instrument_context(runtime.request.instrument)
        base_url = self._get_base_url(runtime.request.environment)
        start_utc = now_ist.replace(
            hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0
        ).astimezone(UTC)
        end_utc = now_ist.astimezone(UTC)

        payload = {
            "query": [
                {
                    "exchange": exchange,
                    "type": instrument_type,
                    "values": [symbol],
                    "fields": ["open", "high", "low", "close", "cumulative_volume"],
                    "startDate": start_utc.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "endDate": end_utc.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "interval": TIMEFRAME_MAP[runtime.request.interval],
                    "intraDay": True,
                    "realTime": False,
                }
            ]
        }

        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{base_url}/charts/timeseries",
                json=payload,
                headers={
                    "Authorization": f"Bearer {runtime.request.session_token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-device-id": runtime.request.device_id,
                },
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            data = response.json()

        result = data.get("result", [])
        if not result:
            raise HTTPException(status_code=502, detail="Nubra returned no historical data result.")
        normalized = self._normalize_history_payload(data, symbol)
        df = to_ohlcv_df(
            normalized,
            symbol=symbol,
            tz="Asia/Kolkata",
            paise_to_rupee=True,
            interval=runtime.request.interval,
        )
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No candles returned for {symbol}.")
        return df

    def _normalize_history_payload(self, payload: dict, symbol: str) -> SimpleNamespace:
        result_list = payload.get("result", [])
        normalized_result: list[SimpleNamespace] = []

        for result_item in result_list:
            normalized_values: list[dict] = []
            for stock_data in result_item.get("values", []):
                symbol_chart = stock_data.get(symbol)
                if not symbol_chart:
                    continue

                normalized_chart: dict[str, list[dict[str, int | float]]] = {}
                for field in ("open", "high", "low", "close", "cumulative_volume", "tick_volume"):
                    points = symbol_chart.get(field, [])
                    target_field = "cumulative_volume" if field == "tick_volume" else field
                    normalized_chart[target_field] = [
                        {
                            "timestamp": int(point.get("ts", 0)),
                            "value": point.get("v", 0),
                        }
                        for point in points
                        if point.get("ts") is not None
                    ]

                normalized_values.append({symbol: normalized_chart})

            normalized_result.append(SimpleNamespace(values=normalized_values))

        return SimpleNamespace(result=normalized_result)

    def _completed_candles_only(self, df: pd.DataFrame, runtime: NoCodeRuntime, now_ist: datetime) -> pd.DataFrame:
        interval_minutes = INTERVAL_MINUTES[runtime.request.interval]
        market_open_dt = now_ist.replace(
            hour=MARKET_OPEN.hour, minute=MARKET_OPEN.minute, second=0, microsecond=0
        )
        elapsed_minutes = int((now_ist - market_open_dt).total_seconds() // 60)
        current_candle_index = max(elapsed_minutes // interval_minutes, 0)
        current_candle_start = market_open_dt + timedelta(minutes=current_candle_index * interval_minutes)
        completed = df[df["timestamp"] < current_candle_start].copy()
        return completed.reset_index(drop=True)

    def _request_headers(self, runtime: NoCodeRuntime) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {runtime.request.session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": runtime.request.device_id,
        }

    def _coerce_positive_int(self, value: object, fallback: int | None = None) -> int | None:
        try:
            coerced = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return fallback
        if coerced <= 0:
            return fallback
        return coerced

    def _resolve_instrument_metadata(self, runtime: NoCodeRuntime) -> tuple[int, int, int]:
        symbol, exchange, instrument_type = self._infer_instrument_context(runtime.request.instrument)
        if instrument_type == "STOCK":
            return instrument_service.resolve_stock_meta(
                runtime.request.session_token,
                runtime.request.environment,
                runtime.request.device_id,
                symbol,
            )
        raise HTTPException(status_code=400, detail="Only stock instruments are supported in the current no-code flow.")

    def _normalize_order_qty(self, execution: NoCodeExecutionState, requested_qty: int) -> int:
        lot_size = execution.instrument_lot_size or 1
        normalized = max(requested_qty, lot_size)
        if lot_size > 1:
            remainder = normalized % lot_size
            if remainder != 0:
                normalized += lot_size - remainder
        return normalized

    def _get_position_snapshot(self, runtime: NoCodeRuntime) -> tuple[str | None, int]:
        execution = runtime.execution
        if execution is None or execution.instrument_ref_id is None:
            return None, 0

        base_url = self._get_base_url(runtime.request.environment)
        with httpx.Client(timeout=20.0) as client:
            response = client.get(f"{base_url}/portfolio/positions", headers=self._request_headers(runtime))
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()

        portfolio = payload.get("portfolio", {})
        buckets = [
            portfolio.get("stock_positions") or [],
            portfolio.get("fut_positions") or [],
            portfolio.get("opt_positions") or [],
        ]
        side: str | None = None
        qty = 0
        for bucket in buckets:
            for item in bucket:
                if int(item.get("ref_id", 0)) != execution.instrument_ref_id:
                    continue
                item_qty = int(item.get("qty", 0) or 0)
                if item_qty <= 0:
                    continue
                side = str(item.get("order_side") or "").upper() or None
                qty += item_qty
        execution.position_side = side
        execution.position_qty = qty
        execution.last_positions_sync_ist = self._current_ist().strftime("%Y-%m-%d %H:%M:%S %Z")
        return side, qty

    def _get_current_price_paise(self, runtime: NoCodeRuntime) -> int:
        symbol, exchange, _ = self._infer_instrument_context(runtime.request.instrument)
        base_url = self._get_base_url(runtime.request.environment)
        params = {"exchange": exchange} if exchange == "BSE" else None
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{base_url}/optionchains/{symbol}/price",
                params=params,
                headers=self._request_headers(runtime),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()

        price = payload.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            raise HTTPException(status_code=502, detail=f"Invalid current price returned for {symbol}.")
        return int(price)

    def _compute_aggressive_limit_price(self, execution: NoCodeExecutionState, side: str, ltp_paise: int) -> int:
        tick_size = execution.instrument_tick_size or 1
        if side == "ORDER_SIDE_BUY":
            aggressive_price = ltp_paise * 1.02
            snapped = int(aggressive_price)
            remainder = snapped % tick_size
            if remainder != 0:
                snapped += tick_size - remainder
        else:
            aggressive_price = ltp_paise * 0.98
            snapped = int(aggressive_price)
            snapped -= snapped % tick_size
            if snapped <= 0:
                snapped = tick_size
        return max(snapped, tick_size, 1)

    def _place_limit_order(self, runtime: NoCodeRuntime, side: str, qty: int, action: str) -> None:
        execution = runtime.execution
        if execution is None or execution.instrument_ref_id is None:
            raise HTTPException(status_code=400, detail="Instrument ref_id must be resolved before order placement.")
        base_url = self._get_base_url(runtime.request.environment)
        ltp_paise = self._get_current_price_paise(runtime)
        order_price = self._compute_aggressive_limit_price(execution, side, ltp_paise)
        normalized_qty = self._normalize_order_qty(execution, qty)
        payload = {
            "ref_id": execution.instrument_ref_id,
            "order_type": "ORDER_TYPE_REGULAR",
            "order_qty": normalized_qty,
            "order_side": side,
            "order_delivery_type": runtime.request.order_delivery_type,
            "validity_type": "IOC",
            "price_type": "LIMIT",
            "order_price": order_price,
            "tag": f"nubraoss_{runtime.request.instrument.lower()}_{action}",
            "algo_params": {},
        }
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{base_url}/orders/v2/single",
                json=payload,
                headers=self._request_headers(runtime),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            order = response.json()

        execution.pending_order_id = int(order.get("order_id", 0) or 0) or None
        execution.pending_order_side = side
        execution.pending_order_action = action
        execution.last_order_status = order.get("order_status")
        execution.last_order_update = {
            "order_id": execution.pending_order_id,
            "order_status": order.get("order_status"),
            "order_side": order.get("order_side"),
            "ltp_price": ltp_paise,
            "tick_size": execution.instrument_tick_size,
            "lot_size": execution.instrument_lot_size,
            "requested_qty": qty,
            "order_qty": normalized_qty,
            "order_price": int(order.get("order_price", order_price) or order_price),
            "filled_qty": int(order.get("filled_qty", 0) or 0),
            "avg_filled_price": float(order.get("avg_filled_price", 0) or 0),
        }

    def _cancel_pending_order(self, runtime: NoCodeRuntime, reason: str) -> None:
        execution = runtime.execution
        if execution is None or execution.pending_order_id is None:
            return

        base_url = self._get_base_url(runtime.request.environment)
        order_id = execution.pending_order_id
        with httpx.Client(timeout=20.0) as client:
            response = client.delete(
                f"{base_url}/orders/{order_id}",
                headers=self._request_headers(runtime),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()

        execution.last_order_update = {
            "order_id": order_id,
            "cancel_reason": reason,
            "transport": "rest_cancel",
            "response": payload,
        }
        execution.last_order_status = "ORDER_REQUEST_CANCELLED"

    def _poll_pending_order(self, runtime: NoCodeRuntime) -> None:
        execution = runtime.execution
        if execution is None or execution.pending_order_id is None:
            return

        base_url = self._get_base_url(runtime.request.environment)
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{base_url}/orders/v2/{execution.pending_order_id}",
                headers=self._request_headers(runtime),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            order = response.json()

        event = OrderUpdateEvent(kind="order", payload=order)
        self._apply_order_update(runtime, event)

    def _signal_to_side(self, signal: str) -> str:
        if signal in {
            "EMA_BULLISH_CROSS",
            "EMA_BULLISH_STATE",
            "MA_BULLISH_CROSS",
            "MA_BULLISH_STATE",
            "RSI_OVERSOLD",
            "RSI_BULLISH_STATE",
        }:
            return "ORDER_SIDE_BUY"
        return "ORDER_SIDE_SELL"

    def _normalize_position_side(self, current_side: str | None) -> str | None:
        if current_side == "BUY":
            return "ORDER_SIDE_BUY"
        if current_side == "SELL":
            return "ORDER_SIDE_SELL"
        return None

    def _allowed_entry_side(self, runtime: NoCodeRuntime, signal_side: str) -> str | None:
        mode = runtime.request.strategy_side_mode
        if mode == "BOTH":
            return signal_side
        if mode == "LONG_ONLY":
            return "ORDER_SIDE_BUY" if signal_side == "ORDER_SIDE_BUY" else None
        if mode == "SHORT_ONLY":
            return "ORDER_SIDE_SELL" if signal_side == "ORDER_SIDE_SELL" else None
        return None

    def _handle_signal_execution(self, runtime: NoCodeRuntime, signal: str) -> None:
        execution = runtime.execution
        if execution is None:
            return

        signal_side = self._signal_to_side(signal)
        desired_entry_side = self._allowed_entry_side(runtime, signal_side)
        execution.desired_side = desired_entry_side or signal_side
        if execution.instrument_ref_id is None:
            ref_id, lot_size, tick_size = self._resolve_instrument_metadata(runtime)
            execution.instrument_ref_id = ref_id
            execution.instrument_lot_size = lot_size
            execution.instrument_tick_size = tick_size

        current_side, current_qty = self._get_position_snapshot(runtime)
        normalized_position_side = self._normalize_position_side(current_side)

        planned_action: str | None = None
        planned_side: str | None = None
        planned_qty = 0
        planned_followup_signal: str | None = None

        if current_qty <= 0 or normalized_position_side is None:
            if desired_entry_side is not None:
                planned_action = "entry"
                planned_side = desired_entry_side
                planned_qty = runtime.request.order_qty
        elif desired_entry_side is None:
            if normalized_position_side != signal_side:
                planned_action = "exit"
                planned_side = "ORDER_SIDE_SELL" if normalized_position_side == "ORDER_SIDE_BUY" else "ORDER_SIDE_BUY"
                planned_qty = current_qty
        elif normalized_position_side == desired_entry_side:
            return
        else:
            planned_action = "exit"
            planned_side = "ORDER_SIDE_SELL" if normalized_position_side == "ORDER_SIDE_BUY" else "ORDER_SIDE_BUY"
            planned_qty = current_qty
            planned_followup_signal = signal

        if execution.pending_order_id is not None:
            if planned_action is None:
                if execution.pending_order_action == "entry":
                    execution.pending_followup_signal = None
                    self._cancel_pending_order(runtime, "signal_no_longer_requires_entry")
                return

            if execution.pending_order_action == planned_action and execution.pending_order_side == planned_side:
                execution.pending_followup_signal = planned_followup_signal
                return

            execution.pending_followup_signal = signal
            self._cancel_pending_order(runtime, f"signal_reconcile_to_{signal_side.lower()}")
            return

        if planned_action is None or planned_side is None or planned_qty <= 0:
            return

        execution.pending_followup_signal = planned_followup_signal
        self._place_limit_order(runtime, planned_side, planned_qty, planned_action)

    def _apply_order_update(self, runtime: NoCodeRuntime, event: OrderUpdateEvent) -> None:
        execution = runtime.execution
        if execution is None:
            return
        if event.kind == "text":
            execution.last_order_update = {"message": str(event.payload.get("message"))}
            return
        if event.kind == "error":
            execution.last_order_update = {
                "transport": "websocket",
                "message": str(event.payload.get("message")),
                "fallback": "rest_polling",
            }
            return

        payload = event.payload
        order_id = payload.get("order_id") or payload.get("id")
        if execution.pending_order_id is not None and str(order_id) != str(execution.pending_order_id):
            return

        order_status = payload.get("order_status")
        execution_status = payload.get("execution_status")
        execution.last_order_status = str(order_status) if order_status is not None else execution.last_order_status
        execution.last_execution_status = str(execution_status) if execution_status is not None else execution.last_execution_status
        execution.last_order_update = payload

        terminal = {
            "ORDER_STATUS_FILLED",
            "ORDER_STATUS_REJECTED",
            "ORDER_STATUS_CANCELLED",
            "EXECUTION_STATUS_FILLED",
            "EXECUTION_STATUS_REJECTED",
            "EXECUTION_STATUS_CANCELLED",
            "EXECUTION_STATUS_CLOSED",
        }
        if (order_status not in terminal) and (execution_status not in terminal):
            return

        self._get_position_snapshot(runtime)
        completed_action = execution.pending_order_action
        followup_signal = execution.pending_followup_signal
        tracked_side = execution.pending_order_side
        execution.pending_order_id = None
        execution.pending_order_side = None
        execution.pending_order_action = None
        execution.pending_followup_signal = None

        if completed_action in {"entry", "exit"}:
            side_label = "BUY" if tracked_side == "ORDER_SIDE_BUY" else "SELL"
            position_state = "OPEN" if execution.position_qty > 0 else "CLOSED"
            self._append_tracker_row(runtime, runtime.last_signal or completed_action.upper(), side_label, position_state)

        if followup_signal:
            self._handle_signal_execution(runtime, followup_signal)
            return

        if completed_action == "exit" and execution.position_qty == 0:
            return

    def _start_order_updates(self, runtime: NoCodeRuntime) -> None:
        runtime.order_update_stream = NubraOrderUpdateStream(
            environment=runtime.request.environment,
            session_token=runtime.request.session_token,
            on_event=lambda event: self._on_order_update(event),
        )
        runtime.order_update_stream.start()

    def _on_order_update(self, event: OrderUpdateEvent) -> None:
        with self._lock:
            runtime = self._runtime
            if runtime is None:
                return
            try:
                self._apply_order_update(runtime, event)
            except Exception as exc:
                runtime.last_error = str(exc)

    def _apply_indicator_columns(self, runtime: NoCodeRuntime, df: pd.DataFrame) -> pd.DataFrame:
        if runtime.request.indicator == "EMA":
            config = runtime.request.ema
            if not config:
                raise HTTPException(status_code=400, detail="EMA parameters are required.")
            enriched = add_talib(df, {"EMA": {"timeperiod": config.fast}})
            enriched = enriched.rename(columns={"ema": "ema_fast"})
            enriched["ema_slow"] = add_talib(df, {"EMA": {"timeperiod": config.slow}})["ema"]
            return enriched

        if runtime.request.indicator == "MA":
            config = runtime.request.ma
            if not config:
                raise HTTPException(status_code=400, detail="MA parameters are required.")
            enriched = add_talib(df, {"SMA": {"timeperiod": config.fast}})
            enriched = enriched.rename(columns={"sma": "ma_fast"})
            enriched["ma_slow"] = add_talib(df, {"SMA": {"timeperiod": config.slow}})["sma"]
            return enriched

        config = runtime.request.rsi
        if not config:
            raise HTTPException(status_code=400, detail="RSI parameters are required.")
        enriched = add_talib(df, {"RSI": {"timeperiod": config.length}})
        return enriched.rename(columns={"rsi": "rsi"})

    def _serialize_debug_df(self, df: pd.DataFrame) -> list[dict[str, str | float | int | None]]:
        rows: list[dict[str, str | float | int | None]] = []
        for record in df.to_dict(orient="records"):
            serialized: dict[str, str | float | int | None] = {}
            for key, value in record.items():
                if pd.isna(value):
                    serialized[key] = None
                elif isinstance(value, pd.Timestamp):
                    serialized[key] = value.strftime("%Y-%m-%d %H:%M:%S %Z")
                elif isinstance(value, float):
                    serialized[key] = round(value, 4)
                else:
                    serialized[key] = value
            rows.append(serialized)
        return rows

    def _evaluate_signal(
        self, runtime: NoCodeRuntime, df: pd.DataFrame
    ) -> tuple[str | None, str | None, NoCodeDebugSnapshot]:
        if len(df) < 3:
            latest = df.iloc[-1] if not df.empty else None
            debug = NoCodeDebugSnapshot(
                last_completed_candle_ist=latest["timestamp"].strftime("%Y-%m-%d %H:%M:%S %Z")
                if latest is not None
                else None,
                last_close=float(latest["close"]) if latest is not None else None,
                indicator_values={},
                dataframe_rows=self._serialize_debug_df(df),
            )
            return None, None, debug

        working_df = self._apply_indicator_columns(runtime, df.copy())
        latest = working_df.iloc[-1]
        previous = working_df.iloc[-2]

        if runtime.request.indicator == "EMA":
            config = runtime.request.ema
            if not config:
                raise HTTPException(status_code=400, detail="EMA parameters are required.")
            fast = working_df["ema_fast"]
            slow = working_df["ema_slow"]
            debug = NoCodeDebugSnapshot(
                last_completed_candle_ist=latest["timestamp"].strftime("%Y-%m-%d %H:%M:%S %Z"),
                last_close=float(latest["close"]),
                indicator_values={
                    "ema_fast_latest": round(float(fast.iloc[-1]), 4),
                    "ema_slow_latest": round(float(slow.iloc[-1]), 4),
                    "ema_fast_previous": round(float(fast.iloc[-2]), 4),
                    "ema_slow_previous": round(float(slow.iloc[-2]), 4),
                },
                dataframe_rows=self._serialize_debug_df(working_df),
            )
            if fast.iloc[-1] > slow.iloc[-1] and fast.iloc[-2] <= slow.iloc[-2]:
                return "EMA_BULLISH_CROSS", f"Fast EMA {config.fast} crossed above slow EMA {config.slow}.", debug
            if fast.iloc[-1] < slow.iloc[-1] and fast.iloc[-2] >= slow.iloc[-2]:
                return "EMA_BEARISH_CROSS", f"Fast EMA {config.fast} crossed below slow EMA {config.slow}.", debug
            return None, None, debug

        if runtime.request.indicator == "MA":
            config = runtime.request.ma
            if not config:
                raise HTTPException(status_code=400, detail="MA parameters are required.")
            fast = working_df["ma_fast"]
            slow = working_df["ma_slow"]
            debug = NoCodeDebugSnapshot(
                last_completed_candle_ist=latest["timestamp"].strftime("%Y-%m-%d %H:%M:%S %Z"),
                last_close=float(latest["close"]),
                indicator_values={
                    "ma_fast_latest": round(float(fast.iloc[-1]), 4) if pd.notna(fast.iloc[-1]) else None,
                    "ma_slow_latest": round(float(slow.iloc[-1]), 4) if pd.notna(slow.iloc[-1]) else None,
                    "ma_fast_previous": round(float(fast.iloc[-2]), 4) if pd.notna(fast.iloc[-2]) else None,
                    "ma_slow_previous": round(float(slow.iloc[-2]), 4) if pd.notna(slow.iloc[-2]) else None,
                },
                dataframe_rows=self._serialize_debug_df(working_df),
            )
            if pd.isna(fast.iloc[-1]) or pd.isna(slow.iloc[-1]):
                return None, None, debug
            if fast.iloc[-1] > slow.iloc[-1] and fast.iloc[-2] <= slow.iloc[-2]:
                return "MA_BULLISH_CROSS", f"Fast MA {config.fast} crossed above slow MA {config.slow}.", debug
            if fast.iloc[-1] < slow.iloc[-1] and fast.iloc[-2] >= slow.iloc[-2]:
                return "MA_BEARISH_CROSS", f"Fast MA {config.fast} crossed below slow MA {config.slow}.", debug
            return None, None, debug

        config = runtime.request.rsi
        if not config:
            raise HTTPException(status_code=400, detail="RSI parameters are required.")
        rsi = working_df["rsi"]
        debug = NoCodeDebugSnapshot(
            last_completed_candle_ist=latest["timestamp"].strftime("%Y-%m-%d %H:%M:%S %Z"),
            last_close=float(latest["close"]),
            indicator_values={
                "rsi_latest": round(float(rsi.iloc[-1]), 4),
                "rsi_previous": round(float(rsi.iloc[-2]), 4),
                "upper": float(config.upper),
                "lower": float(config.lower),
            },
            dataframe_rows=self._serialize_debug_df(working_df),
        )
        if rsi.iloc[-1] >= config.upper and rsi.iloc[-2] < config.upper:
            return "RSI_OVERBOUGHT", f"RSI crossed above {config.upper:.0f}.", debug
        if rsi.iloc[-1] <= config.lower and rsi.iloc[-2] > config.lower:
            return "RSI_OVERSOLD", f"RSI crossed below {config.lower:.0f}.", debug
        return None, None, debug

    def _record_alert(self, runtime: NoCodeRuntime, df: pd.DataFrame, signal: str, detail: str, now_ist: datetime) -> None:
        latest = df.iloc[-1]
        candle_time_ist = latest["timestamp"]
        if isinstance(candle_time_ist, pd.Timestamp):
            candle_time_ist_str = candle_time_ist.strftime("%Y-%m-%d %H:%M:%S %Z")
            candle_key = candle_time_ist.isoformat()
        else:
            candle_time_ist_str = str(candle_time_ist)
            candle_key = candle_time_ist_str
        alert_key = f"{signal}:{candle_key}"
        if runtime.last_alert_key == alert_key:
            return

        alert = NoCodeAlert(
            id=uuid.uuid4().hex,
            signal=signal,
            instrument=runtime.request.instrument.upper(),
            interval=runtime.request.interval,
            indicator=runtime.request.indicator,
            candle_time_ist=candle_time_ist_str,
            triggered_at_ist=now_ist.strftime("%Y-%m-%d %H:%M:%S %Z"),
            price=float(latest["close"]),
            detail=detail,
        )
        runtime.alerts.insert(0, alert)
        runtime.alerts = runtime.alerts[:20]
        runtime.last_signal = signal
        runtime.last_alert_key = alert_key

    def _execute_once(self, runtime: NoCodeRuntime, run_time_ist: datetime) -> None:
        df = self._fetch_intraday_history(runtime, run_time_ist)
        completed = self._completed_candles_only(df, runtime, run_time_ist)
        if completed.empty:
            runtime.last_error = "No completed candles available yet for the selected interval."
            return

        signal, detail, debug = self._evaluate_signal(runtime, completed)
        runtime.last_run_ist = run_time_ist.strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.last_error = None
        runtime.debug = debug

        if signal and detail:
            self._record_alert(runtime, completed, signal, detail, run_time_ist)
            self._handle_signal_execution(runtime, signal)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._lock:
                runtime = self._runtime
            if runtime is None:
                return

            now_ist = self._current_ist()
            next_run, market_status = self._compute_next_run(now_ist, runtime.request.interval)
            runtime.market_status = market_status
            runtime.next_run_ist = next_run.strftime("%Y-%m-%d %H:%M:%S %Z")

            sleep_seconds = max((next_run - now_ist).total_seconds(), 0)
            if self._stop_event.wait(sleep_seconds):
                return

            try:
                if runtime.execution and runtime.execution.pending_order_id is not None:
                    self._poll_pending_order(runtime)
                else:
                    self._get_position_snapshot(runtime)
                self._execute_once(runtime, next_run)
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
            except Exception as exc:
                runtime.last_error = str(exc)

    def _snapshot(self) -> NoCodeStatusResponse:
        runtime = self._runtime
        if runtime is None:
            return NoCodeStatusResponse(
                running=False,
                instrument=None,
                interval=None,
                indicator=None,
                strategy_side_mode=None,
                last_run_ist=None,
                next_run_ist=None,
                market_status="idle",
                last_signal=None,
                last_error=None,
                alerts=[],
                tracker_rows=[],
                debug=None,
                execution=None,
            )
        return NoCodeStatusResponse(
            running=runtime.running,
            instrument=runtime.request.instrument,
            interval=runtime.request.interval,
            indicator=runtime.request.indicator,
            strategy_side_mode=runtime.request.strategy_side_mode,
            last_run_ist=runtime.last_run_ist,
            next_run_ist=runtime.next_run_ist,
            market_status=runtime.market_status,
            last_signal=runtime.last_signal,
            last_error=runtime.last_error,
            alerts=list(runtime.alerts),
            tracker_rows=list(runtime.tracker_rows or []),
            debug=runtime.debug,
            execution=runtime.execution,
        )

    def get_instrument_meta(self, payload: NoCodeInstrumentMetaRequest) -> NoCodeInstrumentMetaResponse:
        ref_id, lot_size, tick_size = instrument_service.resolve_stock_meta(
            payload.session_token,
            payload.environment,
            payload.device_id,
            payload.instrument,
        )
        return NoCodeInstrumentMetaResponse(
            instrument=payload.instrument.upper(),
            ref_id=ref_id,
            tick_size=tick_size,
            lot_size=lot_size,
        )

    def start(self, payload: NoCodeStartRequest) -> NoCodeStatusResponse:
        if payload.indicator == "EMA" and not payload.ema:
            raise HTTPException(status_code=400, detail="EMA settings are required.")
        if payload.indicator == "MA" and not payload.ma:
            raise HTTPException(status_code=400, detail="MA settings are required.")
        if payload.indicator == "RSI" and not payload.rsi:
            raise HTTPException(status_code=400, detail="RSI settings are required.")
        if payload.ema and payload.ema.fast >= payload.ema.slow:
            raise HTTPException(status_code=400, detail="EMA fast value must be lower than slow value.")
        if payload.ma and payload.ma.fast >= payload.ma.slow:
            raise HTTPException(status_code=400, detail="MA fast value must be lower than slow value.")
        if payload.rsi and payload.rsi.lower >= payload.rsi.upper:
            raise HTTPException(status_code=400, detail="RSI lower threshold must be below upper threshold.")

        self.stop()
        runtime = NoCodeRuntime(request=payload, running=True, market_status="arming")
        with self._lock:
            self._runtime = runtime
            self._stop_event = threading.Event()
            try:
                if runtime.execution is not None:
                    ref_id, lot_size, tick_size = self._resolve_instrument_metadata(runtime)
                    runtime.execution.instrument_ref_id = ref_id
                    runtime.execution.instrument_lot_size = lot_size
                    runtime.execution.instrument_tick_size = tick_size
                self._get_position_snapshot(runtime)
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
            try:
                self._execute_once(runtime, self._current_ist())
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
            except Exception as exc:
                runtime.last_error = str(exc)
            self._start_order_updates(runtime)
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="no-code-runner")
            self._thread.start()
        return self._snapshot()

    def stop(self) -> NoCodeStatusResponse:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=1.0)
        self._thread = None
        with self._lock:
            if self._runtime:
                self._runtime.running = False
                self._runtime.market_status = "stopped"
                if self._runtime.order_update_stream is not None:
                    self._runtime.order_update_stream.stop()
            snapshot = self._snapshot()
            self._runtime = None
        return snapshot

    def status(self) -> NoCodeStatusResponse:
        return self._snapshot()


no_code_service = NoCodeService()
