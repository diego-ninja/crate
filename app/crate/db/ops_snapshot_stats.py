"""Stats and analytics sections for ops snapshots."""

from __future__ import annotations

from typing import Any

from crate.db.import_queue_read_models import count_import_queue_items
from crate.db.ops_runtime_views import get_worker_live_state
from crate.db.queries.analytics import (
    get_decade_distribution,
    get_overview_stat_summary,
    get_stats_recent_albums,
    get_track_distribution_summary,
    get_top_artists_by_albums,
)
from crate.db.queries.tasks import get_latest_scan, list_tasks
from crate.db.repositories.library import get_library_stats


def _get_imports_pending_count() -> int:
    return count_import_queue_items(status="pending")


def _top_genres_from_distribution(genres: dict[str, int], *, limit: int = 10) -> list[dict]:
    return [
        {"name": name, "count": count}
        for name, count in sorted(genres.items(), key=lambda item: item[1], reverse=True)[:limit]
    ]


def build_stats_payload(
    *,
    stats: dict[str, Any] | None = None,
    scan: dict[str, Any] | None = None,
    pending_imports: int | None = None,
    worker_live: dict[str, Any] | None = None,
    summary: dict[str, Any] | None = None,
    track_distributions: dict[str, dict] | None = None,
) -> dict[str, Any]:
    stats = stats or get_library_stats()
    if scan is None:
        scan = get_latest_scan()
    if pending_imports is None:
        pending_imports = _get_imports_pending_count()
    if worker_live is None:
        worker_live = get_worker_live_state()
    pending_tasks = int(worker_live.get("pending_count") or 0) if worker_live else len(list_tasks(status="pending"))
    summary = summary or get_overview_stat_summary()
    track_distributions = track_distributions or get_track_distribution_summary()

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
        "formats": stats.get("formats") or track_distributions.get("formats", {}),
        "total_size_gb": round(stats["total_size"] / (1024**3), 2) if stats["total_size"] else 0,
        "last_scan": scan["scanned_at"] if scan else None,
        "pending_imports": pending_imports,
        "pending_tasks": pending_tasks,
        "total_duration_hours": summary["duration_hours"],
        "avg_bitrate": summary["avg_bitrate"],
        "top_genres": _top_genres_from_distribution(track_distributions.get("genres", {})),
        "recent_albums": recent_albums,
        "analyzed_tracks": summary["analyzed_tracks"],
        "avg_album_duration_min": summary["avg_album_duration_min"],
        "avg_tracks_per_album": summary["avg_tracks_per_album"],
    }


def build_analytics_payload(
    *,
    summary: dict[str, Any] | None = None,
    track_distributions: dict[str, dict] | None = None,
) -> dict[str, Any]:
    summary = summary or get_overview_stat_summary()
    track_distributions = track_distributions or get_track_distribution_summary()
    return {
        "computing": False,
        "genres": track_distributions.get("genres", {}),
        "decades": get_decade_distribution(),
        "formats": track_distributions.get("formats", {}),
        "bitrates": track_distributions.get("bitrates", {}),
        "top_artists": get_top_artists_by_albums(),
        "total_duration_hours": summary["duration_hours"],
        "sizes_by_format_gb": track_distributions.get("sizes_by_format_gb", {}),
        "avg_tracks_per_album": summary["avg_tracks_per_album"],
    }


__all__ = ["build_analytics_payload", "build_stats_payload"]
