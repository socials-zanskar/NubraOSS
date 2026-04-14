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
    device_id: str
    environment: Environment
    broker: Literal["Nubra"]
    expires_in: int
    message: str


class SessionStatusRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment


class SessionStatusResponse(BaseModel):
    active: bool
    environment: Environment
    expires_at_utc: str | None
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


class VolumeBreakoutStartRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    universe_slug: str = Field(default="volume-breakout-v1", min_length=3, max_length=128)
    interval: Interval = "5m"
    lookback_days: int = Field(default=10, ge=3, le=60)
    refresh_seconds: int = Field(default=30, ge=15, le=300)
    min_volume_ratio: float = Field(default=1.5, ge=1.0, le=20.0)
    limit: int = Field(default=20, ge=5, le=50)


class VolumeBreakoutStockRow(BaseModel):
    symbol: str
    display_name: str
    exchange: str
    candle_time_ist: str
    last_price: float
    current_volume: float
    average_volume: float
    volume_ratio: float
    price_change_pct: float | None
    price_breakout_pct: float | None
    is_green: bool
    is_price_breakout: bool
    meets_breakout: bool


class VolumeBreakoutSummary(BaseModel):
    tracked_stocks: int
    active_breakouts: int
    leaders_with_price_breakout: int
    latest_candle_ist: str | None
    market_status: str


class VolumeBreakoutStatusResponse(BaseModel):
    running: bool
    universe_slug: str
    interval: Interval
    lookback_days: int
    refresh_seconds: int
    min_volume_ratio: float
    universe_size: int
    live_mode: bool
    live_status: str
    live_last_event_ist: str | None
    live_subscribed_symbols: int
    last_run_ist: str | None
    next_run_ist: str | None
    last_error: str | None
    summary: VolumeBreakoutSummary
    market_breakouts: list[VolumeBreakoutStockRow]
    recent_breakouts: list[VolumeBreakoutStockRow]


class VolumeBreakoutStartResponse(BaseModel):
    status: str
    message: str
    job: VolumeBreakoutStatusResponse


class VolumeBreakoutStopResponse(BaseModel):
    status: str
    message: str
