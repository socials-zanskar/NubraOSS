import asyncio
from typing import Any

from fastapi import FastAPI, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app.config import get_cors_origins, settings
from app.schemas import (
    NoCodeInstrumentMetaRequest,
    NoCodeInstrumentMetaResponse,
    NoCodeStartRequest,
    NoCodeStartResponse,
    NoCodeStatusResponse,
    NoCodeStopResponse,
    ScalperSnapshotRequest,
    ScalperSnapshotResponse,
    SessionStatusRequest,
    SessionStatusResponse,
    StartLoginRequest,
    StartLoginResponse,
    StockSearchRequest,
    StockSearchResponse,
    TradingViewWebhookConfigureRequest,
    TradingViewWebhookConfigureResponse,
    TradingViewWebhookExecutionModeRequest,
    TradingViewWebhookExecutionModeResponse,
    TradingViewWebhookExecuteResponse,
    TradingViewWebhookResetResponse,
    TradingViewWebhookStatusResponse,
    TunnelStatusResponse,
    VolumeBreakoutStartRequest,
    VolumeBreakoutStartResponse,
    VolumeBreakoutStatusResponse,
    VolumeBreakoutStopResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.services.auth_service import auth_service
from app.services.instrument_service import instrument_service
from app.services.no_code_service import no_code_service
from app.services.scalper_live_service import ScalperLiveSession
from app.services.scalper_service import scalper_service
from app.services.tradingview_webhook_service import tradingview_webhook_service
from app.services.tunnel_service import tunnel_service
from app.services.volume_breakout_service import volume_breakout_service

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


@app.post("/api/auth/verify-mpin", response_model=VerifyMpinResponse)
def verify_mpin(payload: VerifyMpinRequest) -> VerifyMpinResponse:
    return auth_service.verify_mpin(payload)


@app.post("/api/auth/session-status", response_model=SessionStatusResponse)
def get_session_status(payload: SessionStatusRequest) -> SessionStatusResponse:
    return auth_service.session_status(payload)


@app.post("/api/no-code/start", response_model=NoCodeStartResponse)
def start_no_code(payload: NoCodeStartRequest) -> NoCodeStartResponse:
    job = no_code_service.start(payload)
    message = "No Code Algo started. Initial data pull completed."
    if job.last_error:
        message = f"No Code Algo started. Initial data pull reported: {job.last_error}"
    return NoCodeStartResponse(status="success", message=message, job=job)


@app.post("/api/no-code/instrument-meta", response_model=NoCodeInstrumentMetaResponse)
def get_no_code_instrument_meta(payload: NoCodeInstrumentMetaRequest) -> NoCodeInstrumentMetaResponse:
    return no_code_service.get_instrument_meta(payload)


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
    try:
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=20.0)
        request = ScalperSnapshotRequest(**raw)
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Timeout waiting for init params.")
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"Invalid init params: {exc}"})
        except Exception:
            pass
        await websocket.close(code=1008)
        return

    session = ScalperLiveSession(request=request)
    await session.run(websocket)


@app.get("/api/no-code/status", response_model=NoCodeStatusResponse)
def get_no_code_status() -> NoCodeStatusResponse:
    return no_code_service.status()


@app.post("/api/no-code/stop", response_model=NoCodeStopResponse)
def stop_no_code() -> NoCodeStopResponse:
    no_code_service.stop()
    return NoCodeStopResponse(status="success", message="No Code Algo stopped.")


@app.post("/api/volume-breakout/start", response_model=VolumeBreakoutStartResponse)
def start_volume_breakout(payload: VolumeBreakoutStartRequest) -> VolumeBreakoutStartResponse:
    job = volume_breakout_service.start(payload)
    message = "Volume Breakout scanner started."
    if job.last_error:
        message = f"Volume Breakout scanner started with warning: {job.last_error}"
    return VolumeBreakoutStartResponse(status="success", message=message, job=job)


@app.get("/api/volume-breakout/status", response_model=VolumeBreakoutStatusResponse)
def get_volume_breakout_status() -> VolumeBreakoutStatusResponse:
    return volume_breakout_service.status()


@app.post("/api/volume-breakout/stop", response_model=VolumeBreakoutStopResponse)
def stop_volume_breakout() -> VolumeBreakoutStopResponse:
    volume_breakout_service.stop()
    return VolumeBreakoutStopResponse(status="success", message="Volume Breakout scanner stopped.")
