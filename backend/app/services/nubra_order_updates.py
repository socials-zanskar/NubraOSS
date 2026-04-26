from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from typing import Callable

from google.protobuf.any_pb2 import Any as ProtoAny
from google.protobuf.descriptor_pb2 import DescriptorProto, EnumDescriptorProto, FieldDescriptorProto, FileDescriptorProto
from google.protobuf.descriptor_pool import DescriptorPool
from google.protobuf.json_format import MessageToDict
from google.protobuf.message_factory import MessageFactory, GetMessageClass
from websockets.asyncio.client import connect


def _enum(name: str, values: list[tuple[str, int]]) -> EnumDescriptorProto:
    enum = EnumDescriptorProto(name=name)
    for value_name, number in values:
        value = enum.value.add()
        value.name = value_name
        value.number = number
    return enum


def _field(
    name: str,
    number: int,
    field_type: int,
    label: int = FieldDescriptorProto.LABEL_OPTIONAL,
    type_name: str | None = None,
) -> FieldDescriptorProto:
    field = FieldDescriptorProto()
    field.name = name
    field.number = number
    field.label = label
    field.type = field_type
    if type_name:
        field.type_name = type_name
    return field


def _message(name: str, fields: list[FieldDescriptorProto]) -> DescriptorProto:
    message = DescriptorProto(name=name)
    message.field.extend(fields)
    return message


def _build_pool() -> DescriptorPool:
    file_proto = FileDescriptorProto()
    file_proto.name = "nubra_order_updates.proto"
    file_proto.package = "zanskarsecurities.oms"
    file_proto.syntax = "proto3"

    file_proto.enum_type.extend(
        [
            _enum("OrderResponseType", [("ORDER_RESPONSE_INVALID", 0), ("ORDER_ACCEPTED", 1), ("ORDER_REJECTED", 2), ("ORDER_FILLED", 3), ("ORDER_TRIGGERED", 4), ("ORDER_CANCELLED", 5), ("BASKET_FILLED", 6)]),
            _enum("ExecutionType", [("EXECUTION_TYPE_INVALID", 0), ("EXECUTION_TYPE_FLEXI", 1), ("EXECUTION_TYPE_STOPLOSS", 2), ("EXECUTION_TYPE_VWAP", 3), ("EXECUTION_TYPE_TWAP", 4), ("EXECUTION_TYPE_CLOSE", 5), ("EXECUTION_TYPE_SCALING", 6), ("EXECUTION_TYPE_REGULAR", 7), ("EXECUTION_TYPE_ICEBERG", 8), ("EXECUTION_TYPE_TRAILING_SL", 9)]),
            _enum("ExecutionStatus", [("EXECUTION_STATUS_INVALID", 0), ("EXECUTION_STATUS_PENDING", 1), ("EXECUTION_STATUS_SENT", 2), ("EXECUTION_STATUS_OPEN", 3), ("EXECUTION_STATUS_REJECTED", 4), ("EXECUTION_STATUS_CANCELLED", 5), ("EXECUTION_STATUS_FILLED", 6), ("EXECUTION_STATUS_TRIGGERED", 7), ("EXECUTION_STATUS_CLOSED", 8), ("EXECUTION_STATUS_LIVE", 9)]),
            _enum("OrderSide", [("ORDER_SIDE_INVALID", 0), ("ORDER_SIDE_BUY", 1), ("ORDER_SIDE_SELL", 2)]),
            _enum("OrderType", [("ORDER_TYPE_INVALID", 0), ("ORDER_TYPE_LIMIT", 1), ("ORDER_TYPE_MARKET", 2), ("ORDER_TYPE_STOPLOSS", 3), ("ORDER_TYPE_VWAP", 4), ("ORDER_TYPE_TWAP", 5), ("ORDER_TYPE_CLOSE", 6), ("ORDER_TYPE_SCALING", 7), ("ORDER_TYPE_REGULAR", 8), ("ORDER_TYPE_ICEBERG", 9)]),
            _enum("OrderStatus", [("ORDER_STATUS_INVALID", 0), ("ORDER_STATUS_PENDING", 1), ("ORDER_STATUS_SENT", 2), ("ORDER_STATUS_OPEN", 3), ("ORDER_STATUS_REJECTED", 4), ("ORDER_STATUS_CANCELLED", 5), ("ORDER_STATUS_FILLED", 6), ("ORDER_STATUS_TRIGGERED", 7)]),
            _enum("OrderDeliveryType", [("ORDER_DELIVERY_TYPE_INVALID", 0), ("ORDER_DELIVERY_TYPE_CNC", 1), ("ORDER_DELIVERY_TYPE_IDAY", 2)]),
            _enum("StrategyType", [("STRATEGY_TYPE_INVALID", 0), ("STRATEGY_TYPE_LIMIT", 1), ("STRATEGY_TYPE_MARKET", 2), ("STRATEGY_TYPE_IOC", 3), ("STRATEGY_TYPE_ICEBERG", 4), ("STRATEGY_TYPE_STOPLOSS", 5), ("STRATEGY_TYPE_VWAP", 6), ("STRATEGY_TYPE_TWAP", 7), ("STRATEGY_TYPE_CLOSE", 8), ("STRATEGY_TYPE_SCALING", 9)]),
            _enum("PriceType", [("PRICE_TYPE_INVALID", 0), ("PRICE_TYPE_LIMIT", 1), ("PRICE_TYPE_MARKET", 2)]),
            _enum("ValidityType", [("VALIDITY_TYPE_INVALID", 0), ("VALIDITY_TYPE_DAY", 1), ("VALIDITY_TYPE_IOC", 2)]),
            _enum("BenchmarkType", [("BENCHMARK_TYPE_INVALID", 0), ("BENCHMARK_TYPE_VWAP", 1), ("BENCHMARK_TYPE_ARRIVAL", 2), ("BENCHMARK_TYPE_MANUAL", 3)]),
            _enum("OrderRequestType", [("ORDER_REQUEST_INVALID", 0), ("ORDER_REQUEST_NEW", 1), ("ORDER_REQUEST_MOD", 2), ("ORDER_REQUEST_CANCEL", 3)]),
            _enum("OptionType", [("INVALID", 0), ("CALL", 1), ("PUT", 2)]),
            _enum("ExchangeType", [("EXCHANGE_TYPE_INVALID", 0), ("NSE", 1), ("BSE", 2)]),
        ]
    )

    algo_params = _message(
        "AlgoParams",
        [
            _field("min_prate", 1, FieldDescriptorProto.TYPE_UINT32),
            _field("max_prate", 2, FieldDescriptorProto.TYPE_UINT32),
            _field("algo_duration", 3, FieldDescriptorProto.TYPE_UINT32),
            _field("benchmark_type", 4, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.BenchmarkType"),
            _field("benchmark_price", 5, FieldDescriptorProto.TYPE_INT64),
            _field("cleanup_price", 6, FieldDescriptorProto.TYPE_INT64),
            _field("trigger_price", 7, FieldDescriptorProto.TYPE_INT64),
            _field("leg_size", 8, FieldDescriptorProto.TYPE_UINT32),
            _field("algo_id", 9, FieldDescriptorProto.TYPE_STRING),
        ],
    )
    meta_info = _message(
        "MetaInfo",
        [
            _field("trailing_sl_limit_price", 1, FieldDescriptorProto.TYPE_UINT64),
            _field("trailing_sl_trigger_price", 2, FieldDescriptorProto.TYPE_UINT64),
            _field("parent_order_id", 3, FieldDescriptorProto.TYPE_INT64),
            _field("response_id", 4, FieldDescriptorProto.TYPE_INT64),
        ],
    )
    order_params = _message(
        "OrderParams",
        [
            _field("order_price", 1, FieldDescriptorProto.TYPE_INT64),
            _field("avg_fill_price", 2, FieldDescriptorProto.TYPE_INT64),
            _field("filled_qty", 3, FieldDescriptorProto.TYPE_UINT32),
            _field("zanskar_id", 4, FieldDescriptorProto.TYPE_UINT32),
            _field("ref_id", 5, FieldDescriptorProto.TYPE_INT64),
            _field("stock_name", 6, FieldDescriptorProto.TYPE_STRING),
            _field("asset_type", 7, FieldDescriptorProto.TYPE_STRING),
            _field("derivative_type", 8, FieldDescriptorProto.TYPE_STRING),
            _field("algo_params", 9, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.AlgoParams"),
            _field("exchange_order_id", 10, FieldDescriptorProto.TYPE_INT64),
            _field("trade_qty", 11, FieldDescriptorProto.TYPE_INT64),
            _field("trade_price", 12, FieldDescriptorProto.TYPE_INT64),
            _field("validity_type", 13, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ValidityType"),
            _field("asset", 14, FieldDescriptorProto.TYPE_STRING),
            _field("lot_size", 15, FieldDescriptorProto.TYPE_INT64),
            _field("order_expiry_date", 16, FieldDescriptorProto.TYPE_INT64),
            _field("expiry", 17, FieldDescriptorProto.TYPE_INT32),
            _field("option_type", 18, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OptionType"),
            _field("strike_price", 19, FieldDescriptorProto.TYPE_INT64),
            _field("side", 20, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderSide"),
            _field("display_name", 21, FieldDescriptorProto.TYPE_STRING),
            _field("qty", 22, FieldDescriptorProto.TYPE_INT32),
            _field("meta_info", 23, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.MetaInfo"),
        ],
    )
    basket_params = _message(
        "BasktParams",
        [
            _field("basket_strategy", 1, FieldDescriptorProto.TYPE_INT64),
            _field("entry_price", 2, FieldDescriptorProto.TYPE_INT64),
            _field("exit_price", 3, FieldDescriptorProto.TYPE_INT64),
            _field("stoploss_price", 4, FieldDescriptorProto.TYPE_INT64),
            _field("momentum_trigger_price", 5, FieldDescriptorProto.TYPE_INT64),
            _field("start_time", 6, FieldDescriptorProto.TYPE_INT64),
            _field("end_time", 7, FieldDescriptorProto.TYPE_INT64),
            _field("order_params", 8, FieldDescriptorProto.TYPE_MESSAGE, FieldDescriptorProto.LABEL_REPEATED, ".zanskarsecurities.oms.OrderParams"),
            _field("basket_type_name", 9, FieldDescriptorProto.TYPE_STRING),
            _field("algo_params", 10, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.AlgoParams"),
            _field("filled_entry_price", 11, FieldDescriptorProto.TYPE_INT64),
            _field("filled_exit_price", 12, FieldDescriptorProto.TYPE_INT64),
        ],
    )
    order = _message(
        "Order",
        [
            _field("exch", 1, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ExchangeType"),
            _field("order_id", 2, FieldDescriptorProto.TYPE_INT64),
            _field("user_id", 3, FieldDescriptorProto.TYPE_UINT32),
            _field("zanskar_id", 4, FieldDescriptorProto.TYPE_UINT32),
            _field("basket_id", 5, FieldDescriptorProto.TYPE_INT64),
            _field("ref_id", 6, FieldDescriptorProto.TYPE_INT64),
            _field("side", 7, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderSide"),
            _field("order_type", 8, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderType"),
            _field("order_status", 9, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderStatus"),
            _field("order_qty", 11, FieldDescriptorProto.TYPE_UINT32),
            _field("order_price", 12, FieldDescriptorProto.TYPE_INT64),
            _field("order_time", 13, FieldDescriptorProto.TYPE_INT64),
            _field("filled_qty", 14, FieldDescriptorProto.TYPE_UINT32),
            _field("avg_price", 15, FieldDescriptorProto.TYPE_INT64),
            _field("ack_time", 16, FieldDescriptorProto.TYPE_INT64),
            _field("filled_time", 17, FieldDescriptorProto.TYPE_INT64),
            _field("cancel_time", 18, FieldDescriptorProto.TYPE_INT64),
            _field("reject_time", 19, FieldDescriptorProto.TYPE_INT64),
            _field("last_modified", 20, FieldDescriptorProto.TYPE_INT64),
            _field("leg_size", 21, FieldDescriptorProto.TYPE_INT32),
            _field("order_delivery_type", 22, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderDeliveryType"),
            _field("update_msg", 23, FieldDescriptorProto.TYPE_STRING),
            _field("client_code", 24, FieldDescriptorProto.TYPE_STRING),
            _field("exchange_order_id", 25, FieldDescriptorProto.TYPE_INT64),
            _field("display_name", 26, FieldDescriptorProto.TYPE_STRING),
            _field("lot_size", 27, FieldDescriptorProto.TYPE_INT32),
            _field("stock_name", 28, FieldDescriptorProto.TYPE_STRING),
            _field("asset", 29, FieldDescriptorProto.TYPE_STRING),
            _field("derivative_type", 30, FieldDescriptorProto.TYPE_STRING),
            _field("trigger_price", 31, FieldDescriptorProto.TYPE_SINT32),
            _field("algo_duration", 32, FieldDescriptorProto.TYPE_UINT32),
            _field("strategy_type", 33, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.StrategyType"),
            _field("max_prate", 34, FieldDescriptorProto.TYPE_UINT32),
            _field("response_type", 35, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderResponseType"),
            _field("order_type_v2", 36, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderType"),
            _field("price_type", 37, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.PriceType"),
            _field("validity_type", 38, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ValidityType"),
            _field("algo_params", 39, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.AlgoParams"),
            _field("asset_type", 40, FieldDescriptorProto.TYPE_STRING),
            _field("trade_qty", 41, FieldDescriptorProto.TYPE_INT64),
            _field("trade_price", 42, FieldDescriptorProto.TYPE_INT64),
            _field("is_sor", 43, FieldDescriptorProto.TYPE_BOOL),
            _field("tag", 44, FieldDescriptorProto.TYPE_STRING),
            _field("request_type", 45, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderRequestType"),
            _field("order_expiry_date", 46, FieldDescriptorProto.TYPE_INT64),
            _field("meta_info", 47, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.MetaInfo"),
        ],
    )
    executions = _message(
        "Executions",
        [
            _field("id", 1, FieldDescriptorProto.TYPE_INT64),
            _field("response_type", 2, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderResponseType"),
            _field("delivery_type", 3, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderDeliveryType"),
            _field("execution_type", 4, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ExecutionType"),
            _field("side", 5, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderSide"),
            _field("price_type", 6, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.PriceType"),
            _field("qty", 7, FieldDescriptorProto.TYPE_INT64),
            _field("execution_status", 9, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ExecutionStatus"),
            _field("last_modified_time", 10, FieldDescriptorProto.TYPE_INT64),
            _field("creation_time", 11, FieldDescriptorProto.TYPE_INT64),
            _field("display_name", 12, FieldDescriptorProto.TYPE_STRING),
            _field("order_params", 13, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.OrderParams"),
            _field("basket_params", 14, FieldDescriptorProto.TYPE_MESSAGE, type_name=".zanskarsecurities.oms.BasktParams"),
            _field("ltp", 15, FieldDescriptorProto.TYPE_INT64),
            _field("update_msg", 16, FieldDescriptorProto.TYPE_STRING),
            _field("exch", 17, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.ExchangeType"),
            _field("is_sor", 18, FieldDescriptorProto.TYPE_BOOL),
            _field("tag", 19, FieldDescriptorProto.TYPE_STRING),
            _field("request_type", 20, FieldDescriptorProto.TYPE_ENUM, type_name=".zanskarsecurities.oms.OrderRequestType"),
        ],
    )

    file_proto.message_type.extend([algo_params, meta_info, order_params, basket_params, order, executions])
    pool = DescriptorPool()
    pool.AddSerializedFile(file_proto.SerializeToString())
    return pool


_POOL = _build_pool()
_ORDER_MESSAGE = GetMessageClass(_POOL.FindMessageTypeByName("zanskarsecurities.oms.Order"))
_EXECUTIONS_MESSAGE = GetMessageClass(_POOL.FindMessageTypeByName("zanskarsecurities.oms.Executions"))


@dataclass
class OrderUpdateEvent:
    kind: str
    payload: dict


class NubraOrderUpdateStream:
    def __init__(self, environment: str, session_token: str, on_event: Callable[[OrderUpdateEvent], None]) -> None:
        self._environment = environment
        self._session_token = session_token
        self._on_event = on_event
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="nubra-order-updates")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        asyncio.run(self._run_async())

    async def _run_async(self) -> None:
        ws_url = "wss://uatapi.nubra.io/ws" if self._environment == "UAT" else "wss://api.nubra.io/ws"
        while not self._stop_event.is_set():
            try:
                async with connect(ws_url, ping_interval=20, ping_timeout=20, open_timeout=20) as websocket:
                    await websocket.send(f"subscribe {self._session_token} notifications notification")
                    while not self._stop_event.is_set():
                        message = await asyncio.wait_for(websocket.recv(), timeout=30)
                        if isinstance(message, str):
                            self._on_event(OrderUpdateEvent(kind="text", payload={"message": message}))
                            continue
                        event = self._decode_binary(message)
                        if event:
                            self._on_event(event)
            except Exception as exc:
                self._on_event(OrderUpdateEvent(kind="error", payload={"message": str(exc)}))
                if self._stop_event.is_set():
                    return
                await asyncio.sleep(2)

    def _decode_binary(self, payload: bytes) -> OrderUpdateEvent | None:
        outer = ProtoAny()
        outer.ParseFromString(payload)
        inner = ProtoAny()
        inner.ParseFromString(outer.value)
        if inner.type_url.endswith("Order"):
            message = _ORDER_MESSAGE()
            message.ParseFromString(inner.value)
            return OrderUpdateEvent(kind="order", payload=MessageToDict(message, preserving_proto_field_name=True))
        if inner.type_url.endswith("Executions"):
            message = _EXECUTIONS_MESSAGE()
            message.ParseFromString(inner.value)
            return OrderUpdateEvent(kind="execution", payload=MessageToDict(message, preserving_proto_field_name=True))
        return None
