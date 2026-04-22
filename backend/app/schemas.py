from typing import Any, Literal

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


class TunnelStatusResponse(BaseModel):
    running: bool
    public_url: str | None
    target_url: str
    last_error: str | None
    logs: list[str]


class TradingViewWebhookLogEntry(BaseModel):
    time_ist: str
    level: Literal["info", "success", "error"]
    message: str
    payload: dict[str, Any] | None = None


class TradingViewWebhookHistoryEntry(BaseModel):
    id: str
    time_ist: str
    day_ist: str
    source: Literal["test", "live"]
    status: Literal["received", "accepted", "blocked", "error"]
    strategy: str | None
    tag: str | None
    instrument: str | None
    exchange: str | None
    action: str | None
    quantity: int | None
    order_id: int | None
    order_status: str | None
    pnl: float | None
    requested_qty: int | None
    placed_qty: int | None
    filled_qty: int | None
    avg_filled_price: float | None
    order_price: float | None
    ltp_price: float | None
    ref_id: int | None
    lot_size: int | None
    tick_size: int | None
    message: str
    payload: dict[str, Any] | None = None


class TradingViewWebhookSummary(BaseModel):
    total_events: int
    live_events: int
    test_events: int
    blocked_events: int
    error_events: int
    accepted_events: int
    today_pnl: float
    today_orders: int


class TradingViewWebhookOrderRow(BaseModel):
    time_ist: str
    source: Literal["test", "live"]
    strategy: str | None
    tag: str | None
    instrument: str | None
    exchange: str | None
    action: str | None
    requested_qty: int | None
    placed_qty: int | None
    filled_qty: int | None
    order_price: float | None
    avg_filled_price: float | None
    current_price: float | None
    order_id: int | None
    order_status: str | None
    pnl: float | None


class TradingViewWebhookPositionRow(BaseModel):
    strategy: str | None
    tag: str | None
    instrument: str
    exchange: str
    net_qty: int
    avg_entry_price: float | None
    current_price: float | None
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float
    direction: Literal["LONG", "SHORT", "FLAT"]


class TradingViewWebhookPnlSummary(BaseModel):
    realized_pnl: float
    unrealized_pnl: float
    total_pnl: float
    open_positions: int
    closed_groups: int


class TradingViewWebhookConfigureRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    user_name: str = Field(min_length=1, max_length=128)
    account_id: str = Field(min_length=1, max_length=128)
    secret: str | None = Field(default=None, min_length=6, max_length=128)
    order_delivery_type: Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"] = "ORDER_DELIVERY_TYPE_IDAY"


class TradingViewWebhookStatusResponse(BaseModel):
    configured: bool
    environment: Environment | None
    broker: Literal["Nubra"] | None
    user_name: str | None
    account_id: str | None
    configured_at_utc: str | None
    order_delivery_type: Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"] | None
    secret: str | None
    has_secret: bool
    webhook_path: str
    webhook_url: str | None
    strategy_template: dict[str, Any]
    line_alert_template: dict[str, Any]
    execution_enabled: bool
    last_error: str | None
    logs: list[TradingViewWebhookLogEntry]
    history: list[TradingViewWebhookHistoryEntry]
    summary: TradingViewWebhookSummary
    order_history: list[TradingViewWebhookOrderRow]
    positions: list[TradingViewWebhookPositionRow]
    pnl_summary: TradingViewWebhookPnlSummary


class TradingViewWebhookConfigureResponse(BaseModel):
    status: Literal["success"]
    message: str
    config: TradingViewWebhookStatusResponse


class TradingViewWebhookResetResponse(BaseModel):
    status: Literal["success"]
    message: str


class TradingViewWebhookExecutionModeRequest(BaseModel):
    execution_enabled: bool


class TradingViewWebhookExecutionModeResponse(BaseModel):
    status: Literal["success"]
    message: str
    execution_enabled: bool


class TradingViewWebhookExecuteResponse(BaseModel):
    status: Literal["accepted"]
    message: str
    order_id: int | None
    order_status: str | None
    symbol: str
    exchange: str
    action: str
    quantity: int


Interval = Literal["1m", "2m", "3m", "5m", "15m", "30m", "1h"]
IndicatorType = Literal["EMA", "MA", "RSI"]
OrderDeliveryType = Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"]
StrategySideMode = Literal["BOTH", "LONG_ONLY", "SHORT_ONLY"]


class ScalperSnapshotRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    underlying: str = Field(min_length=2, max_length=64)
    exchange: Literal["NSE", "BSE"] = "NSE"
    interval: Interval = "1m"
    ce_strike_price: int = Field(ge=1, le=1000000)
    pe_strike_price: int = Field(ge=1, le=1000000)
    expiry: str | None = Field(default=None, max_length=64)
    lookback_days: int = Field(default=5, ge=1, le=15)


class ScalperCandle(BaseModel):
    time_ist: str
    epoch_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None


class ScalperChartPanel(BaseModel):
    instrument: str
    display_name: str
    exchange: str
    instrument_type: str
    interval: Interval
    last_price: float | None
    candles: list[ScalperCandle]


class ScalperResolvedOptionPair(BaseModel):
    underlying: str
    exchange: str
    expiry: str | None
    ce_strike_price: int
    pe_strike_price: int
    call_ref_id: int | None
    put_ref_id: int | None
    call_display_name: str
    put_display_name: str
    lot_size: int | None
    tick_size: int | None


class ScalperSnapshotResponse(BaseModel):
    status: Literal["success"]
    message: str
    underlying: ScalperChartPanel
    call_option: ScalperChartPanel
    put_option: ScalperChartPanel
    option_pair: ScalperResolvedOptionPair


class ScalperOrderRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    instrument_ref_id: int = Field(ge=1)
    instrument_display_name: str = Field(min_length=1, max_length=128)
    option_leg: Literal["CE", "PE"]
    order_side: Literal["ORDER_SIDE_BUY", "ORDER_SIDE_SELL"]
    lots: int = Field(default=1, ge=1, le=1000)
    lot_size: int = Field(ge=1, le=1000000)
    tick_size: int = Field(ge=1, le=1000000)
    ltp_price: float | None = Field(default=None, ge=0)
    order_delivery_type: Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"] = "ORDER_DELIVERY_TYPE_IDAY"
    exchange: Literal["NSE", "BSE"] = "NSE"
    tag: str | None = Field(default=None, max_length=128)


class ScalperOrderResponse(BaseModel):
    status: Literal["success"]
    message: str
    order_id: int | None
    order_status: str | None
    order_side: Literal["ORDER_SIDE_BUY", "ORDER_SIDE_SELL"]
    order_qty: int
    order_price: float | None
    lots: int
    instrument_display_name: str


class DeltaNeutralPairRow(BaseModel):
    rank: int
    underlying: str
    exchange: str
    expiry: str | None
    ce_strike_price: int
    pe_strike_price: int
    call_display_name: str
    put_display_name: str
    spot_price: float | None
    center_strike: int
    width_points: int
    call_delta: float | None
    put_delta: float | None
    net_delta: float | None
    neutrality_score: float
    lot_size: int | None
    tick_size: int | None


class DeltaNeutralPairsRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    underlying: str = Field(min_length=2, max_length=64)
    exchange: Literal["NSE", "BSE"] = "NSE"
    expiry: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=5, ge=1, le=10)


class DeltaNeutralPairsResponse(BaseModel):
    status: Literal["success"]
    message: str
    pairs: list[DeltaNeutralPairRow]


class ExpiryHeatmapRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    underlying: str = Field(min_length=2, max_length=64)
    exchange: Literal["NSE", "BSE"] = "NSE"
    interval: Interval = "1m"
    expiry: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=9, ge=3, le=15)


class ExpiryHeatmapRow(BaseModel):
    strike_price: int
    expiry: str | None
    distance_from_spot: int
    call_display_name: str | None
    put_display_name: str | None
    call_last_price: float | None
    put_last_price: float | None
    call_volume: float | None
    put_volume: float | None
    call_change_pct: float | None
    put_change_pct: float | None
    call_heat: float
    put_heat: float


class ExpiryHeatmapResponse(BaseModel):
    status: Literal["success"]
    message: str
    underlying: str
    exchange: str
    expiry: str | None
    interval: Interval
    spot_price: float | None
    center_strike: int | None
    rows: list[ExpiryHeatmapRow]


class ScalperVolumeBreakoutRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    exchange: Literal["NSE", "BSE"] = "NSE"
    interval: Interval = "1m"
    lookback_days: int = Field(default=5, ge=3, le=20)
    limit: int = Field(default=30, ge=1, le=200)


class ScalperVolumeBreakoutRow(BaseModel):
    rank: int
    underlying: str
    display_name: str
    exchange: str
    last_price: float | None
    current_volume: float | None
    average_volume: float | None
    volume_ratio: float
    price_change_pct: float | None
    breakout_strength: float
    status_label: str
    nearest_expiry: str | None
    atm_strike: int | None


class ScalperVolumeBreakoutResponse(BaseModel):
    status: Literal["success"]
    message: str
    lookback_days: int
    rows: list[ScalperVolumeBreakoutRow]


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
