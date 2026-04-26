"""Stats and analytics sections for ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.cache_store import get_cache
from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.ops_runtime_views import get_worker_live_state
from crate.db.queries.analytics import (
    get_avg_tracks_per_album,
    get_bitrate_distribution,
    get_decade_distribution,
    get_format_distribution,
    get_genre_distribution,
    get_sizes_by_format_gb,
    get_stats_analyzed_track_count,
    get_stats_avg_album_duration_min,
    get_stats_avg_bitrate,
    get_stats_duration_hours,
    get_stats_recent_albums,
    get_stats_top_genres,
    get_top_artists_by_albums,
    get_total_duration_hours,
)
from crate.db.queries.tasks import get_latest_scan, list_tasks
from crate.db.repositories.library import get_library_stats


def _get_imports_pending_count() -> int:
    return count_import_queue_items(status="pending")


def build_stats_payload() -> dict[str, Any]:
    stats = get_library_stats()
    scan = get_latest_scan()
    pending_imports = _get_imports_pending_count()
    worker_live = get_worker_live_state()
    pending_tasks = int(worker_live.get("pending_count") or 0) if worker_live else len(list_tasks(status="pending"))

    raw_albums = get_stats_recent_albums()
    recent_albums = [
        {
            "id": row["id"],
            "slug": row["slug"],
            "artist": row["artist"],
            "artist_id": row["artist_id"],
            "artist_slug": row["artist_slug"],
            "name": row["name"],
            "display_name": row["name"],
            "year": row["year"],
            "updated_at": row.get("updated_at"),
        }
        for row in raw_albums
    ]

    return {
        "artists": stats["artists"],
        "albums": stats["albums"],
        "tracks": stats["tracks"],
        "formats": stats["formats"],
        "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
        "last_scan": scan["scanned_at"] if scan else None,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
        "total_duration_hours": get_stats_duration_hours(),
        "avg_bitrate": get_stats_avg_bitrate(),
        "top_genres": get_stats_top_genres(),
        "recent_albums": recent_albums,
        "analyzed_tracks": get_stats_analyzed_track_count(),
        "avg_album_duration_min": get_stats_avg_album_duration_min(),
        "avg_tracks_per_album": round(get_avg_tracks_per_album() or 0, 1),
    }


def build_analytics_payload() -> dict[str, Any]:
    return {
        "computing": False,
        "genres": get_genre_distribution(),
        "decades": get_decade_distribution(),
        "formats": get_format_distribution(),
        "bitrates": get_bitrate_distribution(),
        "top_artists": get_top_artists_by_albums(),
        "total_duration_hours": get_total_duration_hours(),
        "sizes_by_format_gb": get_sizes_by_format_gb(),
        "avg_tracks_per_album": get_avg_tracks_per_album(),
    }


__all__ = ["build_analytics_payload", "build_stats_payload"]
