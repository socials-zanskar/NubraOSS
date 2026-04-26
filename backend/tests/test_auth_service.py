import unittest
from unittest.mock import patch

from app.schemas import SessionStatusRequest, StartLoginRequest, VerifyMpinRequest, VerifyOtpRequest, VerifyTotpRequest
from app.services.auth_service import AuthService


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload


class FakeClient:
    def __init__(self, responses: dict[tuple[str, str], list[FakeResponse]]) -> None:
        self._responses = {key: list(value) for key, value in responses.items()}
        self.calls: list[dict] = []

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def _pop_response(self, method: str, url: str) -> FakeResponse:
        queue = self._responses[(method, url)]
        if len(queue) == 1:
            return queue[0]
        return queue.pop(0)

    def post(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": "POST", "url": url, **kwargs})
        return self._pop_response("POST", url)

    def get(self, url: str, **kwargs) -> FakeResponse:
        self.calls.append({"method": "GET", "url": url, **kwargs})
        return self._pop_response("GET", url)


class AuthServiceTests(unittest.TestCase):
    def test_start_login_otp_uses_second_sendphoneotp_token(self) -> None:
        service = AuthService()
        client = FakeClient(
            {
                ("POST", "https://api.nubra.io/sendphoneotp"): [
                    FakeResponse(200, {"temp_token": "temp-1"}),
                    FakeResponse(200, {"temp_token": "temp-2"}),
                ]
            }
        )

        with patch("app.services.auth_service.httpx.Client", return_value=client):
            result = service.start_login(
                StartLoginRequest(phone="9876543210", environment="PROD", auth_method="otp")
            )

        self.assertEqual(result.next_step, "otp")
        self.assertEqual(service._flows[result.flow_id]["temp_token"], "temp-2")
        self.assertEqual(len(client.calls), 2)
        self.assertEqual(client.calls[1]["json"], {"phone": "9876543210", "skip_totp": True})
        self.assertEqual(client.calls[1]["headers"]["x-temp-token"], "temp-1")

    def test_verify_totp_uses_totp_login_and_unlocks_mpin(self) -> None:
        service = AuthService()
        service._flows["flow-1"] = {
            "phone": "9876543210",
            "environment": "PROD",
            "device_id": "device-1",
            "auth_method": "totp",
            "temp_token": None,
            "factor_verified": False,
        }
        client = FakeClient(
            {
                ("POST", "https://api.nubra.io/totp/login"): [
                    FakeResponse(200, {"auth_token": "auth-token"}),
                ]
            }
        )

        with patch("app.services.auth_service.httpx.Client", return_value=client):
            result = service.verify_totp(VerifyTotpRequest(flow_id="flow-1", totp="123456"))

        self.assertEqual(result.next_step, "mpin")
        self.assertTrue(service._flows["flow-1"]["factor_verified"])
        self.assertEqual(service._flows["flow-1"]["auth_token"], "auth-token")
        self.assertEqual(client.calls[0]["json"], {"phone": "9876543210", "totp": 123456})

    def test_verify_otp_uses_latest_temp_token(self) -> None:
        service = AuthService()
        service._flows["flow-1"] = {
            "phone": "9876543210",
            "environment": "PROD",
            "device_id": "device-1",
            "auth_method": "otp",
            "temp_token": "temp-2",
            "factor_verified": False,
        }
        client = FakeClient(
            {
                ("POST", "https://api.nubra.io/verifyphoneotp"): [
                    FakeResponse(200, {"auth_token": "auth-token"}),
                ]
            }
        )

        with patch("app.services.auth_service.httpx.Client", return_value=client):
            result = service.verify_otp(VerifyOtpRequest(flow_id="flow-1", otp="123456"))

        self.assertEqual(result.next_step, "mpin")
        self.assertEqual(client.calls[0]["headers"]["x-temp-token"], "temp-2")

    def test_verify_mpin_uses_client_code_from_portfolio_endpoint(self) -> None:
        service = AuthService()
        service._flows["flow-1"] = {
            "phone": "9876543210",
            "environment": "PROD",
            "device_id": "device-1",
            "auth_method": "otp",
            "temp_token": "temp-2",
            "auth_token": "auth-token",
            "factor_verified": True,
        }
        client = FakeClient(
            {
                ("POST", "https://api.nubra.io/verifypin"): [
                    FakeResponse(200, {"session_token": "session-token"}),
                ],
                ("GET", "https://api.nubra.io/portfolio/user_funds_and_margin"): [
                    FakeResponse(200, {"port_funds_and_margin": {"client_code": "REAL123"}}),
                ],
            }
        )

        with (
            patch("app.services.auth_service.httpx.Client", return_value=client),
            patch("app.services.auth_service.instrument_service.warm_cache", return_value=None),
        ):
            result = service.verify_mpin(VerifyMpinRequest(flow_id="flow-1", mpin="1234"))

        self.assertEqual(result.account_id, "REAL123")

    def test_session_status_returns_client_code_when_session_is_active(self) -> None:
        service = AuthService()
        client = FakeClient(
            {
                ("GET", "https://api.nubra.io/userinfo"): [
                    FakeResponse(200, {"message": "ok"}),
                ],
                ("GET", "https://api.nubra.io/portfolio/user_funds_and_margin"): [
                    FakeResponse(200, {"port_funds_and_margin": {"client_code": "REAL123"}}),
                ],
            }
        )

        with patch("app.services.auth_service.httpx.Client", return_value=client):
            result = service.session_status(
                SessionStatusRequest(
                    session_token="session-token",
                    device_id="device-1",
                    environment="PROD",
                )
            )

        self.assertTrue(result.active)
        self.assertEqual(result.account_id, "REAL123")


if __name__ == "__main__":
    unittest.main()
