from __future__ import annotations

from google.protobuf import any_pb2, descriptor_pb2, descriptor_pool, message_factory


def _build_pool() -> descriptor_pool.DescriptorPool:
    pool = descriptor_pool.DescriptorPool()
    pool.AddSerializedFile(any_pb2.DESCRIPTOR.serialized_pb)

    file_proto = descriptor_pb2.FileDescriptorProto()
    file_proto.name = "nubra_ws.proto"
    file_proto.package = "nubra"
    file_proto.syntax = "proto3"
    file_proto.dependency.append("google/protobuf/any.proto")

    enum_proto = file_proto.enum_type.add()
    enum_proto.name = "Interval"
    for name, number in (
        ("INTERVAL_INVALID", 0),
        ("INTERVAL_1_SECOND", 1),
        ("INTERVAL_10_SECOND", 2),
        ("INTERVAL_1_MINUTE", 3),
        ("INTERVAL_2_MINUTE", 4),
        ("INTERVAL_3_MINUTE", 5),
        ("INTERVAL_5_MINUTE", 6),
        ("INTERVAL_10_MINUTE", 7),
        ("INTERVAL_15_MINUTE", 8),
        ("INTERVAL_30_MINUTE", 9),
        ("INTERVAL_1_HOUR", 10),
        ("INTERVAL_2_HOUR", 11),
        ("INTERVAL_4_HOUR", 12),
        ("INTERVAL_1_DAY", 13),
        ("INTERVAL_1_WEEK", 14),
        ("INTERVAL_1_MONTH", 15),
        ("INTERVAL_1_YEAR", 16),
    ):
        value = enum_proto.value.add()
        value.name = name
        value.number = number

    generic_proto = file_proto.message_type.add()
    generic_proto.name = "GenericData"
    field = generic_proto.field.add()
    field.name = "key"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    field = generic_proto.field.add()
    field.name = "data"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".google.protobuf.Any"

    item_proto = file_proto.message_type.add()
    item_proto.name = "WebSocketMsgIndexBucket"
    for name, number, field_type, type_name in (
        ("indexname", 1, descriptor_pb2.FieldDescriptorProto.TYPE_STRING, None),
        ("exchange", 2, descriptor_pb2.FieldDescriptorProto.TYPE_STRING, None),
        ("interval", 3, descriptor_pb2.FieldDescriptorProto.TYPE_ENUM, ".nubra.Interval"),
        ("timestamp", 4, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("open", 5, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("high", 6, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("low", 7, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("close", 8, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("bucket_volume", 9, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("tick_volume", 10, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("cumulative_volume", 11, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
        ("bucket_timestamp", 12, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None),
    ):
        field = item_proto.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        field.type = field_type
        if type_name:
            field.type_name = type_name

    batch_proto = file_proto.message_type.add()
    batch_proto.name = "BatchWebSocketIndexBucketMessage"
    field = batch_proto.field.add()
    field.name = "timestamp"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT64
    for name, number in (("indexes", 2), ("instruments", 3)):
        field = batch_proto.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
        field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
        field.type_name = ".nubra.WebSocketMsgIndexBucket"

    # -----------------------------------------------------------------------
    # WebSocketMsgIndex  (channel: "index")
    # Used by the scalper live feed to receive real-time underlying ticks.
    # -----------------------------------------------------------------------
    index_item_proto = file_proto.message_type.add()
    index_item_proto.name = "WebSocketMsgIndex"
    for name, number, field_type in (
        ("indexname", 1, descriptor_pb2.FieldDescriptorProto.TYPE_STRING),
        ("timestamp", 2, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("index_value", 3, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("high_index_value", 4, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("low_index_value", 5, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("volume", 6, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("changepercent", 7, descriptor_pb2.FieldDescriptorProto.TYPE_FLOAT),
        ("tick_volume", 8, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("prev_close", 9, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
        ("exchange", 10, descriptor_pb2.FieldDescriptorProto.TYPE_STRING),
        ("volume_oi", 11, descriptor_pb2.FieldDescriptorProto.TYPE_INT64),
    ):
        field = index_item_proto.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        field.type = field_type

    batch_index_proto = file_proto.message_type.add()
    batch_index_proto.name = "BatchWebSocketIndexMessage"
    field = batch_index_proto.field.add()
    field.name = "timestamp"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT64
    for name, number in (("indexes", 2), ("instruments", 3)):
        field = batch_index_proto.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
        field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
        field.type_name = ".nubra.WebSocketMsgIndex"

    # -----------------------------------------------------------------------
    # OrderBookLevel + WebSocketMsgOrderBook  (channel: "orderbook")
    # Used by the scalper live feed for CE / PE option tick data.
    # -----------------------------------------------------------------------
    ob_level_proto = file_proto.message_type.add()
    ob_level_proto.name = "OrderBookLevel"
    for name, number in (("price", 1), ("quantity", 2), ("orders", 3)):
        field = ob_level_proto.field.add()
        field.name = name
        field.number = number
        field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT64

    ob_item_proto = file_proto.message_type.add()
    ob_item_proto.name = "WebSocketMsgOrderBook"
    for name, number, field_type, type_name, label in (
        ("inst_id", 1, descriptor_pb2.FieldDescriptorProto.TYPE_UINT32, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
        ("timestamp", 2, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
        ("bids", 3, descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE, ".nubra.OrderBookLevel", descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED),
        ("asks", 4, descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE, ".nubra.OrderBookLevel", descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED),
        ("ltp", 5, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
        ("ltq", 6, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
        ("volume", 7, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
        ("ref_id", 8, descriptor_pb2.FieldDescriptorProto.TYPE_INT64, None, descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL),
    ):
        field = ob_item_proto.field.add()
        field.name = name
        field.number = number
        field.label = label
        field.type = field_type
        if type_name:
            field.type_name = type_name

    batch_ob_proto = file_proto.message_type.add()
    batch_ob_proto.name = "BatchWebSocketOrderbookMessage"
    field = batch_ob_proto.field.add()
    field.name = "timestamp"
    field.number = 1
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_INT64
    field = batch_ob_proto.field.add()
    field.name = "instruments"
    field.number = 2
    field.label = descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
    field.type = descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
    field.type_name = ".nubra.WebSocketMsgOrderBook"

    pool.Add(file_proto)
    return pool


POOL = _build_pool()
GenericData = message_factory.GetMessageClass(POOL.FindMessageTypeByName("nubra.GenericData"))
BatchWebSocketIndexBucketMessage = message_factory.GetMessageClass(
    POOL.FindMessageTypeByName("nubra.BatchWebSocketIndexBucketMessage")
)
BatchWebSocketIndexMessage = message_factory.GetMessageClass(
    POOL.FindMessageTypeByName("nubra.BatchWebSocketIndexMessage")
)
BatchWebSocketOrderbookMessage = message_factory.GetMessageClass(
    POOL.FindMessageTypeByName("nubra.BatchWebSocketOrderbookMessage")
)
