from secrets import token_urlsafe

import httpx
from fastapi import HTTPException

from app.config import settings
from app.schemas import (
    StartLoginRequest,
    StartLoginResponse,
    VerifyMpinRequest,
    VerifyMpinResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)


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

    def start_login(self, payload: StartLoginRequest) -> StartLoginResponse:
        base_url = self._get_base_url(payload.environment)
        device_id = f"Nubra-OSS-{payload.phone}"

        try:
            with httpx.Client(timeout=20.0) as client:
                first_response = client.post(
                    f"{base_url}/sendphoneotp",
                    json={"phone": payload.phone, "skip_totp": False},
                    headers={"Content-Type": "application/json"},
                )
                if first_response.status_code >= 400:
                    raise HTTPException(
                        status_code=first_response.status_code,
                        detail=self._extract_error(first_response),
                    )

                first_payload = first_response.json()
                temp_token = first_payload.get("temp_token")
                if not temp_token:
                    raise HTTPException(
                        status_code=502,
                        detail="Nubra did not return temp_token in the initial OTP step.",
                    )

                second_response = client.post(
                    f"{base_url}/sendphoneotp",
                    json={"phone": payload.phone, "skip_totp": True},
                    headers={
                        "Content-Type": "application/json",
                        "x-temp-token": temp_token,
                    },
                )
                if second_response.status_code >= 400:
                    raise HTTPException(
                        status_code=second_response.status_code,
                        detail=self._extract_error(second_response),
                    )

                second_payload = second_response.json()
                temp_token = second_payload.get("temp_token")
                if not temp_token:
                    raise HTTPException(
                        status_code=502,
                        detail="Nubra did not return temp_token in the second OTP step.",
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
        account_suffix = flow["phone"][-4:]
        del self._flows[payload.flow_id]

        return VerifyMpinResponse(
            access_token=session_token,
            refresh_token=token_urlsafe(24),
            user_name="Nubra User",
            account_id=f"NUBRA-{account_suffix}",
            environment=environment,
            broker="Nubra",
            expires_in=3600,
            message="Nubra session established using the REST API login flow.",
        )


auth_service = AuthService()
