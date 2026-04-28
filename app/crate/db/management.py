"""Legacy compatibility shim for management access.

New runtime code should import from ``crate.db.repositories.management`` for
writes and ``crate.db.queries.management`` for read-only queries. This module
remains only to keep the deprecated compat surface and older tests/scripts
working while the backend migration finishes.
"""

from crate.db.queries.management import (
    count_recent_active_users,
    count_recent_streams,
    get_last_analyzed_track,
    get_last_bliss_track,
    get_storage_v2_status,
    query_metric_rollups,
)
from crate.db.repositories.management import upsert_metric_rollup

__all__ = [
    "count_recent_active_users",
    "count_recent_streams",
    "get_last_analyzed_track",
    "get_last_bliss_track",
    "get_storage_v2_status",
    "query_metric_rollups",
    "upsert_metric_rollup",
]
