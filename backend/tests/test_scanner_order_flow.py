import unittest
from unittest.mock import patch

from app.schemas import ScannerOrderPreviewRequest, ScannerOrderSubmitRequest
from app.services.scalper_service import ScalperService


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


class ScannerOrderFlowTests(unittest.TestCase):
    def test_preview_stock_order_resolves_ref_meta_and_normalizes_qty(self) -> None:
        service = ScalperService()
        with patch(
            "app.services.scalper_service.instrument_service.resolve_stock_meta",
            return_value=(12345, 5, 5),
        ):
            result = service.preview_stock_order(
                ScannerOrderPreviewRequest(
                    session_token="session-token-123",
                    device_id="device-1",
                    environment="UAT",
                    symbol="COCHINSHIP",
                    instrument_display_name="COCHINSHIP",
                    exchange="NSE",
                    order_side="ORDER_SIDE_BUY",
                    quantity=7,
                    ltp_price=262.5,
                    order_delivery_type="ORDER_DELIVERY_TYPE_IDAY",
                )
            )

        self.assertEqual(result.instrument_ref_id, 12345)
        self.assertEqual(result.lot_size, 5)
        self.assertEqual(result.tick_size, 5)
        self.assertEqual(result.requested_qty, 7)
        self.assertEqual(result.order_qty, 10)
        self.assertEqual(result.preview_limit_price, 267.75)
        self.assertEqual(result.estimated_order_value, 2677.5)
        self.assertEqual(result.environment, "UAT")

    def test_place_stock_order_posts_single_order_payload(self) -> None:
        service = ScalperService()
        client = FakeClient(
            {
                ("POST", "https://uatapi.nubra.io/orders/v2/single"): [
                    FakeResponse(200, {"order_id": 9988, "order_status": "accepted", "order_price": 25725}),
                ]
            }
        )

        with patch("app.services.scalper_service.httpx.Client", return_value=client):
            result = service.place_stock_order(
                ScannerOrderSubmitRequest(
                    session_token="session-token-123",
                    device_id="device-1",
                    environment="UAT",
                    symbol="CUB",
                    instrument_display_name="CUB",
                    exchange="NSE",
                    instrument_ref_id=456,
                    order_side="ORDER_SIDE_SELL",
                    quantity=3,
                    lot_size=1,
                    tick_size=5,
                    ltp_price=262.5,
                    order_delivery_type="ORDER_DELIVERY_TYPE_CNC",
                    tag="nubraoss_scanner_cub",
                )
            )

        self.assertEqual(result.order_id, 9988)
        self.assertEqual(result.order_status, "ACCEPTED")
        self.assertEqual(result.order_qty, 3)
        self.assertEqual(result.order_price, 257.25)
        self.assertEqual(client.calls[0]["json"]["ref_id"], 456)
        self.assertEqual(client.calls[0]["json"]["order_side"], "ORDER_SIDE_SELL")
        self.assertEqual(client.calls[0]["json"]["order_qty"], 3)
        self.assertEqual(client.calls[0]["json"]["order_delivery_type"], "ORDER_DELIVERY_TYPE_CNC")
        self.assertEqual(client.calls[0]["json"]["tag"], "nubraoss_scanner_cub")


if __name__ == "__main__":
    unittest.main()
