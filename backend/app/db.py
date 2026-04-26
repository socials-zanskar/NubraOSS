from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from app.config import get_sqlite_db_path


@dataclass(frozen=True, slots=True)
class SyncRunResult:
    status: str
    started_at: datetime
    finished_at: datetime
    entity: str
    row_count: int
    details: dict[str, Any]


SCHEMA_SQL = """
create table if not exists instruments (
    symbol text not null,
    display_name text not null,
    exchange text not null,
    ref_id integer not null,
    tick_size integer not null,
    lot_size integer not null,
    instrument_type text not null,
    is_active integer not null default 1,
    source text not null,
    raw_json text not null default '{}',
    created_at text not null,
    updated_at text not null,
    primary key (symbol, exchange)
);

create table if not exists dashboard_universes (
    slug text primary key,
    title text not null,
    description text,
    created_at text not null,
    updated_at text not null
);

create table if not exists dashboard_universe_members (
    universe_slug text not null,
    symbol text not null,
    exchange text not null,
    sector text,
    industry text,
    sort_order integer not null default 0,
    is_active integer not null default 1,
    created_at text not null,
    updated_at text not null,
    primary key (universe_slug, symbol, exchange)
);

create index if not exists idx_dashboard_universe_members_universe_sort
    on dashboard_universe_members(universe_slug, sort_order asc, symbol asc);

create table if not exists stock_taxonomy (
    symbol text not null,
    exchange text not null,
    sector text,
    industry text,
    notes_json text not null default '{}',
    created_at text not null,
    updated_at text not null,
    primary key (symbol, exchange)
);

create table if not exists stock_liquidity_ranks (
    as_of_date text not null,
    symbol text not null,
    exchange text not null,
    rank integer not null,
    liquidity_score real not null,
    avg_traded_value_20d real not null,
    median_traded_value_20d real not null,
    avg_volume_20d real not null,
    active_days integer not null,
    last_close real,
    source text not null,
    created_at text not null,
    updated_at text not null,
    primary key (as_of_date, symbol, exchange)
);

create index if not exists idx_stock_liquidity_ranks_date_rank
    on stock_liquidity_ranks(as_of_date desc, exchange, rank asc);

create table if not exists ohlcv_1m_bars (
    symbol text not null,
    exchange text not null,
    bucket_timestamp text not null,
    open_price real not null,
    high_price real not null,
    low_price real not null,
    close_price real not null,
    bucket_volume real,
    cumulative_volume real,
    source text not null,
    raw_json text not null default '{}',
    created_at text not null,
    updated_at text not null,
    primary key (symbol, exchange, bucket_timestamp)
);

create index if not exists idx_ohlcv_1m_bars_symbol_ts
    on ohlcv_1m_bars(symbol, exchange, bucket_timestamp desc);

create table if not exists sync_runs (
    id integer primary key autoincrement,
    started_at text not null,
    finished_at text not null,
    status text not null,
    entity text not null,
    row_count integer not null,
    details_json text not null
);

create table if not exists volume_dashboard_snapshots (
    universe_slug text not null,
    interval text not null,
    lookback_days integer not null,
    min_volume_ratio real not null,
    created_at text not null,
    payload_json text not null,
    primary key (universe_slug, interval, lookback_days, min_volume_ratio)
);

create index if not exists idx_volume_dashboard_snapshots_created
    on volume_dashboard_snapshots(created_at desc);
"""


def connect_db() -> sqlite3.Connection:
    db_path = get_sqlite_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    initialize_schema(connection)
    return connection


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(SCHEMA_SQL)
    connection.commit()


def apply_schema(connection: sqlite3.Connection, schema_path: Path) -> None:
    schema_sql = schema_path.read_text(encoding="utf-8")
    connection.executescript(schema_sql)
    connection.commit()


def _fetch_all_dicts(cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
    rows = cursor.fetchall()
    return [dict(row) for row in rows]


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _serialize_json(value: Any) -> str:
    return json.dumps(value if value is not None else {})


def upsert_instruments(connection: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    now = _utc_now_iso()
    prepared = []
    for row in payload:
        prepared.append(
            {
                **row,
                "raw_json": row.get("raw_json") if isinstance(row.get("raw_json"), str) else _serialize_json(row.get("raw_json")),
                "created_at": now,
                "updated_at": now,
            }
        )
    connection.executemany(
        """
        insert into instruments (
            symbol, display_name, exchange, ref_id, tick_size, lot_size, instrument_type,
            is_active, source, raw_json, created_at, updated_at
        )
        values (
            :symbol, :display_name, :exchange, :ref_id, :tick_size, :lot_size, :instrument_type,
            :is_active, :source, :raw_json, :created_at, :updated_at
        )
        on conflict(symbol, exchange) do update set
            display_name = excluded.display_name,
            ref_id = excluded.ref_id,
            tick_size = excluded.tick_size,
            lot_size = excluded.lot_size,
            instrument_type = excluded.instrument_type,
            is_active = excluded.is_active,
            source = excluded.source,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        """,
        prepared,
    )
    connection.commit()
    return len(prepared)


def upsert_dashboard_universe(connection: sqlite3.Connection, *, slug: str, title: str, description: str | None = None) -> None:
    now = _utc_now_iso()
    connection.execute(
        """
        insert into dashboard_universes (slug, title, description, created_at, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(slug) do update set
            title = excluded.title,
            description = excluded.description,
            updated_at = excluded.updated_at
        """,
        (slug, title, description, now, now),
    )
    connection.commit()


def upsert_dashboard_universe_members(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    rows: Iterable[dict[str, Any]],
) -> int:
    payload = list(rows)
    if not payload:
        return 0
    now = _utc_now_iso()
    prepared = [{**row, "created_at": now, "updated_at": now} for row in payload]
    connection.executemany(
        """
        insert into dashboard_universe_members (
            universe_slug, symbol, exchange, sector, industry, sort_order, is_active, created_at, updated_at
        )
        values (
            :universe_slug, :symbol, :exchange, :sector, :industry, :sort_order, :is_active, :created_at, :updated_at
        )
        on conflict(universe_slug, symbol, exchange) do update set
            sector = excluded.sector,
            industry = excluded.industry,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at
        """,
        prepared,
    )
    connection.commit()
    return len(prepared)


def replace_dashboard_universe_members(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    rows: Iterable[dict[str, Any]],
) -> int:
    connection.execute(
        """
        delete from dashboard_universe_members
        where universe_slug = ?
        """,
        (universe_slug,),
    )
    connection.commit()
    return upsert_dashboard_universe_members(connection, universe_slug=universe_slug, rows=rows)


def upsert_stock_taxonomy(connection: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    now = _utc_now_iso()
    prepared = []
    for row in payload:
        prepared.append(
            {
                **row,
                "notes_json": row.get("notes_json") if isinstance(row.get("notes_json"), str) else _serialize_json(row.get("notes_json")),
                "created_at": now,
                "updated_at": now,
            }
        )
    connection.executemany(
        """
        insert into stock_taxonomy (
            symbol, exchange, sector, industry, notes_json, created_at, updated_at
        )
        values (
            :symbol, :exchange, :sector, :industry, :notes_json, :created_at, :updated_at
        )
        on conflict(symbol, exchange) do update set
            sector = excluded.sector,
            industry = excluded.industry,
            notes_json = excluded.notes_json,
            updated_at = excluded.updated_at
        """,
        prepared,
    )
    connection.commit()
    return len(prepared)


def upsert_stock_liquidity_ranks(connection: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    now = _utc_now_iso()
    prepared = [{**row, "created_at": now, "updated_at": now} for row in payload]
    connection.executemany(
        """
        insert into stock_liquidity_ranks (
            as_of_date, symbol, exchange, rank, liquidity_score,
            avg_traded_value_20d, median_traded_value_20d, avg_volume_20d,
            active_days, last_close, source, created_at, updated_at
        )
        values (
            :as_of_date, :symbol, :exchange, :rank, :liquidity_score,
            :avg_traded_value_20d, :median_traded_value_20d, :avg_volume_20d,
            :active_days, :last_close, :source, :created_at, :updated_at
        )
        on conflict(as_of_date, symbol, exchange) do update set
            rank = excluded.rank,
            liquidity_score = excluded.liquidity_score,
            avg_traded_value_20d = excluded.avg_traded_value_20d,
            median_traded_value_20d = excluded.median_traded_value_20d,
            avg_volume_20d = excluded.avg_volume_20d,
            active_days = excluded.active_days,
            last_close = excluded.last_close,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        prepared,
    )
    connection.commit()
    return len(prepared)


def load_stock_liquidity_ranks(
    connection: sqlite3.Connection,
    *,
    exchange: str,
    as_of_date: str,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    latest_cursor = connection.execute(
        """
        select max(as_of_date) as latest_date
        from stock_liquidity_ranks
        where exchange = ?
          and as_of_date <= ?
        """,
        (exchange, as_of_date),
    )
    latest_date = latest_cursor.fetchone()["latest_date"]
    if not latest_date:
        return []

    sql = """
        select
            as_of_date,
            symbol,
            exchange,
            rank,
            liquidity_score,
            avg_traded_value_20d,
            median_traded_value_20d,
            avg_volume_20d,
            active_days,
            last_close,
            source
        from stock_liquidity_ranks
        where exchange = ?
          and as_of_date = ?
        order by rank asc
    """
    params: tuple[Any, ...]
    if limit is not None:
        sql += " limit ?"
        params = (exchange, latest_date, limit)
    else:
        params = (exchange, latest_date)
    cursor = connection.execute(sql, params)
    return _fetch_all_dicts(cursor)


def load_existing_instruments(
    connection: sqlite3.Connection,
    *,
    exchanges: Iterable[str] | None = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    chosen_exchanges = tuple(dict.fromkeys(exchange.strip().upper() for exchange in (exchanges or ()) if exchange))
    if chosen_exchanges:
        placeholders = ",".join("?" for _ in chosen_exchanges)
        cursor = connection.execute(
            f"""
            select symbol, display_name, exchange, ref_id, tick_size, lot_size, instrument_type, is_active
            from instruments
            where exchange in ({placeholders})
            """,
            chosen_exchanges,
        )
    else:
        cursor = connection.execute(
            """
            select symbol, display_name, exchange, ref_id, tick_size, lot_size, instrument_type, is_active
            from instruments
            """
        )
    rows = _fetch_all_dicts(cursor)
    return {(row["symbol"], row["exchange"]): dict(row) for row in rows}


def upsert_ohlcv_1m_bars(connection: sqlite3.Connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    now = _utc_now_iso()
    prepared = []
    for row in payload:
        bucket_timestamp = row["bucket_timestamp"]
        if isinstance(bucket_timestamp, datetime):
            bucket_timestamp = _ensure_utc(bucket_timestamp).isoformat()
        prepared.append(
            {
                **row,
                "bucket_timestamp": bucket_timestamp,
                "raw_json": row.get("raw_json") if isinstance(row.get("raw_json"), str) else _serialize_json(row.get("raw_json")),
                "created_at": now,
                "updated_at": now,
            }
        )
    connection.executemany(
        """
        insert into ohlcv_1m_bars (
            symbol, exchange, bucket_timestamp, open_price, high_price, low_price, close_price,
            bucket_volume, cumulative_volume, source, raw_json, created_at, updated_at
        )
        values (
            :symbol, :exchange, :bucket_timestamp, :open_price, :high_price, :low_price, :close_price,
            :bucket_volume, :cumulative_volume, :source, :raw_json, :created_at, :updated_at
        )
        on conflict(symbol, exchange, bucket_timestamp) do update set
            open_price = excluded.open_price,
            high_price = excluded.high_price,
            low_price = excluded.low_price,
            close_price = excluded.close_price,
            bucket_volume = excluded.bucket_volume,
            cumulative_volume = excluded.cumulative_volume,
            source = excluded.source,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        """,
        prepared,
    )
    connection.commit()
    return len(prepared)


def load_dashboard_universe_members(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
) -> list[dict[str, Any]]:
    cursor = connection.execute(
        """
        select
            members.universe_slug,
            members.symbol,
            members.exchange,
            members.sector,
            members.industry,
            members.sort_order,
            members.is_active,
            instruments.display_name
        from dashboard_universe_members as members
        join instruments
          on instruments.symbol = members.symbol
         and instruments.exchange = members.exchange
        where members.universe_slug = ?
          and members.is_active = 1
          and instruments.is_active = 1
        order by members.sort_order asc, members.symbol asc
        """,
        (universe_slug,),
    )
    return _fetch_all_dicts(cursor)


def load_ohlcv_1m_bars(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    since_timestamp: datetime,
    symbols: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    symbol_values = [str(symbol).strip().upper() for symbol in symbols or [] if str(symbol).strip()]
    symbol_filter = ""
    params: list[Any] = [universe_slug, _ensure_utc(since_timestamp).isoformat()]
    if symbol_values:
        placeholders = ",".join("?" for _ in symbol_values)
        symbol_filter = f" and bars.symbol in ({placeholders})"
        params.extend(symbol_values)
    cursor = connection.execute(
        f"""
        select
            bars.symbol,
            bars.exchange,
            bars.bucket_timestamp,
            bars.open_price,
            bars.high_price,
            bars.low_price,
            bars.close_price,
            bars.bucket_volume,
            bars.cumulative_volume
        from ohlcv_1m_bars as bars
        join dashboard_universe_members as members
          on members.symbol = bars.symbol
         and members.exchange = bars.exchange
        where members.universe_slug = ?
          and members.is_active = 1
          and bars.bucket_timestamp >= ?
          {symbol_filter}
        order by bars.symbol asc, bars.bucket_timestamp asc
        """,
        params,
    )
    return _fetch_all_dicts(cursor)


def load_latest_ohlcv_1m_bars(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
) -> dict[tuple[str, str], datetime]:
    cursor = connection.execute(
        """
        select
            bars.symbol,
            bars.exchange,
            max(bars.bucket_timestamp) as latest_bucket_timestamp
        from ohlcv_1m_bars as bars
        join dashboard_universe_members as members
          on members.symbol = bars.symbol
         and members.exchange = bars.exchange
        where members.universe_slug = ?
          and members.is_active = 1
        group by bars.symbol, bars.exchange
        """,
        (universe_slug,),
    )
    rows = _fetch_all_dicts(cursor)
    latest: dict[tuple[str, str], datetime] = {}
    for row in rows:
        timestamp = row.get("latest_bucket_timestamp")
        if isinstance(timestamp, str) and timestamp:
            latest[(str(row["symbol"]), str(row["exchange"]))] = datetime.fromisoformat(timestamp).astimezone(UTC)
    return latest


def load_ohlcv_1m_bars_delta(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    symbol_since: dict[tuple[str, str], datetime],
) -> list[dict[str, Any]]:
    """Load only new bars for each symbol since its last known timestamp (delta loading)."""
    if not symbol_since:
        return []

    deltas: list[dict[str, Any]] = []
    for (symbol, exchange), since_ts in symbol_since.items():
        cursor = connection.execute(
            """
            select
                bars.symbol,
                bars.exchange,
                bars.bucket_timestamp,
                bars.open_price,
                bars.high_price,
                bars.low_price,
                bars.close_price,
                bars.bucket_volume,
                bars.cumulative_volume
            from ohlcv_1m_bars as bars
            join dashboard_universe_members as members
              on members.symbol = bars.symbol
             and members.exchange = bars.exchange
            where members.universe_slug = ?
              and members.is_active = 1
              and bars.symbol = ?
              and bars.exchange = ?
              and bars.bucket_timestamp > ?
            order by bars.bucket_timestamp asc
            """,
            (universe_slug, symbol, exchange, _ensure_utc(since_ts).isoformat()),
        )
        deltas.extend(_fetch_all_dicts(cursor))
    return deltas


def record_sync_run(connection: sqlite3.Connection, result: SyncRunResult) -> None:
    connection.execute(
        """
        insert into sync_runs (started_at, finished_at, status, entity, row_count, details_json)
        values (?, ?, ?, ?, ?, ?)
        """,
        (
            _ensure_utc(result.started_at).isoformat(),
            _ensure_utc(result.finished_at).isoformat(),
            result.status,
            result.entity,
            result.row_count,
            _serialize_json(result.details),
        ),
    )
    connection.commit()


def save_volume_dashboard_snapshot(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    interval: str,
    lookback_days: int,
    min_volume_ratio: float,
    payload: dict[str, Any],
) -> None:
    now = _utc_now_iso()
    connection.execute(
        """
        insert into volume_dashboard_snapshots (
            universe_slug, interval, lookback_days, min_volume_ratio, created_at, payload_json
        )
        values (?, ?, ?, ?, ?, ?)
        on conflict(universe_slug, interval, lookback_days, min_volume_ratio) do update set
            created_at = excluded.created_at,
            payload_json = excluded.payload_json
        """,
        (
            universe_slug,
            interval,
            lookback_days,
            min_volume_ratio,
            now,
            _serialize_json(payload),
        ),
    )
    connection.commit()


def load_volume_dashboard_snapshot(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    interval: str,
    lookback_days: int,
    min_volume_ratio: float,
) -> dict[str, Any] | None:
    cursor = connection.execute(
        """
        select payload_json
        from volume_dashboard_snapshots
        where universe_slug = ?
          and interval = ?
          and lookback_days = ?
          and min_volume_ratio = ?
        order by created_at desc
        limit 1
        """,
        (universe_slug, interval, lookback_days, min_volume_ratio),
    )
    row = cursor.fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload_json"])
    except (TypeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def prune_ohlcv_1m_bars(
    connection: sqlite3.Connection,
    *,
    universe_slug: str,
    keep_since: datetime,
) -> int:
    cursor = connection.execute(
        """
        delete from ohlcv_1m_bars
        where (symbol, exchange) in (
            select symbol, exchange from dashboard_universe_members
            where universe_slug = ? and is_active = 1
        )
        and bucket_timestamp < ?
        """,
        (universe_slug, _ensure_utc(keep_since).isoformat()),
    )
    connection.commit()
    return cursor.rowcount
