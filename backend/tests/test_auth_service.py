import unittest
from unittest.mock import patch

from app.schemas import SessionStatusRequest, VerifyMpinRequest
from app.services.auth_service import AuthService


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict:
        return self._payload


class FakeClient:
    def __init__(self, responses: dict[tuple[str, str], FakeResponse]) -> None:
        self._responses = responses

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def post(self, url: str, **kwargs) -> FakeResponse:
        return self._responses[("POST", url)]

    def get(self, url: str, **kwargs) -> FakeResponse:
        return self._responses[("GET", url)]


class AuthServiceTests(unittest.TestCase):
    def test_verify_mpin_uses_client_code_from_portfolio_endpoint(self) -> None:
        service = AuthService()
        service._flows["flow-1"] = {
            "phone": "9876543210",
            "environment": "PROD",
            "device_id": "device-1",
            "auth_token": "auth-token",
            "otp_verified": True,
        }
        responses = {
            ("POST", "https://api.nubra.io/verifypin"): FakeResponse(200, {"session_token": "session-token"}),
            (
                "GET",
                "https://api.nubra.io/portfolio/user_funds_and_margin",
            ): FakeResponse(200, {"port_funds_and_margin": {"client_code": "REAL123"}}),
        }

        with (
            patch("app.services.auth_service.httpx.Client", return_value=FakeClient(responses)),
            patch("app.services.auth_service.instrument_service.warm_cache", return_value=None),
        ):
            result = service.verify_mpin(VerifyMpinRequest(flow_id="flow-1", mpin="1234"))

        self.assertEqual(result.account_id, "REAL123")

    def test_session_status_returns_client_code_when_session_is_active(self) -> None:
        service = AuthService()
        responses = {
            ("GET", "https://api.nubra.io/userinfo"): FakeResponse(200, {"message": "ok"}),
            (
                "GET",
                "https://api.nubra.io/portfolio/user_funds_and_margin",
            ): FakeResponse(200, {"port_funds_and_margin": {"client_code": "REAL123"}}),
        }

        with patch("app.services.auth_service.httpx.Client", return_value=FakeClient(responses)):
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
