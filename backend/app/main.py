from fastapi import FastAPI
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
    StartLoginRequest,
    StartLoginResponse,
    StockSearchRequest,
    StockSearchResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.services.auth_service import auth_service
from app.services.instrument_service import instrument_service
from app.services.no_code_service import no_code_service

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


@app.post("/api/auth/start", response_model=StartLoginResponse)
def start_login(payload: StartLoginRequest) -> StartLoginResponse:
    return auth_service.start_login(payload)


@app.post("/api/auth/verify-otp", response_model=VerifyOtpResponse)
def verify_otp(payload: VerifyOtpRequest) -> VerifyOtpResponse:
    return auth_service.verify_otp(payload)


@app.post("/api/auth/verify-mpin", response_model=VerifyMpinResponse)
def verify_mpin(payload: VerifyMpinRequest) -> VerifyMpinResponse:
    return auth_service.verify_mpin(payload)


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


@app.get("/api/no-code/status", response_model=NoCodeStatusResponse)
def get_no_code_status() -> NoCodeStatusResponse:
    return no_code_service.status()


@app.post("/api/no-code/stop", response_model=NoCodeStopResponse)
def stop_no_code() -> NoCodeStopResponse:
    no_code_service.stop()
    return NoCodeStopResponse(status="success", message="No Code Algo stopped.")
