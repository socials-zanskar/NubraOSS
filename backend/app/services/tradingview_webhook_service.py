from __future__ import annotations

import secrets
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from app.config import settings
from app.schemas import (
    TradingViewWebhookConfigureRequest,
    TradingViewWebhookHistoryEntry,
    TradingViewWebhookOrderRow,
    TradingViewWebhookPositionRow,
    TradingViewWebhookPnlSummary,
    TradingViewWebhookExecuteResponse,
    TradingViewWebhookSummary,
    TradingViewWebhookLogEntry,
    TradingViewWebhookStatusResponse,
)
from app.services.instrument_service import instrument_service
from app.services.tunnel_service import tunnel_service

IST = ZoneInfo("Asia/Kolkata")


@dataclass
class TradingViewWebhookConfig:
    session_token: str
    device_id: str
    environment: str
    user_name: str
    account_id: str
    secret: str
    order_delivery_type: str
    configured_at_utc: str
    execution_enabled: bool = True
    last_error: str | None = None
    logs: list[TradingViewWebhookLogEntry] = field(default_factory=list)
    history: list[TradingViewWebhookHistoryEntry] = field(default_factory=list)


class TradingViewWebhookService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._config: TradingViewWebhookConfig | None = None

    def _now_ist(self) -> str:
        return datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S %Z")

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

    def _append_log(self, level: str, message: str, payload: dict[str, Any] | None = None) -> None:
        with self._lock:
            if self._config is None:
                return
            self._config.logs.insert(
                0,
                TradingViewWebhookLogEntry(
                    time_ist=self._now_ist(),
                    level=level,  # type: ignore[arg-type]
                    message=message,
                    payload=payload,
                ),
            )
            self._config.logs = self._config.logs[:30]

    def _append_history(
        self,
        *,
        source: str,
        status: str,
        message: str,
        strategy: str | None = None,
        tag: str | None = None,
        instrument: str | None = None,
        exchange: str | None = None,
        action: str | None = None,
        quantity: int | None = None,
        order_id: int | None = None,
        order_status: str | None = None,
        pnl: float | None = None,
        requested_qty: int | None = None,
        placed_qty: int | None = None,
        filled_qty: int | None = None,
        avg_filled_price: float | None = None,
        order_price: float | None = None,
        ltp_price: float | None = None,
        ref_id: int | None = None,
        lot_size: int | None = None,
        tick_size: int | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        with self._lock:
            if self._config is None:
                return
            now = datetime.now(IST)
            self._config.history.insert(
                0,
                TradingViewWebhookHistoryEntry(
                    id=str(uuid.uuid4()),
                    time_ist=now.strftime("%Y-%m-%d %H:%M:%S %Z"),
                    day_ist=now.strftime("%Y-%m-%d"),
                    source=source,  # type: ignore[arg-type]
                    status=status,  # type: ignore[arg-type]
                    strategy=strategy,
                    tag=tag,
                    instrument=instrument,
                    exchange=exchange,
                    action=action,
                    quantity=quantity,
                    order_id=order_id,
                    order_status=order_status,
                    pnl=pnl,
                    requested_qty=requested_qty,
                    placed_qty=placed_qty,
                    filled_qty=filled_qty,
                    avg_filled_price=avg_filled_price,
                    order_price=order_price,
                    ltp_price=ltp_price,
                    ref_id=ref_id,
                    lot_size=lot_size,
                    tick_size=tick_size,
                    message=message,
                    payload=payload,
                ),
            )
            self._config.history = self._config.history[:200]

    def _payload_for_log(self, body: dict[str, Any]) -> dict[str, Any]:
        safe_payload: dict[str, Any] = {}
        for key, value in body.items():
            if key.lower() in {"apikey", "secret", "webhook_secret"}:
                safe_payload[key] = "***"
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                safe_payload[key] = value
        return safe_payload

    def _build_strategy_template(self, secret: str, order_delivery_type: str) -> dict[str, Any]:
        return {
            "secret": secret,
            "strategy": "Nubra Strategy Alert",
            "instrument": "RELIANCE",
            "exchange": "NSE",
            "order_side": "{{strategy.order.action}}",
            "order_delivery_type": order_delivery_type,
            "price_type": "MARKET",
            "order_qty": "{{strategy.order.contracts}}",
            "position_size": "{{strategy.position_size}}",
        }

    def _build_line_template(self, secret: str, order_delivery_type: str) -> dict[str, Any]:
        return {
            "secret": secret,
            "strategy": "Nubra Line Alert",
            "instrument": "RELIANCE",
            "exchange": "NSE",
            "order_side": "BUY",
            "order_delivery_type": order_delivery_type,
            "price_type": "MARKET",
            "order_qty": 1,
        }

    def _build_status(self) -> TradingViewWebhookStatusResponse:
        tunnel_status = tunnel_service.status()
        if self._config is None:
            return TradingViewWebhookStatusResponse(
                configured=False,
                environment=None,
                broker=None,
                user_name=None,
                account_id=None,
                configured_at_utc=None,
                order_delivery_type=None,
                secret=None,
                has_secret=False,
                webhook_path="/api/webhooks/tradingview",
                webhook_url=f"{tunnel_status.public_url}/api/webhooks/tradingview" if tunnel_status.public_url else None,
                strategy_template={},
                line_alert_template={},
                execution_enabled=True,
                last_error=None,
                logs=[],
                history=[],
                summary=TradingViewWebhookSummary(
                    total_events=0,
                    live_events=0,
                    test_events=0,
                    blocked_events=0,
                    error_events=0,
                    accepted_events=0,
                    today_pnl=0,
                    today_orders=0,
                ),
                order_history=[],
                positions=[],
                pnl_summary=TradingViewWebhookPnlSummary(
                    realized_pnl=0,
                    unrealized_pnl=0,
                    total_pnl=0,
                    open_positions=0,
                    closed_groups=0,
                ),
            )
        config = self._config
        today_ist = datetime.now(IST).strftime("%Y-%m-%d")
        history = config.history
        order_history, positions, pnl_summary = self._build_trade_views(config)
        return TradingViewWebhookStatusResponse(
            configured=True,
            environment=config.environment,  # type: ignore[arg-type]
            broker="Nubra",
            user_name=config.user_name,
            account_id=config.account_id,
            configured_at_utc=config.configured_at_utc,
            order_delivery_type=config.order_delivery_type,  # type: ignore[arg-type]
            secret=config.secret,
            has_secret=bool(config.secret),
            webhook_path="/api/webhooks/tradingview",
            webhook_url=f"{tunnel_status.public_url}/api/webhooks/tradingview" if tunnel_status.public_url else None,
            strategy_template=self._build_strategy_template(config.secret, config.order_delivery_type),
            line_alert_template=self._build_line_template(config.secret, config.order_delivery_type),
            execution_enabled=config.execution_enabled,
            last_error=config.last_error,
            logs=config.logs,
            history=history,
            summary=TradingViewWebhookSummary(
                total_events=len(history),
                live_events=sum(1 for entry in history if entry.source == "live"),
                test_events=sum(1 for entry in history if entry.source == "test"),
                blocked_events=sum(1 for entry in history if entry.status == "blocked"),
                error_events=sum(1 for entry in history if entry.status == "error"),
                accepted_events=sum(1 for entry in history if entry.status == "accepted"),
                today_pnl=round(sum((entry.pnl or 0) for entry in history if entry.day_ist == today_ist), 2),
                today_orders=sum(1 for entry in history if entry.day_ist == today_ist and entry.status == "accepted"),
            ),
            order_history=order_history,
            positions=positions,
            pnl_summary=pnl_summary,
        )

    def status(self) -> TradingViewWebhookStatusResponse:
        with self._lock:
            return self._build_status()

    def configure(self, payload: TradingViewWebhookConfigureRequest) -> TradingViewWebhookStatusResponse:
        secret = (payload.secret or "").strip() or secrets.token_urlsafe(18)
        with self._lock:
            existing_logs = self._config.logs[:] if self._config else []
            self._config = TradingViewWebhookConfig(
                session_token=payload.session_token,
                device_id=payload.device_id,
                environment=payload.environment,
                user_name=payload.user_name,
                account_id=payload.account_id,
                secret=secret,
                order_delivery_type=payload.order_delivery_type,
                configured_at_utc=datetime.utcnow().isoformat() + "Z",
                execution_enabled=self._config.execution_enabled if self._config else True,
                last_error=None,
                logs=existing_logs,
                history=self._config.history[:] if self._config else [],
            )
        self._append_log(
            "info",
            "TradingView webhook configured from the dashboard.",
            {
                "environment": payload.environment,
                "order_delivery_type": payload.order_delivery_type,
                "user_name": payload.user_name,
            },
        )
        return self.status()

    def reset(self) -> None:
        with self._lock:
            self._config = None

    def set_execution_enabled(self, enabled: bool) -> TradingViewWebhookStatusResponse:
        with self._lock:
            if self._config is None:
                raise HTTPException(status_code=400, detail="Configure the webhook before changing the kill switch.")
            self._config.execution_enabled = enabled
            state = "enabled" if enabled else "disabled"
        self._append_log("info", f"Webhook execution {state} from dashboard control.")
        return self.status()

    def _extract_secret(self, body: dict[str, Any], header_secret: str | None) -> str:
        candidates = [
            header_secret,
            body.get("apikey"),
            body.get("secret"),
            body.get("webhook_secret"),
        ]
        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        raise HTTPException(status_code=401, detail="Missing TradingView webhook secret.")

    def _parse_symbol_exchange(self, body: dict[str, Any]) -> tuple[str, str]:
        raw_symbol = body.get("instrument") or body.get("symbol") or body.get("ticker")
        if not isinstance(raw_symbol, str) or not raw_symbol.strip():
            raise HTTPException(status_code=400, detail="Webhook payload must include a symbol.")
        raw_symbol = raw_symbol.strip().upper()
        explicit_exchange = body.get("exchange")
        exchange = explicit_exchange.strip().upper() if isinstance(explicit_exchange, str) and explicit_exchange.strip() else "NSE"
        if ":" in raw_symbol:
            prefix, parsed_symbol = raw_symbol.split(":", 1)
            if prefix.strip():
                exchange = prefix.strip().upper()
            raw_symbol = parsed_symbol.strip().upper()
        if not raw_symbol:
            raise HTTPException(status_code=400, detail="Resolved TradingView symbol is empty.")
        return raw_symbol, exchange

    def _parse_action(self, body: dict[str, Any]) -> tuple[str, str]:
        raw_action = body.get("order_side") or body.get("action")
        if not isinstance(raw_action, str) or not raw_action.strip():
            raise HTTPException(status_code=400, detail="Webhook payload must include order_side.")
        action = raw_action.strip().upper()
        if "{{" in action:
            raise HTTPException(status_code=400, detail="TradingView placeholders were not resolved for order_side.")
        if action in {"BUY", "LONG", "ORDER_SIDE_BUY"}:
            return "BUY", "ORDER_SIDE_BUY"
        if action in {"SELL", "SHORT", "ORDER_SIDE_SELL"}:
            return "SELL", "ORDER_SIDE_SELL"
        raise HTTPException(status_code=400, detail=f"Unsupported TradingView order_side: {action}")

    def _parse_quantity(self, body: dict[str, Any]) -> int:
        raw_quantity = body.get("order_qty")
        if raw_quantity is None:
            raw_quantity = body.get("quantity")
        if raw_quantity is None:
            raise HTTPException(status_code=400, detail="Webhook payload must include order_qty.")
        if isinstance(raw_quantity, str) and "{{" in raw_quantity:
            raise HTTPException(status_code=400, detail="TradingView placeholders were not resolved for order_qty.")
        try:
            quantity = int(float(raw_quantity))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Quantity must be a numeric value.") from None
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than zero.")
        return quantity

    def _parse_order_delivery_type(self, body: dict[str, Any], configured_default: str) -> str:
        raw_product = body.get("order_delivery_type") or body.get("product")
        if not isinstance(raw_product, str) or not raw_product.strip():
            return configured_default
        product = raw_product.strip().upper()
        if product in {"MIS", "INTRADAY", "IDAY", "ORDER_DELIVERY_TYPE_IDAY"}:
            return "ORDER_DELIVERY_TYPE_IDAY"
        if product in {"CNC", "DELIVERY", "ORDER_DELIVERY_TYPE_CNC"}:
            return "ORDER_DELIVERY_TYPE_CNC"
        return configured_default

    def _normalize_order_qty(self, lot_size: int, requested_qty: int) -> int:
        normalized = max(requested_qty, lot_size)
        if lot_size > 1:
            remainder = normalized % lot_size
            if remainder != 0:
                normalized += lot_size - remainder
        return normalized

    def _get_current_price_paise(self, session_token: str, device_id: str, environment: str, symbol: str, exchange: str) -> int:
        base_url = self._base_url(environment)
        params = {"exchange": exchange} if exchange == "BSE" else None
        with httpx.Client(timeout=20.0) as client:
            response = client.get(
                f"{base_url}/optionchains/{symbol}/price",
                params=params,
                headers=self._request_headers(session_token, device_id),
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

    def _safe_current_price_rupees(
        self,
        session_token: str,
        device_id: str,
        environment: str,
        symbol: str,
        exchange: str,
    ) -> float | None:
        try:
            return self._get_current_price_paise(session_token, device_id, environment, symbol, exchange) / 100
        except HTTPException:
            return None

    def _build_trade_views(
        self,
        config: TradingViewWebhookConfig,
    ) -> tuple[list[TradingViewWebhookOrderRow], list[TradingViewWebhookPositionRow], TradingViewWebhookPnlSummary]:
        accepted = [entry for entry in config.history if entry.status == "accepted"]
        order_rows = [
            TradingViewWebhookOrderRow(
                time_ist=entry.time_ist,
                source=entry.source,
                strategy=entry.strategy,
                tag=entry.tag,
                instrument=entry.instrument,
                exchange=entry.exchange,
                action=entry.action,
                requested_qty=entry.requested_qty,
                placed_qty=entry.placed_qty,
                filled_qty=entry.filled_qty,
                order_price=entry.order_price,
                avg_filled_price=entry.avg_filled_price,
                current_price=entry.ltp_price,
                order_id=entry.order_id,
                order_status=entry.order_status,
                pnl=entry.pnl,
            )
            for entry in accepted
        ]

        fills = [
            entry
            for entry in accepted
            if entry.instrument
            and entry.exchange
            and entry.action in {"BUY", "SELL"}
            and (entry.filled_qty or 0) > 0
            and entry.avg_filled_price is not None
        ]
        fills.sort(key=lambda entry: entry.time_ist)

        grouped: dict[tuple[str | None, str | None, str, str], dict[str, float | int | str | None]] = {}
        for entry in fills:
            key = (entry.strategy, entry.tag, entry.instrument or "", entry.exchange or "")
            state = grouped.setdefault(
                key,
                {
                    "net_qty": 0,
                    "avg_entry_price": 0.0,
                    "realized_pnl": 0.0,
                },
            )
            qty = int(entry.filled_qty or 0)
            price = float(entry.avg_filled_price or 0)
            net_qty = int(state["net_qty"] or 0)
            avg_entry = float(state["avg_entry_price"] or 0)
            realized = float(state["realized_pnl"] or 0)

            if entry.action == "BUY":
                if net_qty >= 0:
                    total_cost = avg_entry * net_qty + price * qty
                    net_qty += qty
                    avg_entry = total_cost / net_qty if net_qty > 0 else 0.0
                else:
                    closing_qty = min(qty, abs(net_qty))
                    realized += (avg_entry - price) * closing_qty
                    net_qty += closing_qty
                    remaining = qty - closing_qty
                    if net_qty == 0:
                        avg_entry = 0.0
                    if remaining > 0:
                        net_qty = remaining
                        avg_entry = price
            else:
                if net_qty <= 0:
                    total_cost = avg_entry * abs(net_qty) + price * qty
                    net_qty -= qty
                    avg_entry = total_cost / abs(net_qty) if net_qty != 0 else 0.0
                else:
                    closing_qty = min(qty, net_qty)
                    realized += (price - avg_entry) * closing_qty
                    net_qty -= closing_qty
                    remaining = qty - closing_qty
                    if net_qty == 0:
                        avg_entry = 0.0
                    if remaining > 0:
                        net_qty = -remaining
                        avg_entry = price

            state["net_qty"] = net_qty
            state["avg_entry_price"] = avg_entry
            state["realized_pnl"] = realized

        positions: list[TradingViewWebhookPositionRow] = []
        realized_total = 0.0
        unrealized_total = 0.0
        closed_groups = 0
        for key, state in grouped.items():
            strategy, tag, instrument, exchange = key
            net_qty = int(state["net_qty"] or 0)
            avg_entry = float(state["avg_entry_price"] or 0)
            realized = round(float(state["realized_pnl"] or 0), 2)
            current_price = self._safe_current_price_rupees(
                config.session_token,
                config.device_id,
                config.environment,
                instrument,
                exchange,
            ) if instrument and exchange else None
            unrealized = 0.0
            direction: str = "FLAT"
            if net_qty > 0:
                direction = "LONG"
                if current_price is not None:
                    unrealized = round((current_price - avg_entry) * net_qty, 2)
            elif net_qty < 0:
                direction = "SHORT"
                if current_price is not None:
                    unrealized = round((avg_entry - current_price) * abs(net_qty), 2)
            else:
                closed_groups += 1
            realized_total += realized
            unrealized_total += unrealized
            positions.append(
                TradingViewWebhookPositionRow(
                    strategy=strategy,
                    tag=tag,
                    instrument=instrument,
                    exchange=exchange,
                    net_qty=net_qty,
                    avg_entry_price=round(avg_entry, 2) if avg_entry else None,
                    current_price=current_price,
                    realized_pnl=realized,
                    unrealized_pnl=unrealized,
                    total_pnl=round(realized + unrealized, 2),
                    direction=direction,  # type: ignore[arg-type]
                )
            )

        positions.sort(key=lambda row: (0 if row.net_qty != 0 else 1, row.instrument, row.strategy or "", row.tag or ""))
        pnl_summary = TradingViewWebhookPnlSummary(
            realized_pnl=round(realized_total, 2),
            unrealized_pnl=round(unrealized_total, 2),
            total_pnl=round(realized_total + unrealized_total, 2),
            open_positions=sum(1 for row in positions if row.net_qty != 0),
            closed_groups=closed_groups,
        )
        return order_rows, positions, pnl_summary

    def _place_order(
        self,
        session_token: str,
        device_id: str,
        environment: str,
        symbol: str,
        exchange: str,
        order_side: str,
        order_delivery_type: str,
        requested_qty: int,
        strategy_name: str,
    ) -> dict[str, Any]:
        ref_id, lot_size, tick_size = instrument_service.resolve_stock_meta(
            session_token,
            environment,
            device_id,
            symbol,
        )
        normalized_qty = self._normalize_order_qty(lot_size, requested_qty)
        ltp_paise = self._get_current_price_paise(session_token, device_id, environment, symbol, exchange)
        order_price = self._compute_aggressive_limit_price(tick_size, order_side, ltp_paise)
        payload = {
            "ref_id": ref_id,
            "order_type": "ORDER_TYPE_REGULAR",
            "order_qty": normalized_qty,
            "order_side": order_side,
            "order_delivery_type": order_delivery_type,
            "validity_type": "IOC",
            "price_type": "LIMIT",
            "order_price": order_price,
            "tag": f"tv_{strategy_name.lower().replace(' ', '_')}_{symbol.lower()}",
            "algo_params": {},
        }
        base_url = self._base_url(environment)
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                f"{base_url}/orders/v2/single",
                json=payload,
                headers=self._request_headers(session_token, device_id),
            )
            if response.status_code >= 400:
                raise HTTPException(status_code=response.status_code, detail=self._extract_error(response))
            order = response.json()
        return {
            "order": order,
            "ref_id": ref_id,
            "lot_size": lot_size,
            "tick_size": tick_size,
            "requested_qty": requested_qty,
            "normalized_qty": normalized_qty,
            "ltp_paise": ltp_paise,
            "order_price": order_price,
        }

    def _fetch_order_snapshot(
        self,
        session_token: str,
        device_id: str,
        environment: str,
        order_id: int,
    ) -> dict[str, Any] | None:
        base_url = self._base_url(environment)
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{base_url}/orders/v2/{order_id}",
                headers=self._request_headers(session_token, device_id),
            )
            if response.status_code >= 400:
                return None
            return response.json()

    def execute(self, body: dict[str, Any], header_secret: str | None = None, source: str = "live") -> TradingViewWebhookExecuteResponse:
        with self._lock:
            config = self._config
        if config is None:
            raise HTTPException(status_code=503, detail="TradingView webhook is not configured yet.")

        try:
            payload_for_log = self._payload_for_log(body)
            strategy_name = str(body.get("strategy") or "TradingView Alert").strip() or "TradingView Alert"
            tag = str(body.get("tag") or "").strip() or None
            self._append_log("info", "Webhook payload received.", payload_for_log)
            self._append_history(
                source=source,
                status="received",
                message="Webhook payload received.",
                strategy=strategy_name,
                tag=tag,
                instrument=str(body.get("instrument") or body.get("symbol") or "").strip().upper() or None,
                exchange=str(body.get("exchange") or "").strip().upper() or None,
                payload=payload_for_log,
            )
            provided_secret = self._extract_secret(body, header_secret)
            if provided_secret != config.secret:
                raise HTTPException(status_code=401, detail="Invalid TradingView webhook secret.")
            if not config.execution_enabled:
                self._append_history(
                    source=source,
                    status="blocked",
                    message="Kill switch is enabled. Webhook order execution was blocked.",
                    strategy=strategy_name,
                    tag=tag,
                    instrument=str(body.get("instrument") or body.get("symbol") or "").strip().upper() or None,
                    exchange=str(body.get("exchange") or "").strip().upper() or None,
                    payload=payload_for_log,
                )
                raise HTTPException(status_code=423, detail="Kill switch is enabled. Webhook execution is currently blocked.")

            symbol, exchange = self._parse_symbol_exchange(body)
            action_label, order_side = self._parse_action(body)
            quantity = self._parse_quantity(body)
            order_delivery_type = self._parse_order_delivery_type(body, config.order_delivery_type)

            result = self._place_order(
                config.session_token,
                config.device_id,
                config.environment,
                symbol,
                exchange,
                order_side,
                order_delivery_type,
                quantity,
                strategy_name,
            )
            order = result["order"]
            order_id = int(order.get("order_id", 0) or 0) or None
            order_snapshot = None
            if order_id is not None:
                order_snapshot = self._fetch_order_snapshot(
                    config.session_token,
                    config.device_id,
                    config.environment,
                    order_id,
                )
            effective_order = order_snapshot or order
            order_status = str(effective_order.get("order_status") or order.get("order_status") or "submitted")
            filled_qty = int(effective_order.get("filled_qty", order.get("filled_qty", 0)) or 0)
            avg_filled_price = effective_order.get("avg_filled_price", order.get("avg_filled_price"))
            avg_filled_price_value = float(avg_filled_price) if isinstance(avg_filled_price, (int, float)) else None
            ltp_rupees = float(result["ltp_paise"]) / 100 if isinstance(result["ltp_paise"], (int, float)) else None
            order_price_rupees = float(result["order_price"]) / 100 if isinstance(result["order_price"], (int, float)) else None
            self._append_log(
                "success",
                f"{action_label} order accepted for {symbol} on {exchange}.",
                {
                    "symbol": symbol,
                    "exchange": exchange,
                    "action": action_label,
                    "quantity": quantity,
                    "normalized_qty": result["normalized_qty"],
                    "order_delivery_type": order_delivery_type,
                    "order_id": order_id,
                    "order_status": order_status,
                    "request": self._payload_for_log(body),
                    "order_snapshot": effective_order,
                },
            )
            pnl_value = None
            if avg_filled_price_value is not None and filled_qty > 0 and ltp_rupees is not None:
                if action_label == "BUY":
                    pnl_value = round((ltp_rupees - avg_filled_price_value) * filled_qty, 2)
                else:
                    pnl_value = round((avg_filled_price_value - ltp_rupees) * filled_qty, 2)
            self._append_history(
                source=source,
                status="accepted",
                message=f"{action_label} order accepted for {symbol} on {exchange}.",
                strategy=strategy_name,
                tag=tag,
                instrument=symbol,
                exchange=exchange,
                action=action_label,
                quantity=int(result["normalized_qty"]),
                order_id=order_id,
                order_status=order_status,
                pnl=pnl_value,
                requested_qty=int(result["requested_qty"]),
                placed_qty=int(result["normalized_qty"]),
                filled_qty=filled_qty,
                avg_filled_price=avg_filled_price_value,
                order_price=order_price_rupees,
                ltp_price=ltp_rupees,
                ref_id=int(result["ref_id"]),
                lot_size=int(result["lot_size"]),
                tick_size=int(result["tick_size"]),
                payload={
                    "order_delivery_type": order_delivery_type,
                    "request": payload_for_log,
                    "order_response": effective_order,
                },
            )
            with self._lock:
                if self._config is not None:
                    self._config.last_error = None
            return TradingViewWebhookExecuteResponse(
                status="accepted",
                message=f"{action_label} order accepted for {symbol}.",
                order_id=order_id,
                order_status=order_status,
                symbol=symbol,
                exchange=exchange,
                action=action_label,
                quantity=int(result["normalized_qty"]),
            )
        except HTTPException as exc:
            with self._lock:
                if self._config is not None:
                    self._config.last_error = str(exc.detail)
            payload_for_log = self._payload_for_log(body)
            self._append_log("error", str(exc.detail), {"payload": payload_for_log})
            if str(exc.detail) != "Kill switch is enabled. Webhook execution is currently blocked.":
                self._append_history(
                    source=source,
                    status="error",
                    message=str(exc.detail),
                    strategy=str(body.get("strategy") or "").strip() or None,
                    tag=str(body.get("tag") or "").strip() or None,
                    instrument=str(body.get("instrument") or body.get("symbol") or "").strip().upper() or None,
                    exchange=str(body.get("exchange") or "").strip().upper() or None,
                    payload=payload_for_log,
                )
            raise
        except Exception as exc:
            with self._lock:
                if self._config is not None:
                    self._config.last_error = str(exc)
            payload_for_log = self._payload_for_log(body)
            self._append_log("error", str(exc), {"payload": payload_for_log})
            self._append_history(
                source=source,
                status="error",
                message="Unexpected TradingView webhook failure.",
                strategy=str(body.get("strategy") or "").strip() or None,
                tag=str(body.get("tag") or "").strip() or None,
                instrument=str(body.get("instrument") or body.get("symbol") or "").strip().upper() or None,
                exchange=str(body.get("exchange") or "").strip().upper() or None,
                payload=payload_for_log,
            )
            raise HTTPException(status_code=500, detail="Unexpected TradingView webhook failure.") from exc


tradingview_webhook_service = TradingViewWebhookService()
