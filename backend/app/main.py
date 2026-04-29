import asyncio
from typing import Any
import queue as _queue

from fastapi import FastAPI, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app.config import get_cors_origins, settings
from app.schemas import (
    DeltaNeutralPairsRequest,
    DeltaNeutralPairsResponse,
    ExpiryHeatmapRequest,
    ExpiryHeatmapResponse,
    MarketStatusResponse,
    ScannerOrderPreviewRequest,
    ScannerOrderPreviewResponse,
    ScannerOrderSubmitRequest,
    ScannerOrderSubmitResponse,
    ScalperOrderRequest,
    ScalperOrderResponse,
    ScalperSnapshotRequest,
    ScalperSnapshotResponse,
    ScalperVolumeBreakoutRequest,
    ScalperVolumeBreakoutResponse,
    SessionStatusRequest,
    SessionStatusResponse,
    StartLoginRequest,
    StartLoginResponse,
    StockSearchRequest,
    StockSearchResponse,
    StrategyBacktestRequest,
    StrategyBacktestResponse,
    StrategyDailySignalLogRow,
    StrategyEquityPoint,
    StrategyInstrumentMetrics,
    StrategyInstrumentResult,
    StrategyPortfolioMetrics,
    StrategyPreviewCandle,
    StrategyPreviewChart,
    StrategyPreviewRequest,
    StrategyPreviewResponse,
    StrategyTrade,
    StrategyLivePosition,
    StrategyLiveStartRequest,
    StrategyLiveStartResponse,
    StrategyLiveStatusResponse,
    StrategyLiveStopResponse,
    TradingViewWebhookConfigureRequest,
    TradingViewWebhookConfigureResponse,
    TradingViewWebhookExecutionModeRequest,
    TradingViewWebhookExecutionModeResponse,
    TradingViewWebhookExecuteResponse,
    TradingViewWebhookResetResponse,
    TradingViewWebhookStatusResponse,
    TunnelStatusResponse,
    VolumeBreakoutDrilldownRequest,
    VolumeBreakoutDrilldownResponse,
    VolumeBreakoutStartRequest,
    VolumeBreakoutStartResponse,
    VolumeBreakoutStatusResponse,
    VolumeBreakoutStopResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    VerifyTotpRequest,
    VerifyTotpResponse,
)
from app.services.auth_service import auth_service
from app.services.instrument_service import instrument_service
from app.services.scalper_live_service import ScalperLiveSession
from app.services.scalper_service import scalper_service
from app.services.scalper_volume_breakout_service import scalper_volume_breakout_service
from app.services.strategy_backtester import parse_strategy, run_backtest
from app.services.strategy_catalog import catalog_payload
from app.services.strategy_data import fetch_preview_ohlcv
from app.services.strategy_live_service import strategy_live_service
from app.services.tradingview_webhook_service import tradingview_webhook_service
from app.services.tunnel_service import tunnel_service
from app.services.volume_breakout_service import volume_breakout_service

try:
    from app.services.volume_quote_live_service import VolumeQuoteLiveSession
    _volume_quote_import_error: str | None = None
except ModuleNotFoundError as exc:
    VolumeQuoteLiveSession = None  # type: ignore[assignment]
    _volume_quote_import_error = str(exc)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/system/public-ip")
def get_public_ip() -> dict[str, str | None]:
    services = [
        "https://api.ipify.org?format=json",
        "https://ifconfig.me/all.json",
    ]
    for url in services:
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(url)
                if response.status_code >= 400:
                    continue
                payload = response.json()
                ip = payload.get("ip_addr") or payload.get("ip")
                if isinstance(ip, str) and ip.strip():
                    return {"ip": ip.strip()}
        except Exception:
            continue
    return {"ip": None}


@app.get("/api/system/tunnel/status", response_model=TunnelStatusResponse)
def get_tunnel_status() -> TunnelStatusResponse:
    return tunnel_service.status()


@app.post("/api/system/tunnel/start", response_model=TunnelStatusResponse)
def start_tunnel() -> TunnelStatusResponse:
    return tunnel_service.start()


@app.post("/api/system/tunnel/stop", response_model=TunnelStatusResponse)
def stop_tunnel() -> TunnelStatusResponse:
    return tunnel_service.stop()


@app.get("/api/webhooks/tradingview/status", response_model=TradingViewWebhookStatusResponse)
def get_tradingview_webhook_status() -> TradingViewWebhookStatusResponse:
    return tradingview_webhook_service.status()


@app.post("/api/webhooks/tradingview/configure", response_model=TradingViewWebhookConfigureResponse)
def configure_tradingview_webhook(payload: TradingViewWebhookConfigureRequest) -> TradingViewWebhookConfigureResponse:
    config = tradingview_webhook_service.configure(payload)
    return TradingViewWebhookConfigureResponse(
        status="success",
        message="TradingView webhook configured successfully.",
        config=config,
    )


@app.post("/api/webhooks/tradingview/reset", response_model=TradingViewWebhookResetResponse)
def reset_tradingview_webhook() -> TradingViewWebhookResetResponse:
    tradingview_webhook_service.reset()
    return TradingViewWebhookResetResponse(
        status="success",
        message="TradingView webhook configuration cleared.",
    )


@app.post("/api/webhooks/tradingview/execution-mode", response_model=TradingViewWebhookExecutionModeResponse)
def set_tradingview_execution_mode(payload: TradingViewWebhookExecutionModeRequest) -> TradingViewWebhookExecutionModeResponse:
    status = tradingview_webhook_service.set_execution_enabled(payload.execution_enabled)
    return TradingViewWebhookExecutionModeResponse(
        status="success",
        message="Webhook execution mode updated.",
        execution_enabled=status.execution_enabled,
    )


@app.post("/api/webhooks/tradingview", response_model=TradingViewWebhookExecuteResponse)
def execute_tradingview_webhook(
    payload: dict[str, Any],
    x_webhook_secret: str | None = Header(default=None),
    x_webhook_source: str | None = Header(default=None),
) -> TradingViewWebhookExecuteResponse:
    source = "test" if isinstance(x_webhook_source, str) and x_webhook_source.strip().lower() == "test" else "live"
    return tradingview_webhook_service.execute(payload, header_secret=x_webhook_secret, source=source)


@app.post("/api/auth/start", response_model=StartLoginResponse)
def start_login(payload: StartLoginRequest) -> StartLoginResponse:
    return auth_service.start_login(payload)


@app.post("/api/auth/verify-otp", response_model=VerifyOtpResponse)
def verify_otp(payload: VerifyOtpRequest) -> VerifyOtpResponse:
    return auth_service.verify_otp(payload)


@app.post("/api/auth/verify-totp", response_model=VerifyTotpResponse)
def verify_totp(payload: VerifyTotpRequest) -> VerifyTotpResponse:
    return auth_service.verify_totp(payload)


@app.post("/api/auth/verify-mpin", response_model=VerifyMpinResponse)
def verify_mpin(payload: VerifyMpinRequest) -> VerifyMpinResponse:
    return auth_service.verify_mpin(payload)


@app.post("/api/auth/session-status", response_model=SessionStatusResponse)
def get_session_status(payload: SessionStatusRequest) -> SessionStatusResponse:
    return auth_service.session_status(payload)


@app.get("/api/strategy/catalog")
def get_strategy_catalog() -> dict:
    return catalog_payload()


@app.post("/api/strategy/backtest", response_model=StrategyBacktestResponse)
def run_strategy_backtest(payload: StrategyBacktestRequest) -> StrategyBacktestResponse:
    strategy = parse_strategy(payload.strategy)
    result = run_backtest(
        strategy=strategy,
        session_token=payload.session_token,
        device_id=payload.device_id,
        environment=payload.environment,
    )

    instruments_out = [
        StrategyInstrumentResult(
            symbol=item.symbol,
            bars_processed=item.bars_processed,
            metrics=StrategyInstrumentMetrics(**item.metrics.__dict__),
            trades=[
                StrategyTrade(
                    symbol=t.symbol,
                    side=t.side,
                    entry_timestamp=t.entry_timestamp,
                    exit_timestamp=t.exit_timestamp,
                    entry_price=t.entry_price,
                    exit_price=t.exit_price,
                    quantity=t.quantity,
                    pnl=t.pnl,
                    pnl_pct=t.pnl_pct,
                    bars_held=t.bars_held,
                    exit_reason=t.exit_reason,
                    brokerage=t.brokerage,
                )
                for t in item.trades
            ],
            equity_curve=[
                StrategyEquityPoint(timestamp=p.timestamp, equity=p.equity)
                for p in item.equity_curve
            ],
            triggered_days=[
                StrategyDailySignalLogRow(**r.__dict__)
                for r in item.triggered_days
            ],
            daily_signal_log=[
                StrategyDailySignalLogRow(**r.__dict__)
                for r in item.daily_signal_log
            ],
            warning=item.warning,
        )
        for item in result.instruments
    ]

    portfolio_out = StrategyPortfolioMetrics(
        starting_capital=result.portfolio.starting_capital,
        ending_capital=result.portfolio.ending_capital,
        gross_profit=result.portfolio.gross_profit,
        gross_loss=result.portfolio.gross_loss,
        net_pnl=result.portfolio.net_pnl,
        return_pct=result.portfolio.return_pct,
        total_trades=result.portfolio.total_trades,
        winning_trades=result.portfolio.winning_trades,
        losing_trades=result.portfolio.losing_trades,
        win_rate_pct=result.portfolio.win_rate_pct,
        profit_factor=result.portfolio.profit_factor,
        max_drawdown_pct=result.portfolio.max_drawdown_pct,
        capital_per_instrument=result.portfolio.capital_per_instrument,
        total_brokerage=result.portfolio.total_brokerage,
        equity_curve=[
            StrategyEquityPoint(timestamp=p.timestamp, equity=p.equity)
            for p in result.portfolio.equity_curve
        ],
    )

    return StrategyBacktestResponse(
        status="success",
        mode=result.mode,
        strategy_summary=result.strategy_summary,
        portfolio=portfolio_out,
        instruments=instruments_out,
    )


@app.post("/api/strategy/preview", response_model=StrategyPreviewResponse)
def get_strategy_preview(payload: StrategyPreviewRequest) -> StrategyPreviewResponse:
    df = fetch_preview_ohlcv(
        session_token=payload.session_token,
        device_id=payload.device_id,
        environment=payload.environment,
        symbol=payload.symbol,
        exchange=payload.exchange,
        instrument_type=payload.instrument_type,
        interval=payload.interval,
        bars=payload.bars,
    )

    candles = [
        StrategyPreviewCandle(
            epoch_ms=int(row.timestamp.timestamp() * 1000),
            open=float(row.open),
            high=float(row.high),
            low=float(row.low),
            close=float(row.close),
            volume=None if row.volume is None or row.volume != row.volume else float(row.volume),
        )
        for row in df.itertuples(index=False)
    ]

    last_price = candles[-1].close if candles else None
    return StrategyPreviewResponse(
        status="success",
        chart=StrategyPreviewChart(
            instrument=payload.symbol.strip().upper(),
            exchange=payload.exchange.strip().upper(),
            instrument_type=payload.instrument_type.strip().upper(),
            interval=payload.interval.strip().lower(),
            last_price=last_price,
            candles=candles,
        ),
    )


@app.post("/api/strategy/live/start", response_model=StrategyLiveStartResponse)
def start_strategy_live(payload: StrategyLiveStartRequest) -> StrategyLiveStartResponse:
    snapshot = strategy_live_service.start(
        strategy_payload=payload.strategy,
        session_token=payload.session_token,
        device_id=payload.device_id,
        environment=payload.environment,
    )
    message = "Strategy deployed live on IST interval boundaries."
    if snapshot.get("last_error"):
        message = f"Strategy deployed. Initial evaluation warned: {snapshot['last_error']}"
    return StrategyLiveStartResponse(
        status="success",
        message=message,
        job=StrategyLiveStatusResponse(**snapshot),
    )


@app.get("/api/strategy/live/status", response_model=StrategyLiveStatusResponse)
def get_strategy_live_status() -> StrategyLiveStatusResponse:
    return StrategyLiveStatusResponse(**strategy_live_service.status_payload())


@app.post("/api/strategy/live/stop", response_model=StrategyLiveStopResponse)
def stop_strategy_live() -> StrategyLiveStopResponse:
    strategy_live_service.stop()
    return StrategyLiveStopResponse(status="success", message="Strategy live runner stopped.")


@app.post("/api/instruments/stocks/search", response_model=StockSearchResponse)
def search_stocks(payload: StockSearchRequest) -> StockSearchResponse:
    items = instrument_service.search_stocks(
        session_token=payload.session_token,
        environment=payload.environment,
        device_id=payload.device_id,
        query=payload.query,
        limit=payload.limit,
    )
    return StockSearchResponse(items=items)


@app.post("/api/scalper/snapshot", response_model=ScalperSnapshotResponse)
def get_scalper_snapshot(payload: ScalperSnapshotRequest) -> ScalperSnapshotResponse:
    return scalper_service.snapshot(payload)


@app.post("/api/scalper/delta-neutral", response_model=DeltaNeutralPairsResponse)
def get_scalper_delta_neutral_pairs(payload: DeltaNeutralPairsRequest) -> DeltaNeutralPairsResponse:
    return scalper_service.delta_neutral_pairs(payload)


@app.post("/api/scalper/expiry-heatmap", response_model=ExpiryHeatmapResponse)
def get_scalper_expiry_heatmap(payload: ExpiryHeatmapRequest) -> ExpiryHeatmapResponse:
    return scalper_service.expiry_heatmap(payload)


@app.post("/api/scalper/volume-breakout", response_model=ScalperVolumeBreakoutResponse)
def get_scalper_volume_breakout(payload: ScalperVolumeBreakoutRequest) -> ScalperVolumeBreakoutResponse:
    return scalper_volume_breakout_service.volume_breakout_finder(payload)


@app.post("/api/scalper/order", response_model=ScalperOrderResponse)
def place_scalper_order(payload: ScalperOrderRequest) -> ScalperOrderResponse:
    return scalper_service.place_order(payload)


@app.post("/api/scanner/order-preview", response_model=ScannerOrderPreviewResponse)
def preview_scanner_order(payload: ScannerOrderPreviewRequest) -> ScannerOrderPreviewResponse:
    return scalper_service.preview_stock_order(payload)


@app.post("/api/scanner/order", response_model=ScannerOrderSubmitResponse)
def place_scanner_order(payload: ScannerOrderSubmitRequest) -> ScannerOrderSubmitResponse:
    return scalper_service.place_stock_order(payload)


@app.websocket("/ws/scalper")
async def scalper_live_ws(websocket: WebSocket) -> None:
    """
    Live scalper WebSocket endpoint.

    Protocol:
      1. Client connects.
      2. Client sends a JSON init message matching ScalperSnapshotRequest fields.
      3. Server responds with {"type": "init", "option_pair": {...}, "panels": {...}}
         containing full historical candles for all three panels.
      4. Server streams {"type": "candle_update", "panel": "...", "candle": {...}}
         every poll interval as the current candle updates.
      5. Every 5 minutes the server sends {"type": "reconcile", "panel": "...", "candles": [...]}
         with the last 12 authoritative candles for drift correction.
    """
    await websocket.accept()
    raw: dict | None = None
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=20.0)
        request = ScalperSnapshotRequest(**raw)
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Timeout waiting for init params.")
        return
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"Invalid init params: {exc}"})
        except Exception:
            pass
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    session = ScalperLiveSession(request=request)
    if isinstance(raw, dict):
        seed_snapshot = raw.get("seed_snapshot")
        if isinstance(seed_snapshot, dict):
            session.prime_from_seed_snapshot(seed_snapshot)
    await session.run(websocket)


@app.post("/api/volume-breakout/start", response_model=VolumeBreakoutStartResponse)
def start_volume_breakout(payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStartResponse:
    job = volume_breakout_service.start(payload)
    message = "Volume dashboard synced and ranking scan started."
    if job.last_error:
        message = f"Volume dashboard started with warning: {job.last_error}"
    return VolumeBreakoutStartResponse(status="success", message=message, job=job)


@app.get("/api/volume-breakout/status", response_model=VolumeBreakoutStatusResponse)
def get_volume_breakout_status() -> VolumeBreakoutStatusResponse:
    return volume_breakout_service.status()


@app.post("/api/volume-breakout/stop", response_model=VolumeBreakoutStopResponse)
def stop_volume_breakout() -> VolumeBreakoutStopResponse:
    volume_breakout_service.stop()
    return VolumeBreakoutStopResponse(status="success", message="Volume dashboard refresh loop stopped.")


@app.post("/api/volume-breakout/eod", response_model=VolumeBreakoutStatusResponse)
def get_volume_breakout_eod(payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStatusResponse:
    return volume_breakout_service.eod_snapshot(payload)


@app.post("/api/volume-breakout/drilldown", response_model=VolumeBreakoutDrilldownResponse)
def get_volume_breakout_drilldown(payload: VolumeBreakoutDrilldownRequest) -> VolumeBreakoutDrilldownResponse:
    return volume_breakout_service.drilldown(payload)


@app.get("/api/system/market-status", response_model=MarketStatusResponse)
def get_market_status() -> MarketStatusResponse:
    info = volume_breakout_service.market_status_info()
    return MarketStatusResponse(**info)


@app.websocket("/ws/volume-breakout")
async def volume_breakout_ws(websocket: WebSocket) -> None:
    """
    Volume breakout WebSocket endpoint.
    Protocol:
      1. Client connects.
      2. Client sends JSON init params matching VolumeBreakoutStartRequest fields.
      3. Server sends {"type": "scan_ready", "payload": <current snapshot>}.
      4. Server streams {"type": "scan_update", "payload": {...}} after each gap-fill batch and refresh cycle.
      5. Server sends {"type": "gap_fill_complete", "payload": {...}} when gap-fill finishes.
      6. Server sends {"type": "ping"} every 30s when idle to keep connection alive.
    """
    await websocket.accept()

    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=20.0)
        request = VolumeBreakoutStartRequest(**raw)
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Timeout waiting for init params.")
        return
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"Invalid init params: {exc}"})
        except Exception:
            pass
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    event_queue: _queue.SimpleQueue = _queue.SimpleQueue()
    volume_breakout_service.register_event_queue(event_queue)

    job = volume_breakout_service.start(request)
    try:
        await websocket.send_json({"type": "scan_ready", "payload": job.model_dump()})
    except Exception:
        volume_breakout_service.unregister_event_queue(event_queue)
        return

    loop = asyncio.get_event_loop()

    try:
        while True:
            try:
                event = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: event_queue.get(timeout=30)),
                    timeout=35.0,
                )
                await websocket.send_json(event)
            except (asyncio.TimeoutError, Exception):
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
    except WebSocketDisconnect:
        pass
    finally:
        volume_breakout_service.unregister_event_queue(event_queue)
        if not volume_breakout_service.has_event_subscribers():
            volume_breakout_service.stop()


@app.websocket("/ws/volume-quotes")
async def volume_quotes_ws(websocket: WebSocket) -> None:
    """
    Lightweight live quote endpoint for the actionable volume dashboard.

    The client keeps this socket open for the selected leader plus a small
    rotating watchlist. It intentionally does not subscribe the entire NSE.
    """
    if VolumeQuoteLiveSession is None:
        await websocket.accept()
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Volume live quotes are unavailable in this environment.",
                    "detail": _volume_quote_import_error,
                }
            )
        finally:
            await websocket.close(code=1011)
        return

    await websocket.accept()
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=20.0)
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Timeout waiting for init params.")
        return
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"Invalid init params: {exc}"})
        except Exception:
            pass
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
        return

    session = VolumeQuoteLiveSession(raw if isinstance(raw, dict) else {})
    await session.run(websocket)
