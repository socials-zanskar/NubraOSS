from typing import Literal

from pydantic import BaseModel, Field


Environment = Literal["PROD", "UAT"]


class StartLoginRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=15)
    environment: Environment


class StartLoginResponse(BaseModel):
    flow_id: str
    next_step: Literal["otp"]
    masked_phone: str
    environment: Environment
    device_id: str
    message: str


class VerifyOtpRequest(BaseModel):
    flow_id: str
    otp: str = Field(min_length=4, max_length=8)


class VerifyOtpResponse(BaseModel):
    flow_id: str
    next_step: Literal["mpin"]
    message: str


class VerifyMpinRequest(BaseModel):
    flow_id: str
    mpin: str = Field(min_length=4, max_length=6)


class VerifyMpinResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_name: str
    account_id: str
    environment: Environment
    broker: Literal["Nubra"]
    expires_in: int
    message: str


Interval = Literal["1m", "2m", "3m", "5m", "15m", "30m", "1h"]
IndicatorType = Literal["EMA", "MA", "RSI"]
OrderDeliveryType = Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"]
StrategySideMode = Literal["BOTH", "LONG_ONLY", "SHORT_ONLY"]


class NoCodeEmaConfig(BaseModel):
    fast: int = Field(ge=1, le=500)
    slow: int = Field(ge=1, le=500)


class NoCodeRsiConfig(BaseModel):
    length: int = Field(ge=2, le=200)
    upper: float = Field(ge=1, le=100)
    lower: float = Field(ge=0, le=99)


class NoCodeStartRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    instrument: str = Field(min_length=1, max_length=128)
    interval: Interval
    indicator: IndicatorType
    order_qty: int = Field(default=1, ge=1, le=1000000)
    order_delivery_type: OrderDeliveryType = "ORDER_DELIVERY_TYPE_IDAY"
    strategy_side_mode: StrategySideMode = "BOTH"
    ema: NoCodeEmaConfig | None = None
    ma: NoCodeEmaConfig | None = None
    rsi: NoCodeRsiConfig | None = None


class NoCodeInstrumentMetaRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    instrument: str = Field(min_length=1, max_length=128)


class NoCodeInstrumentMetaResponse(BaseModel):
    instrument: str
    ref_id: int
    tick_size: int
    lot_size: int


class StockSearchRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    query: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=8, ge=1, le=20)


class StockSearchItem(BaseModel):
    instrument: str
    display_name: str
    exchange: str
    ref_id: int
    tick_size: int
    lot_size: int


class StockSearchResponse(BaseModel):
    items: list[StockSearchItem]


class NoCodeAlert(BaseModel):
    id: str
    signal: str
    instrument: str
    interval: Interval
    indicator: IndicatorType
    candle_time_ist: str
    triggered_at_ist: str
    price: float
    detail: str


class NoCodeTrackerRow(BaseModel):
    alert: str
    side: str
    position_state: str
    time_ist: str


class NoCodeDebugSnapshot(BaseModel):
    last_completed_candle_ist: str | None
    last_close: float | None
    indicator_values: dict[str, float | str | None]
    dataframe_rows: list[dict[str, str | float | int | None]]


class NoCodeExecutionState(BaseModel):
    enabled: bool
    instrument_ref_id: int | None
    instrument_tick_size: int | None
    instrument_lot_size: int | None
    desired_side: str | None
    position_side: str | None
    position_qty: int
    pending_order_id: int | None
    pending_order_side: str | None
    pending_order_action: str | None
    pending_followup_signal: str | None
    last_order_status: str | None
    last_execution_status: str | None
    last_order_update: dict[str, object] | None
    last_positions_sync_ist: str | None


class NoCodeStatusResponse(BaseModel):
    running: bool
    instrument: str | None
    interval: Interval | None
    indicator: IndicatorType | None
    strategy_side_mode: StrategySideMode | None
    last_run_ist: str | None
    next_run_ist: str | None
    market_status: str
    last_signal: str | None
    last_error: str | None
    alerts: list[NoCodeAlert]
    tracker_rows: list[NoCodeTrackerRow]
    debug: NoCodeDebugSnapshot | None
    execution: NoCodeExecutionState | None


class NoCodeStartResponse(BaseModel):
    status: str
    message: str
    job: NoCodeStatusResponse


class NoCodeStopResponse(BaseModel):
    status: str
    message: str
