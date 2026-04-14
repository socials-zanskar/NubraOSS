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

    pool.Add(file_proto)
    return pool


POOL = _build_pool()
GenericData = message_factory.GetMessageClass(POOL.FindMessageTypeByName("nubra.GenericData"))
BatchWebSocketIndexBucketMessage = message_factory.GetMessageClass(
    POOL.FindMessageTypeByName("nubra.BatchWebSocketIndexBucketMessage")
)
