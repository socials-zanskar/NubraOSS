"""
Nubra Strategy Engine — Local REST API Server
==============================================
Start:
    python server.py
    # or with auto-reload during development:
    uvicorn server:app --reload --port 8000

Endpoints:
    GET  /health              → liveness check
    GET  /indicators          → full indicator catalog
    POST /validate            → validate strategy JSON only (no data fetch)
    POST /backtest            → run full backtest
    POST /realtime            → evaluate current signal (live / as-of)

Interactive docs (auto-generated):
    http://localhost:8000/docs      (Swagger UI)
    http://localhost:8000/redoc     (ReDoc)
"""
from __future__ import annotations

import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

# ── path setup (allows running from any cwd) ──────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

from nubra_backtester import NubraStrategyEngine, Strategy

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
_log = logging.getLogger("nubra.server")

# =============================================================================
# Engine singleton
# =============================================================================

_engine: NubraStrategyEngine | None = None


def _get_engine() -> NubraStrategyEngine:
    if _engine is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Engine not initialised. Check server startup logs.",
        )
    return _engine


# =============================================================================
# Lifespan — initialise SDK once at startup
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine
    env          = os.getenv("NUBRA_ENV",         "PROD")
    totp_login   = os.getenv("NUBRA_TOTP",        "false").lower() == "true"
    env_creds    = os.getenv("NUBRA_ENV_CREDS",   "true").lower()  == "true"
    insti_login  = os.getenv("NUBRA_INSTI_LOGIN", "false").lower() == "true"
    warmup_buf   = int(os.getenv("NUBRA_WARMUP_BUFFER", "300"))
    max_refetch  = int(os.getenv("NUBRA_MAX_REFETCH",   "4"))

    _log.info("Initialising Nubra SDK  env=%s  totp=%s  env_creds=%s", env, totp_login, env_creds)
    try:
        _engine = NubraStrategyEngine.from_sdk(
            env=env,
            totp_login=totp_login,
            env_creds=env_creds,
            insti_login=insti_login,
            warmup_buffer_bars=warmup_buf,
            max_refetch_attempts=max_refetch,
        )
        _log.info("Engine ready.")
    except Exception as exc:
        _log.error("Engine init failed: %s", exc)
        # Server starts but every request gets a 503 until fixed
    yield
    _log.info("Server shutting down.")


# =============================================================================
# App
# =============================================================================

app = FastAPI(
    title="Nubra Strategy Engine API",
    version="1.0.0",
    description=(
        "Local REST wrapper around the Nubra backtester. "
        "POST a Strategy JSON to /backtest or /realtime."
    ),
    lifespan=lifespan,
)

# ── CORS — allow all origins for local development ────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Request / response models
# =============================================================================

class RealtimeRequest(BaseModel):
    strategy: dict[str, Any]
    as_of: str | None = None   # ISO datetime string, e.g. "2026-04-20T14:30:00"


class ErrorDetail(BaseModel):
    error: str
    detail: str | list[Any]
    request_id: str | None = None


# =============================================================================
# Middleware — request timing + request-id logging
# =============================================================================

@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0  = time.perf_counter()
    rid = request.headers.get("X-Request-Id", "—")
    _log.info("→ %s %s  rid=%s", request.method, request.url.path, rid)
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    _log.info("← %s %s  %dms  rid=%s", request.method, request.url.path, ms, rid)
    return response


# =============================================================================
# Error helpers
# =============================================================================

def _validation_error_response(exc: ValidationError | Exception) -> JSONResponse:
    if isinstance(exc, ValidationError):
        # exc.errors() may contain non-serialisable objects (e.g. the original
        # ValueError inside 'ctx'). exc.json() handles serialisation correctly;
        # parse it back so we can embed it in our envelope.
        import json as _json
        errors = _json.loads(exc.json(include_url=False))
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error":  "strategy_validation_failed",
                "detail": errors,
            },
        )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error":  "strategy_validation_failed",
            "detail": str(exc),
        },
    )


def _engine_error_response(exc: Exception) -> JSONResponse:
    msg = str(exc)
    _log.exception("Engine error")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "engine_error", "detail": msg},
    )


# =============================================================================
# Routes
# =============================================================================

@app.get(
    "/health",
    summary="Liveness check",
    tags=["meta"],
)
def health():
    """Returns `ok` when the server is up. The engine may still be initialising."""
    return {
        "status":  "ok",
        "engine":  "ready" if _engine is not None else "unavailable",
    }


@app.get(
    "/indicators",
    summary="Indicator catalog",
    tags=["meta"],
)
def indicators():
    """Returns the full list of supported indicators with their params and output keys."""
    return NubraStrategyEngine.indicator_catalog()


@app.post(
    "/validate",
    summary="Validate a strategy without running it",
    tags=["strategy"],
)
def validate(strategy_json: dict[str, Any]):
    """
    Parses and validates the strategy JSON using the same Pydantic models the
    engine uses internally. Returns the normalised strategy on success, or a
    structured error list on failure. No market data is fetched.
    """
    try:
        strategy = Strategy.model_validate(strategy_json)
    except (ValidationError, ValueError) as exc:
        return _validation_error_response(exc)

    return {
        "valid":    True,
        "strategy": strategy.model_dump(mode="json"),
    }


@app.post(
    "/backtest",
    summary="Run a full historical backtest",
    tags=["strategy"],
)
def backtest(strategy_json: dict[str, Any]):
    """
    Runs a full backtest for the given strategy JSON.

    **Input:** Strategy JSON (see /docs for schema or `frontend_integration.md`).

    **Output:** `StrategyBacktestResult` containing portfolio metrics, per-instrument
    metrics, trade list, equity curve, full signal log, and per-bar condition evaluations.
    """
    # Validate before touching the engine so bad payloads always get 422, not 503/500
    try:
        Strategy.model_validate(strategy_json)
    except (ValidationError, ValueError) as exc:
        return _validation_error_response(exc)

    engine = _get_engine()

    try:
        result = engine.backtest_json(strategy_json)
    except Exception as exc:
        return _engine_error_response(exc)

    return result


@app.post(
    "/realtime",
    summary="Evaluate the current (or as-of) signal",
    tags=["strategy"],
)
def realtime(request: RealtimeRequest):
    """
    Evaluates a live trading signal for the strategy.

    **Input:**
    ```json
    {
      "strategy": { ... },
      "as_of": "2026-04-20T14:30:00"   // optional — defaults to now
    }
    ```

    **Output:** `StrategySignalResult` with `action_if_flat`, `action_if_in_position`,
    `entry_signal`, `exit_signal`, suggested SL/target prices, and condition evaluations.
    """
    try:
        Strategy.model_validate(request.strategy)
    except (ValidationError, ValueError) as exc:
        return _validation_error_response(exc)

    engine = _get_engine()

    try:
        result = engine.evaluate_realtime_json(request.strategy, as_of=request.as_of)
    except Exception as exc:
        return _engine_error_response(exc)

    return result


# =============================================================================
# Global exception handler — catches anything that slips through
# =============================================================================

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    _log.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "internal_server_error", "detail": str(exc)},
    )


# =============================================================================
# Entry point
# =============================================================================

if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "false").lower() == "true"

    _log.info("Starting server on %s:%d  reload=%s", host, port, reload)
    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
