import base64
import json
from datetime import UTC, datetime
from secrets import token_urlsafe

import httpx
from fastapi import HTTPException

from app.config import settings
from app.schemas import (
    SessionStatusRequest,
    SessionStatusResponse,
    StartLoginRequest,
    StartLoginResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)
from app.services.instrument_service import instrument_service


class AuthService:
    def __init__(self) -> None:
        self._flows: dict[str, dict] = {}

    def _get_base_url(self, environment: str) -> str:
        if environment == "UAT":
            return settings.nubra_uat_base_url
        return settings.nubra_prod_base_url

    def _extract_error(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        return (
            payload.get("message")
            or payload.get("detail")
            or payload.get("error")
            or f"Nubra request failed with status {response.status_code}."
        )

    def _decode_expiry(self, session_token: str) -> str | None:
        try:
            parts = session_token.split(".")
            if len(parts) < 2:
                return None
            payload = parts[1]
            padding = "=" * (-len(payload) % 4)
            decoded = json.loads(base64.urlsafe_b64decode(payload + padding).decode("utf-8"))
            exp = decoded.get("exp")
            if exp is None:
                return None
            return datetime.fromtimestamp(int(exp), tz=UTC).isoformat()
        except Exception:
            return None

    def _session_headers(self, session_token: str, device_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-device-id": device_id,
        }

    def _find_nested_string(self, payload: object, field_name: str, *, depth: int = 4) -> str | None:
        if depth < 0:
            return None
        if isinstance(payload, dict):
            value = payload.get(field_name)
            if isinstance(value, str) and value.strip():
                return value.strip()
            for nested in payload.values():
                found = self._find_nested_string(nested, field_name, depth=depth - 1)
                if found:
                    return found
        if isinstance(payload, list):
            for nested in payload:
                found = self._find_nested_string(nested, field_name, depth=depth - 1)
                if found:
                    return found
        return None

    def _fetch_client_code(
        self,
        client: httpx.Client,
        *,
        base_url: str,
        session_token: str,
        device_id: str,
    ) -> str | None:
        headers = self._session_headers(session_token, device_id)
        for path in (
            "portfolio/user_funds_and_margin",
            "portfolio/v2/positions",
            "portfolio/holdings",
            "userinfo",
        ):
            try:
                response = client.get(f"{base_url}/{path}", headers=headers)
            except httpx.RequestError:
                continue
            if response.status_code >= 400:
                continue
            try:
                payload = response.json()
            except ValueError:
                continue
            client_code = self._find_nested_string(payload, "client_code")
            if client_code:
                return client_code
        return None

    def start_login(self, payload: StartLoginRequest) -> StartLoginResponse:
        base_url = self._get_base_url(payload.environment)
        device_id = f"Nubra-OSS-{payload.phone}"

        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    f"{base_url}/sendphoneotp",
                    json={"phone": payload.phone, "skip_totp": False},
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=self._extract_error(response),
                    )

                response_payload = response.json()
                temp_token = response_payload.get("temp_token")
                if not temp_token:
                    raise HTTPException(
                        status_code=502,
                        detail="Nubra did not return temp_token in the OTP step.",
                    )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to reach Nubra auth service: {exc}",
            ) from exc

        flow_id = token_urlsafe(16)
        self._flows[flow_id] = {
            "phone": payload.phone,
            "environment": payload.environment,
            "device_id": device_id,
            "temp_token": temp_token,
            "otp_verified": False,
        }
        masked_phone = f"{payload.phone[:2]}******{payload.phone[-2:]}"
        return StartLoginResponse(
            flow_id=flow_id,
            next_step="otp",
            masked_phone=masked_phone,
            environment=payload.environment,
            device_id=device_id,
            message="OTP sent. Verify the SMS OTP, then continue to MPIN verification.",
        )

    def verify_otp(self, payload: VerifyOtpRequest) -> VerifyOtpResponse:
        flow = self._flows.get(payload.flow_id)
        if not flow:
            raise HTTPException(status_code=404, detail="Login flow not found.")
        if not payload.otp.isdigit():
            raise HTTPException(status_code=400, detail="OTP must be numeric.")

        base_url = self._get_base_url(flow["environment"])

        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    f"{base_url}/verifyphoneotp",
                    json={"phone": flow["phone"], "otp": payload.otp},
                    headers={
                        "Content-Type": "application/json",
                        "x-temp-token": flow["temp_token"],
                        "x-device-id": flow["device_id"],
                    },
                )
                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=self._extract_error(response),
                    )
                response_payload = response.json()
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to reach Nubra auth service: {exc}",
            ) from exc

        auth_token = response_payload.get("auth_token")
        if not auth_token:
            raise HTTPException(
                status_code=502,
                detail="Nubra did not return auth_token after OTP verification.",
            )

        flow["auth_token"] = auth_token
        flow["otp_verified"] = True
        return VerifyOtpResponse(
            flow_id=payload.flow_id,
            next_step="mpin",
            message="OTP accepted. Continue with MPIN verification.",
        )

    def verify_mpin(self, payload: VerifyMpinRequest) -> VerifyMpinResponse:
        flow = self._flows.get(payload.flow_id)
        if not flow:
            raise HTTPException(status_code=404, detail="Login flow not found.")
        if not flow["otp_verified"]:
            raise HTTPException(status_code=409, detail="OTP must be verified first.")
        if not payload.mpin.isdigit():
            raise HTTPException(status_code=400, detail="MPIN must be numeric.")

        base_url = self._get_base_url(flow["environment"])
        client_code = None

        try:
            with httpx.Client(timeout=20.0) as client:
                response = client.post(
                    f"{base_url}/verifypin",
                    json={"pin": payload.mpin},
                    headers={
                        "Content-Type": "application/json",
                        "x-device-id": flow["device_id"],
                        "Authorization": f"Bearer {flow['auth_token']}",
                    },
                )
                if response.status_code >= 400:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=self._extract_error(response),
                    )
                response_payload = response.json()
                session_token = response_payload.get("session_token")
                if session_token:
                    client_code = self._fetch_client_code(
                        client,
                        base_url=base_url,
                        session_token=session_token,
                        device_id=flow["device_id"],
                    )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to reach Nubra auth service: {exc}",
            ) from exc

        session_token = response_payload.get("session_token")
        if not session_token:
            raise HTTPException(
                status_code=502,
                detail="Nubra did not return session_token after MPIN verification.",
            )

        environment = flow["environment"]
        device_id = flow["device_id"]
        del self._flows[payload.flow_id]

        try:
            instrument_service.warm_cache(session_token, environment, device_id)
        except HTTPException:
            pass

        return VerifyMpinResponse(
            access_token=session_token,
            refresh_token=token_urlsafe(24),
            user_name="Nubra User",
            account_id=client_code or f"NUBRA-{flow['phone'][-4:]}",
            device_id=device_id,
            environment=environment,
            broker="Nubra",
            expires_in=3600,
            message="Nubra session established using the REST API login flow.",
        )

    def session_status(self, payload: SessionStatusRequest) -> SessionStatusResponse:
        base_url = self._get_base_url(payload.environment)
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(
                    f"{base_url}/userinfo",
                    headers=self._session_headers(payload.session_token, payload.device_id),
                )
                account_id = None
                if response.status_code < 400:
                    account_id = self._fetch_client_code(
                        client,
                        base_url=base_url,
                        session_token=payload.session_token,
                        device_id=payload.device_id,
                    )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to reach Nubra auth service: {exc}",
            ) from exc

        if response.status_code in (401, 403, 440):
            return SessionStatusResponse(
                active=False,
                environment=payload.environment,
                expires_at_utc=self._decode_expiry(payload.session_token),
                account_id=None,
                message=self._extract_error(response),
            )

        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=self._extract_error(response),
            )

        return SessionStatusResponse(
            active=True,
            environment=payload.environment,
            expires_at_utc=self._decode_expiry(payload.session_token),
            account_id=account_id,
            message="Session is active.",
        )


auth_service = AuthService()
