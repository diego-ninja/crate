#!/usr/bin/env python3
"""Read-only PostgreSQL performance snapshot for Crate.

The script intentionally reports facts instead of applying tuning. Use it before
changing container memory, shared buffers, work_mem, or query/index strategy.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


SETTING_NAMES = (
    "max_connections",
    "shared_buffers",
    "effective_cache_size",
    "work_mem",
    "maintenance_work_mem",
    "random_page_cost",
    "effective_io_concurrency",
    "checkpoint_timeout",
    "max_wal_size",
    "shared_preload_libraries",
    "pg_stat_statements.track",
)


def _env(name: str, default: str) -> str:
    return os.environ.get(name) or default


def _dsn_from_env() -> str:
    return (
        f"dbname={_env('CRATE_POSTGRES_DB', 'crate')} "
        f"user={_env('CRATE_POSTGRES_USER', 'crate')} "
        f"password={_env('CRATE_POSTGRES_PASSWORD', 'crate')} "
        f"host={_env('CRATE_POSTGRES_HOST', 'localhost')} "
        f"port={_env('CRATE_POSTGRES_PORT', '5432')}"
    )


def _fetch_all(cursor, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor.execute(query, params)
    return [dict(row) for row in cursor.fetchall()]


def _fetch_one(cursor, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    cursor.execute(query, params)
    row = cursor.fetchone()
    return dict(row) if row else None


def collect_snapshot(dsn: str, *, limit: int, statement_timeout_ms: int) -> dict[str, Any]:
    with psycopg2.connect(dsn, cursor_factory=RealDictCursor) as conn:
        conn.autocommit = True
        with conn.cursor() as cursor:
            cursor.execute("SET statement_timeout = %s", (statement_timeout_ms,))
            database = _fetch_one(cursor, "SELECT current_database() AS name, version() AS version") or {}
            settings = _fetch_all(
                cursor,
                """
                SELECT name, setting, unit, boot_val, reset_val, source
                FROM pg_settings
                WHERE name = ANY(%s)
                ORDER BY name
                """,
                (list(SETTING_NAMES),),
            )
            database_stats = _fetch_one(
                cursor,
                """
                SELECT
                    datname,
                    numbackends,
                    xact_commit,
                    xact_rollback,
                    blks_read,
                    blks_hit,
                    ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
                    tup_returned,
                    tup_fetched,
                    tup_inserted,
                    tup_updated,
                    tup_deleted,
                    temp_files,
                    temp_bytes,
                    deadlocks
                FROM pg_stat_database
                WHERE datname = current_database()
                """,
            )
            activity = _fetch_all(
                cursor,
                """
                SELECT state, wait_event_type, COUNT(*)::INTEGER AS count
                FROM pg_stat_activity
                WHERE datname = current_database()
                GROUP BY state, wait_event_type
                ORDER BY count DESC, state NULLS LAST
                """,
            )
            relation_sizes = _fetch_all(
                cursor,
                """
                SELECT
                    n.nspname AS schema,
                    c.relname AS relation,
                    pg_total_relation_size(c.oid)::BIGINT AS total_bytes,
                    pg_relation_size(c.oid)::BIGINT AS table_bytes,
                    pg_indexes_size(c.oid)::BIGINT AS index_bytes
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'm')
                  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY pg_total_relation_size(c.oid) DESC
                LIMIT %s
                """,
                (limit,),
            )

            top_statements: list[dict[str, Any]] = []
            pg_stat_error: str | None = None
            extension = _fetch_one(
                cursor,
                "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS enabled",
            )
            if extension and extension.get("enabled"):
                try:
                    top_statements = _fetch_all(
                        cursor,
                        """
                        SELECT
                            calls,
                            ROUND(total_exec_time::numeric, 2) AS total_exec_ms,
                            ROUND(mean_exec_time::numeric, 2) AS mean_exec_ms,
                            rows,
                            shared_blks_hit,
                            shared_blks_read,
                            temp_blks_read,
                            temp_blks_written,
                            LEFT(regexp_replace(query, '\\s+', ' ', 'g'), 500) AS query
                        FROM pg_stat_statements
                        ORDER BY total_exec_time DESC
                        LIMIT %s
                        """,
                        (limit,),
                    )
                except Exception as exc:  # pragma: no cover - depends on PG permissions/version
                    pg_stat_error = str(exc)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database": database,
        "settings": settings,
        "database_stats": database_stats,
        "activity": activity,
        "relation_sizes": relation_sizes,
        "pg_stat_statements": {
            "enabled": bool(extension and extension.get("enabled")),
            "error": pg_stat_error,
            "top": top_statements,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=_dsn_from_env(), help="PostgreSQL DSN. Defaults to CRATE_POSTGRES_* env vars.")
    parser.add_argument("--limit", type=int, default=15, help="Rows per ranked section.")
    parser.add_argument("--statement-timeout-ms", type=int, default=5000)
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args()

    snapshot = collect_snapshot(
        args.dsn,
        limit=max(1, args.limit),
        statement_timeout_ms=max(1000, args.statement_timeout_ms),
    )
    print(json.dumps(snapshot, indent=2 if args.pretty else None, sort_keys=True, default=str))


if __name__ == "__main__":
    main()
