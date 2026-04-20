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


Interval = Literal["1m", "2m", "3m", "5m", "15m", "30m", "1h", "1d", "1w", "1mt"]
OrderDeliveryType = Literal["ORDER_DELIVERY_TYPE_CNC", "ORDER_DELIVERY_TYPE_IDAY"]


class ScalperSnapshotRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    underlying: str = Field(min_length=2, max_length=64)
    exchange: Literal["NSE", "BSE"] = "NSE"
    interval: Interval = "1m"
    strike_price: int = Field(ge=1, le=1000000)
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
    strike_price: int
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


class StrategyBacktestRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    strategy: dict[str, Any]


# ---- New backtest output types (mirrors nubra_backtester output schema) ----


class StrategyEquityPoint(BaseModel):
    timestamp: str
    equity: float


class StrategyTrade(BaseModel):
    symbol: str
    side: Literal["BUY", "SELL"]
    entry_timestamp: str
    exit_timestamp: str
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    pnl_pct: float
    bars_held: int
    exit_reason: str
    brokerage: float


class StrategyDailySignalLogRow(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    entry_signal: bool
    exit_signal: bool
    action: str
    position_state: str
    stop_loss_price: float | None
    target_price: float | None


class StrategyInstrumentMetrics(BaseModel):
    starting_capital: float
    ending_capital: float
    gross_profit: float
    gross_loss: float
    net_pnl: float
    return_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    avg_pnl: float
    avg_pnl_pct: float
    profit_factor: float | None
    max_drawdown_pct: float
    total_brokerage: float


class StrategyInstrumentResult(BaseModel):
    symbol: str
    bars_processed: int
    metrics: StrategyInstrumentMetrics
    trades: list[StrategyTrade]
    equity_curve: list[StrategyEquityPoint]
    triggered_days: list[StrategyDailySignalLogRow]
    daily_signal_log: list[StrategyDailySignalLogRow]
    warning: str | None = None


class StrategyPortfolioMetrics(BaseModel):
    starting_capital: float
    ending_capital: float
    gross_profit: float
    gross_loss: float
    net_pnl: float
    return_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    profit_factor: float | None
    max_drawdown_pct: float
    capital_per_instrument: float
    total_brokerage: float
    equity_curve: list[StrategyEquityPoint]


class StrategyBacktestResponse(BaseModel):
    status: Literal["success"]
    mode: str
    strategy_summary: dict[str, Any]
    portfolio: StrategyPortfolioMetrics
    instruments: list[StrategyInstrumentResult]


class StrategyLiveStartRequest(BaseModel):
    session_token: str = Field(min_length=10)
    device_id: str = Field(min_length=3, max_length=128)
    environment: Environment
    strategy: dict[str, Any]


class StrategyLiveAlert(BaseModel):
    id: str
    instrument: str
    event: str
    candle_time_ist: str
    triggered_at_ist: str
    price: float
    detail: str


class StrategyLiveStatusResponse(BaseModel):
    running: bool
    instruments: list[str]
    interval: Interval | None
    entry_side: Literal["BUY", "SELL"] | None
    market_status: str
    last_run_ist: str | None
    next_run_ist: str | None
    last_signal: str | None
    last_error: str | None
    alerts: list[StrategyLiveAlert]


class StrategyLiveStartResponse(BaseModel):
    status: Literal["success"]
    message: str
    job: StrategyLiveStatusResponse


class StrategyLiveStopResponse(BaseModel):
    status: Literal["success"]
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
