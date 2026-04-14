from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from app.config import get_supabase_dsn


@dataclass(frozen=True, slots=True)
class SyncRunResult:
    status: str
    started_at: datetime
    finished_at: datetime
    entity: str
    row_count: int
    details: dict[str, Any]


def _require_psycopg():
    try:
        import psycopg as psycopg_module
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "psycopg is not installed. Add it to backend requirements to enable Supabase/Postgres sync."
        ) from exc
    return psycopg_module


def connect_db():
    psycopg_module = _require_psycopg()
    dsn = get_supabase_dsn()
    if not dsn:
        raise ValueError(
            "Missing Supabase/Postgres connection details. Fill SUPABASE_DB_URL or host/password fields in backend/.env."
        )
    return psycopg_module.connect(dsn)


def _dict_row_factory():
    psycopg_module = _require_psycopg()
    return psycopg_module.rows.dict_row


def apply_schema(connection, schema_path: Path) -> None:
    schema_sql = schema_path.read_text(encoding="utf-8")
    with connection.cursor() as cursor:
        cursor.execute(schema_sql)
    connection.commit()


def upsert_instruments(connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            insert into instruments (
                symbol,
                display_name,
                exchange,
                ref_id,
                tick_size,
                lot_size,
                instrument_type,
                is_active,
                source,
                raw_json
            )
            values (
                %(symbol)s,
                %(display_name)s,
                %(exchange)s,
                %(ref_id)s,
                %(tick_size)s,
                %(lot_size)s,
                %(instrument_type)s,
                %(is_active)s,
                %(source)s,
                %(raw_json)s::jsonb
            )
            on conflict (symbol, exchange) do update set
                display_name = excluded.display_name,
                ref_id = excluded.ref_id,
                tick_size = excluded.tick_size,
                lot_size = excluded.lot_size,
                instrument_type = excluded.instrument_type,
                is_active = excluded.is_active,
                source = excluded.source,
                raw_json = excluded.raw_json,
                updated_at = timezone('utc', now())
            """,
            payload,
        )
    connection.commit()
    return len(payload)


def upsert_dashboard_universe(connection, *, slug: str, title: str, description: str | None = None) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into dashboard_universes (slug, title, description)
            values (%s, %s, %s)
            on conflict (slug) do update set
                title = excluded.title,
                description = excluded.description,
                updated_at = timezone('utc', now())
            """,
            (slug, title, description),
        )
    connection.commit()


def upsert_dashboard_universe_members(
    connection,
    *,
    universe_slug: str,
    rows: Iterable[dict[str, Any]],
) -> int:
    payload = list(rows)
    if not payload:
        return 0
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            insert into dashboard_universe_members (
                universe_slug,
                symbol,
                exchange,
                sector,
                industry,
                sort_order,
                is_active
            )
            values (
                %(universe_slug)s,
                %(symbol)s,
                %(exchange)s,
                %(sector)s,
                %(industry)s,
                %(sort_order)s,
                %(is_active)s
            )
            on conflict (universe_slug, symbol, exchange) do update set
                sector = excluded.sector,
                industry = excluded.industry,
                sort_order = excluded.sort_order,
                is_active = excluded.is_active,
                updated_at = timezone('utc', now())
            """,
            payload,
        )
    connection.commit()
    return len(payload)


def upsert_stock_taxonomy(connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            insert into stock_taxonomy (
                symbol,
                exchange,
                sector,
                industry,
                notes_json
            )
            values (
                %(symbol)s,
                %(exchange)s,
                %(sector)s,
                %(industry)s,
                %(notes_json)s::jsonb
            )
            on conflict (symbol, exchange) do update set
                sector = excluded.sector,
                industry = excluded.industry,
                notes_json = excluded.notes_json,
                updated_at = timezone('utc', now())
            """,
            payload,
        )
    connection.commit()
    return len(payload)


def load_existing_instruments(
    connection,
    *,
    exchanges: Iterable[str] | None = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    params: list[Any] = []
    where = ""
    chosen_exchanges = tuple(dict.fromkeys(exchange.strip().upper() for exchange in (exchanges or ()) if exchange))
    if chosen_exchanges:
        where = "where exchange = any(%s)"
        params.append(list(chosen_exchanges))
    with connection.cursor(row_factory=_dict_row_factory()) as cursor:
        cursor.execute(
            f"""
            select symbol, display_name, exchange, ref_id, tick_size, lot_size, instrument_type, is_active
            from instruments
            {where}
            """,
            tuple(params),
        )
        rows = cursor.fetchall()
    return {(row["symbol"], row["exchange"]): dict(row) for row in rows}


def upsert_ohlcv_1m_bars(connection, rows: Iterable[dict[str, Any]]) -> int:
    payload = list(rows)
    if not payload:
        return 0
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            insert into ohlcv_1m_bars (
                symbol,
                exchange,
                bucket_timestamp,
                open_price,
                high_price,
                low_price,
                close_price,
                bucket_volume,
                cumulative_volume,
                source,
                raw_json
            )
            values (
                %(symbol)s,
                %(exchange)s,
                %(bucket_timestamp)s,
                %(open_price)s,
                %(high_price)s,
                %(low_price)s,
                %(close_price)s,
                %(bucket_volume)s,
                %(cumulative_volume)s,
                %(source)s,
                %(raw_json)s::jsonb
            )
            on conflict (symbol, exchange, bucket_timestamp) do update set
                open_price = excluded.open_price,
                high_price = excluded.high_price,
                low_price = excluded.low_price,
                close_price = excluded.close_price,
                bucket_volume = excluded.bucket_volume,
                cumulative_volume = excluded.cumulative_volume,
                source = excluded.source,
                raw_json = excluded.raw_json,
                updated_at = timezone('utc', now())
            """,
            payload,
        )
    connection.commit()
    return len(payload)


def load_dashboard_universe_members(
    connection,
    *,
    universe_slug: str,
) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=_dict_row_factory()) as cursor:
        cursor.execute(
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
            where members.universe_slug = %s
              and members.is_active = true
              and instruments.is_active = true
            order by members.sort_order asc, members.symbol asc
            """,
            (universe_slug,),
        )
        rows = cursor.fetchall()
    return [dict(row) for row in rows]


def load_ohlcv_1m_bars(
    connection,
    *,
    universe_slug: str,
    since_timestamp: datetime,
) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=_dict_row_factory()) as cursor:
        cursor.execute(
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
            where members.universe_slug = %s
              and members.is_active = true
              and bars.bucket_timestamp >= %s
            order by bars.symbol asc, bars.bucket_timestamp asc
            """,
            (universe_slug, _ensure_utc(since_timestamp)),
        )
        rows = cursor.fetchall()
    return [dict(row) for row in rows]


def record_sync_run(connection, result: SyncRunResult) -> None:
    payload = (
        _ensure_utc(result.started_at),
        _ensure_utc(result.finished_at),
        result.status,
        result.entity,
        result.row_count,
        json.dumps(result.details),
    )
    with connection.cursor() as cursor:
        try:
            cursor.execute(
                """
                insert into sync_runs (
                    started_at,
                    finished_at,
                    status,
                    entity,
                    row_count,
                    details_json
                )
                values (%s, %s, %s, %s, %s, %s::jsonb)
                """,
                payload,
            )
        except Exception:
            connection.rollback()
            with connection.cursor() as fallback_cursor:
                fallback_cursor.execute(
                    """
                    insert into sync_runs (
                        started_at,
                        finished_at,
                        status,
                        symbol_source,
                        symbol_count,
                        details_json
                    )
                    values (%s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    payload,
                )
    connection.commit()


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
