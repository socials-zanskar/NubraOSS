from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, time as dt_time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from fastapi import HTTPException

from app.config import settings
from app.services.instrument_service import instrument_service
from app.services.strategy_backtester import ParsedStrategy, parse_strategy
from app.services.strategy_data import (
    IST_TZ,
    fetch_with_warmup,
    inject_indicator_columns,
    interval_is_intraday,
    required_history_bars,
)
from app.services.strategy_eval import evaluate_all, iter_expressions

IST = ZoneInfo(IST_TZ)
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


@dataclass
class LiveAlert:
    id: str
    instrument: str
    event: str
    candle_time_ist: str
    triggered_at_ist: str
    price: float
    detail: str


@dataclass
class LivePosition:
    instrument: str
    quantity: int
    entry_side: str
    entry_price: float
    entry_time_ist: str
    entry_order_id: int | None
    entry_order_status: str | None


@dataclass
class LiveRuntime:
    strategy: ParsedStrategy
    session_token: str
    device_id: str
    environment: str
    running: bool = False
    market_status: str = "idle"
    last_run_ist: str | None = None
    next_run_ist: str | None = None
    last_signal: str | None = None
    last_error: str | None = None
    alerts: list[LiveAlert] = field(default_factory=list)
    last_alert_keys: dict[str, str] = field(default_factory=dict)
    positions: dict[str, LivePosition] = field(default_factory=dict)
    instrument_cache: dict[str, dict[str, Any]] = field(default_factory=dict)


class StrategyLiveService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._runtime: LiveRuntime | None = None

    def _current_ist(self) -> datetime:
        return datetime.now(IST)

    def _is_trading_day(self, dt: datetime) -> bool:
        return dt.weekday() < 5

    def _parse_hhmm(self, value: str) -> dt_time:
        parts = value.strip().split(":")
        if len(parts) != 2:
            raise HTTPException(status_code=400, detail=f"Invalid time value '{value}'. Expected HH:MM.")
        return dt_time(hour=int(parts[0]), minute=int(parts[1]))

    def _strategy_session_times(self, strategy: ParsedStrategy) -> tuple[dt_time, dt_time]:
        configured_start = self._parse_hhmm(strategy.start_time)
        configured_end = self._parse_hhmm(strategy.end_time)
        session_start = max(configured_start, MARKET_OPEN)
        session_end = min(configured_end, MARKET_CLOSE)
        if session_end <= session_start:
            raise HTTPException(status_code=400, detail="Live strategy end time must be later than start time.")
        return session_start, session_end

    def _session_window(self, strategy: ParsedStrategy, current: datetime) -> tuple[datetime, datetime]:
        session_start_time, session_end_time = self._strategy_session_times(strategy)
        session_start = current.replace(
            hour=session_start_time.hour,
            minute=session_start_time.minute,
            second=0,
            microsecond=0,
        )
        session_end = current.replace(
            hour=session_end_time.hour,
            minute=session_end_time.minute,
            second=0,
            microsecond=0,
        )
        return session_start, session_end

    def _next_trading_day_time(self, dt: datetime, target_time: dt_time) -> datetime:
        candidate = dt
        while True:
            candidate = candidate + timedelta(days=1)
            candidate = candidate.replace(
                hour=target_time.hour,
                minute=target_time.minute,
                second=0,
                microsecond=0,
            )
            if self._is_trading_day(candidate):
                return candidate

    def _compute_next_run(self, now_ist: datetime, strategy: ParsedStrategy) -> tuple[datetime, str]:
        session_start, session_end = self._session_window(strategy, now_ist)

        if not self._is_trading_day(now_ist):
            return self._next_trading_day_time(now_ist, session_start.timetz().replace(tzinfo=None)), "market_closed"

        if not interval_is_intraday(strategy.interval):
            evaluation_time = session_end
            if now_ist < evaluation_time:
                return evaluation_time, "waiting_for_window"
            return self._next_trading_day_time(now_ist, evaluation_time.timetz().replace(tzinfo=None)), "waiting_for_next_session"

        if strategy.interval not in INTERVAL_MINUTES:
            raise HTTPException(status_code=400, detail=f"Unsupported live interval '{strategy.interval}'.")

        if now_ist < session_start:
            return session_start, "waiting_for_window"
        if now_ist >= session_end:
            return self._next_trading_day_time(now_ist, session_start.timetz().replace(tzinfo=None)), "market_closed"

        interval_minutes = INTERVAL_MINUTES[strategy.interval]
        elapsed_minutes = int((now_ist - session_start).total_seconds() // 60)
        remainder = elapsed_minutes % interval_minutes
        next_run = now_ist.replace(second=0, microsecond=0)
        if remainder == 0 and now_ist.second == 0 and now_ist.microsecond == 0:
            return next_run, "armed"

        minutes_to_add = interval_minutes - remainder if remainder != 0 else interval_minutes
        next_run = next_run + timedelta(minutes=minutes_to_add)
        if next_run > session_end:
            return self._next_trading_day_time(now_ist, session_start.timetz().replace(tzinfo=None)), "market_closed"
        return next_run, "armed"

    def _base_url(self, environment: str) -> str:
        return settings.nubra_uat_base_url if environment == "UAT" else settings.nubra_prod_base_url

    def _request_headers(self, session_token: str, device_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": device_id,
        }

    def _extract_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        detail = payload.get("message") or payload.get("detail") or payload.get("error")
        if isinstance(detail, str) and detail.strip():
            return detail
        return f"Nubra request failed with status {response.status_code}."

    def _resolve_instrument(self, runtime: LiveRuntime, instrument: str) -> dict[str, Any]:
        cached = runtime.instrument_cache.get(instrument)
        if cached is not None:
            return cached

        rows = instrument_service.search_stocks(
            runtime.session_token,
            runtime.environment,
            runtime.device_id,
            instrument,
            limit=20,
        )
        symbol = instrument.strip().upper()
        for row in rows:
            if str(row.get("instrument") or "").strip().upper() == symbol:
                runtime.instrument_cache[instrument] = row
                return row
        if rows:
            runtime.instrument_cache[instrument] = rows[0]
            return rows[0]
        raise HTTPException(status_code=404, detail=f"Unable to resolve instrument metadata for {symbol}.")

    def _get_current_price_paise(self, runtime: LiveRuntime, symbol: str, exchange: str) -> int:
        base_url = self._base_url(runtime.environment)
        params = {"exchange": exchange} if exchange == "BSE" else None
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{base_url}/optionchains/{symbol}/price",
                params=params,
                headers=self._request_headers(runtime.session_token, runtime.device_id),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            payload = response.json()
        price = payload.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            raise HTTPException(status_code=502, detail=f"Invalid current price returned for {symbol}.")
        return int(price)

    def _compute_aggressive_limit_price(self, tick_size: int, order_side: str, ltp_paise: int) -> int:
        if order_side == "ORDER_SIDE_BUY":
            aggressive_price = int(ltp_paise * 1.02)
            remainder = aggressive_price % tick_size
            if remainder != 0:
                aggressive_price += tick_size - remainder
            return max(aggressive_price, tick_size)
        aggressive_price = int(ltp_paise * 0.98)
        aggressive_price -= aggressive_price % tick_size
        if aggressive_price <= 0:
            aggressive_price = tick_size
        return max(aggressive_price, tick_size)

    def _fetch_order_snapshot(self, runtime: LiveRuntime, order_id: int) -> dict[str, Any] | None:
        base_url = self._base_url(runtime.environment)
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{base_url}/orders/v2/{order_id}",
                headers=self._request_headers(runtime.session_token, runtime.device_id),
            )
            if response.status_code >= 400:
                return None
            return response.json()

    def _order_delivery_type(self, strategy: ParsedStrategy) -> str:
        if strategy.entry_side == "SELL":
            return "ORDER_DELIVERY_TYPE_IDAY"
        return "ORDER_DELIVERY_TYPE_IDAY" if strategy.holding_type == "Intraday" else "ORDER_DELIVERY_TYPE_CNC"

    def _entry_quantity(self, capital: float, price: float, lot_size: int) -> int:
        if capital <= 0 or price <= 0:
            return 0
        if lot_size <= 1:
            return max(int(capital // price), 0)
        lots = int(capital // (price * lot_size))
        return max(lots, 0) * lot_size

    def _place_order(
        self,
        runtime: LiveRuntime,
        instrument: str,
        quantity: int,
        order_side: str,
    ) -> dict[str, Any]:
        if quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Quantity for {instrument} must be greater than zero.")

        listing = self._resolve_instrument(runtime, instrument)
        symbol = str(listing["instrument"]).strip().upper()
        exchange = str(listing.get("exchange") or "NSE").strip().upper()
        ref_id = int(listing["ref_id"])
        tick_size = int(listing["tick_size"])
        lot_size = int(listing["lot_size"])
        if lot_size > 1 and quantity % lot_size != 0:
            raise HTTPException(status_code=400, detail=f"Quantity {quantity} is not aligned to lot size {lot_size} for {symbol}.")

        ltp_paise = self._get_current_price_paise(runtime, symbol, exchange)
        order_price = self._compute_aggressive_limit_price(tick_size, order_side, ltp_paise)
        payload = {
            "ref_id": ref_id,
            "order_type": "ORDER_TYPE_REGULAR",
            "order_qty": quantity,
            "order_side": order_side,
            "order_delivery_type": self._order_delivery_type(runtime.strategy),
            "validity_type": "IOC",
            "price_type": "LIMIT",
            "order_price": order_price,
            "tag": f"nc_{runtime.strategy.entry_side.lower()}_{symbol.lower()}",
            "algo_params": {},
        }
        base_url = self._base_url(runtime.environment)
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{base_url}/orders/v2/single",
                json=payload,
                headers=self._request_headers(runtime.session_token, runtime.device_id),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            order = response.json()

        order_id = int(order.get("order_id", 0) or 0) or None
        snapshot = self._fetch_order_snapshot(runtime, order_id) if order_id else None
        effective = snapshot or order
        filled_qty = int(effective.get("filled_qty", order.get("filled_qty", 0)) or 0)
        avg_filled_price = effective.get("avg_filled_price", order.get("avg_filled_price"))
        avg_filled_price_value = float(avg_filled_price) if isinstance(avg_filled_price, (int, float)) else None
        order_status = str(effective.get("order_status") or order.get("order_status") or "submitted")
        ltp_rupees = float(ltp_paise) / 100.0
        order_price_rupees = float(order_price) / 100.0

        return {
            "symbol": symbol,
            "exchange": exchange,
            "order_id": order_id,
            "order_status": order_status,
            "requested_qty": quantity,
            "effective_qty": filled_qty if filled_qty > 0 else quantity,
            "filled_qty": filled_qty,
            "avg_filled_price": avg_filled_price_value,
            "fallback_price": order_price_rupees,
            "ltp_price": ltp_rupees,
        }

    def _record_alert(
        self,
        runtime: LiveRuntime,
        instrument: str,
        event: str,
        candle_time: str,
        now_ist: datetime,
        price: float,
        detail: str,
    ) -> None:
        key = f"{instrument}:{event}:{candle_time}"
        if runtime.last_alert_keys.get(instrument) == key:
            return
        runtime.last_alert_keys[instrument] = key
        alert = LiveAlert(
            id=uuid.uuid4().hex,
            instrument=instrument,
            event=event,
            candle_time_ist=candle_time,
            triggered_at_ist=now_ist.strftime("%Y-%m-%d %H:%M:%S %Z"),
            price=price,
            detail=detail,
        )
        runtime.alerts.insert(0, alert)
        runtime.alerts = runtime.alerts[:30]
        runtime.last_signal = event

    def _exit_side(self, entry_side: str) -> str:
        return "BUY" if entry_side == "SELL" else "SELL"

    def _position_exit_signal(
        self,
        runtime: LiveRuntime,
        position: LivePosition,
        last_bar: pd.Series,
        last_index: int,
        enriched: pd.DataFrame,
    ) -> tuple[str | None, float | None]:
        strategy = runtime.strategy

        if strategy.exit_mode in {"sl_tgt", "both"}:
            if position.entry_side == "BUY":
                if strategy.stop_loss_pct is not None:
                    stop_price = position.entry_price * (1 - strategy.stop_loss_pct / 100.0)
                    if float(last_bar["low"]) <= stop_price:
                        return "STOP_LOSS", stop_price
                if strategy.target_pct is not None:
                    target_price = position.entry_price * (1 + strategy.target_pct / 100.0)
                    if float(last_bar["high"]) >= target_price:
                        return "TARGET", target_price
            else:
                if strategy.stop_loss_pct is not None:
                    stop_price = position.entry_price * (1 + strategy.stop_loss_pct / 100.0)
                    if float(last_bar["high"]) >= stop_price:
                        return "STOP_LOSS", stop_price
                if strategy.target_pct is not None:
                    target_price = position.entry_price * (1 - strategy.target_pct / 100.0)
                    if float(last_bar["low"]) <= target_price:
                        return "TARGET", target_price

        if strategy.exit_mode in {"condition", "both"} and strategy.exit_conditions:
            if evaluate_all(enriched, last_index, strategy.exit_conditions):
                return "EXIT_CONDITION", float(last_bar["close"])

        candle_timestamp = last_bar["timestamp"]
        candle_dt = candle_timestamp.to_pydatetime() if hasattr(candle_timestamp, "to_pydatetime") else self._current_ist()
        _, session_end = self._strategy_session_times(strategy)
        candle_time = dt_time(hour=candle_dt.hour, minute=candle_dt.minute, second=candle_dt.second)
        if strategy.holding_type == "Intraday" and candle_time >= session_end:
            return "SESSION_CLOSE", float(last_bar["close"])

        return None, None

    def _evaluate_once(self, runtime: LiveRuntime, now_ist: datetime) -> None:
        strategy = runtime.strategy
        all_expressions = iter_expressions(strategy.entry_conditions) + iter_expressions(strategy.exit_conditions)
        warmup_bars = max((required_history_bars(expr, strategy.interval) for expr in all_expressions), default=0)

        requested_end = now_ist
        requested_start = now_ist - timedelta(days=10)
        last_error: str | None = None

        for symbol in strategy.instruments:
            try:
                df, _warmup_rows, _attempts = fetch_with_warmup(
                    session_token=runtime.session_token,
                    device_id=runtime.device_id,
                    environment=runtime.environment,
                    symbol=symbol,
                    interval=strategy.interval,
                    requested_start=requested_start,
                    requested_end=requested_end,
                    warmup_bars=warmup_bars,
                    intra_day=False,
                )
                if df.empty or len(df) < 2:
                    continue

                enriched = inject_indicator_columns(df, all_expressions)
                last_index = len(enriched) - 1
                last_bar = enriched.iloc[last_index]
                candle_time = str(last_bar["timestamp"])
                market_price = float(last_bar["close"])

                position = runtime.positions.get(symbol)
                if position is not None:
                    exit_reason, trigger_price = self._position_exit_signal(runtime, position, last_bar, last_index, enriched)
                    if exit_reason is not None:
                        order_result = self._place_order(
                            runtime,
                            symbol,
                            quantity=position.quantity,
                            order_side=f"ORDER_SIDE_{self._exit_side(position.entry_side)}",
                        )
                        exit_price = (
                            order_result["avg_filled_price"]
                            or order_result["fallback_price"]
                            or order_result["ltp_price"]
                            or trigger_price
                            or market_price
                        )
                        runtime.positions.pop(symbol, None)
                        self._record_alert(
                            runtime,
                            symbol,
                            exit_reason,
                            candle_time,
                            now_ist,
                            float(exit_price),
                            (
                                f"{exit_reason} order accepted on {symbol} for {order_result['effective_qty']} qty. "
                                f"Order #{order_result['order_id'] or '-'} status {order_result['order_status']}."
                            ),
                        )
                    continue

                if not evaluate_all(enriched, last_index, strategy.entry_conditions):
                    continue

                listing = self._resolve_instrument(runtime, symbol)
                quantity = self._entry_quantity(
                    strategy.initial_capital,
                    market_price,
                    int(listing["lot_size"]),
                )
                if quantity <= 0:
                    self._record_alert(
                        runtime,
                        symbol,
                        "ENTRY_SKIPPED",
                        candle_time,
                        now_ist,
                        market_price,
                        f"Skipped {symbol}: initial capital is not enough to buy the minimum tradable quantity.",
                    )
                    continue

                order_result = self._place_order(
                    runtime,
                    symbol,
                    quantity=quantity,
                    order_side=f"ORDER_SIDE_{strategy.entry_side}",
                )
                entry_price = (
                    order_result["avg_filled_price"]
                    or order_result["fallback_price"]
                    or order_result["ltp_price"]
                    or market_price
                )
                runtime.positions[symbol] = LivePosition(
                    instrument=symbol,
                    quantity=int(order_result["effective_qty"]),
                    entry_side=strategy.entry_side,
                    entry_price=float(entry_price),
                    entry_time_ist=candle_time,
                    entry_order_id=order_result["order_id"],
                    entry_order_status=order_result["order_status"],
                )
                self._record_alert(
                    runtime,
                    symbol,
                    f"ENTRY_{strategy.entry_side}",
                    candle_time,
                    now_ist,
                    float(entry_price),
                    (
                        f"Entry order accepted on {symbol} for {order_result['effective_qty']} qty. "
                        f"Order #{order_result['order_id'] or '-'} status {order_result['order_status']}."
                    ),
                )
            except HTTPException as exc:
                last_error = str(exc.detail)
                self._record_alert(
                    runtime,
                    symbol,
                    "ORDER_ERROR",
                    now_ist.strftime("%Y-%m-%d %H:%M:%S %Z"),
                    now_ist,
                    0.0,
                    last_error,
                )
            except Exception as exc:
                last_error = str(exc)
                self._record_alert(
                    runtime,
                    symbol,
                    "ORDER_ERROR",
                    now_ist.strftime("%Y-%m-%d %H:%M:%S %Z"),
                    now_ist,
                    0.0,
                    last_error,
                )

        runtime.last_run_ist = now_ist.strftime("%Y-%m-%d %H:%M:%S %Z")
        runtime.last_error = last_error

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            with self._lock:
                runtime = self._runtime
            if runtime is None:
                return

            now_ist = self._current_ist()
            try:
                next_run, market_status = self._compute_next_run(now_ist, runtime.strategy)
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
                return

            runtime.market_status = market_status
            runtime.next_run_ist = next_run.strftime("%Y-%m-%d %H:%M:%S %Z")

            sleep_seconds = max((next_run - now_ist).total_seconds(), 0)
            if self._stop_event.wait(sleep_seconds):
                return
            try:
                self._evaluate_once(runtime, next_run)
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
            except Exception as exc:
                runtime.last_error = str(exc)

    def status_payload(self) -> dict[str, Any]:
        runtime = self._runtime
        if runtime is None:
            return {
                "running": False,
                "instruments": [],
                "interval": None,
                "entry_side": None,
                "market_status": "idle",
                "last_run_ist": None,
                "next_run_ist": None,
                "last_signal": None,
                "last_error": None,
                "alerts": [],
            }
        return {
            "running": runtime.running,
            "instruments": runtime.strategy.instruments,
            "interval": runtime.strategy.interval,
            "entry_side": runtime.strategy.entry_side,
            "market_status": runtime.market_status,
            "last_run_ist": runtime.last_run_ist,
            "next_run_ist": runtime.next_run_ist,
            "last_signal": runtime.last_signal,
            "last_error": runtime.last_error,
            "alerts": [
                {
                    "id": alert.id,
                    "instrument": alert.instrument,
                    "event": alert.event,
                    "candle_time_ist": alert.candle_time_ist,
                    "triggered_at_ist": alert.triggered_at_ist,
                    "price": alert.price,
                    "detail": alert.detail,
                }
                for alert in runtime.alerts
            ],
        }

    def start(
        self,
        *,
        strategy_payload: dict[str, Any],
        session_token: str,
        device_id: str,
        environment: str,
    ) -> dict[str, Any]:
        strategy = parse_strategy(strategy_payload)
        self.stop()
        runtime = LiveRuntime(
            strategy=strategy,
            session_token=session_token,
            device_id=device_id,
            environment=environment,
            running=True,
            market_status="arming",
        )
        with self._lock:
            self._runtime = runtime
            self._stop_event = threading.Event()
            try:
                self._evaluate_once(runtime, self._current_ist())
            except HTTPException as exc:
                runtime.last_error = str(exc.detail)
            except Exception as exc:
                runtime.last_error = str(exc)
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="strategy-live-runner")
            self._thread.start()
        return self.status_payload()

    def stop(self) -> dict[str, Any]:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=1.0)
        self._thread = None
        with self._lock:
            if self._runtime is not None:
                self._runtime.running = False
                self._runtime.market_status = "stopped"
            snapshot = self.status_payload()
            self._runtime = None
        return snapshot


strategy_live_service = StrategyLiveService()
