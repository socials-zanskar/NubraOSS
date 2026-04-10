from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_cors_origins, settings
from app.schemas import (
    StartLoginRequest,
    StartLoginResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.services.auth_service import auth_service

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


@app.post("/api/auth/start", response_model=StartLoginResponse)
def start_login(payload: StartLoginRequest) -> StartLoginResponse:
    return auth_service.start_login(payload)


@app.post("/api/auth/verify-otp", response_model=VerifyOtpResponse)
def verify_otp(payload: VerifyOtpRequest) -> VerifyOtpResponse:
    return auth_service.verify_otp(payload)


@app.post("/api/auth/verify-mpin", response_model=VerifyMpinResponse)
def verify_mpin(payload: VerifyMpinRequest) -> VerifyMpinResponse:
    return auth_service.verify_mpin(payload)
