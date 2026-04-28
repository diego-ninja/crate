from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def upsert_metric_rollup(
    *,
    name: str,
    tags_json: str,
    period: str,
    bucket_start: str,
    count: int,
    sum_value: float,
    min_value: float,
    max_value: float,
    avg_value: float,
):
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO metric_rollups (name, tags_json, period, bucket_start, count, sum_value, min_value, max_value, avg_value)
                VALUES (:name, CAST(:tags AS jsonb), :period, :bucket_start, :count, :sum, :min, :max, :avg)
                ON CONFLICT (name, tags_json, period, bucket_start)
                DO UPDATE SET
                    count = metric_rollups.count + EXCLUDED.count,
                    sum_value = metric_rollups.sum_value + EXCLUDED.sum_value,
                    min_value = LEAST(metric_rollups.min_value, EXCLUDED.min_value),
                    max_value = GREATEST(metric_rollups.max_value, EXCLUDED.max_value),
                    avg_value = (metric_rollups.sum_value + EXCLUDED.sum_value) / NULLIF(metric_rollups.count + EXCLUDED.count, 0)
                """
            ),
            {
                "name": name,
                "tags": tags_json,
                "period": period,
                "bucket_start": bucket_start,
                "count": count,
                "sum": sum_value,
                "min": min_value,
                "max": max_value,
                "avg": avg_value,
            },
        )
