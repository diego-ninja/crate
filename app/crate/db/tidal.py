import json
from datetime import datetime, timezone
from crate.db.core import get_db_ctx

# ── Tidal Downloads ──────────────────────────────────────────────

def add_tidal_download(tidal_url: str, tidal_id: str, content_type: str, title: str,
                       artist: str | None = None, cover_url: str | None = None,
                       quality: str = "max", status: str = "queued", priority: int = 0,
                       source: str | None = None, metadata: dict | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        # Skip duplicates (same tidal_id + not completed/failed)
        cur.execute(
            "SELECT id FROM tidal_downloads WHERE tidal_id = %s AND status NOT IN ('completed', 'failed')",
            (tidal_id,),
        )
        existing = cur.fetchone()
        if existing:
            return existing["id"]
        cur.execute(
            "INSERT INTO tidal_downloads (tidal_url, tidal_id, content_type, title, artist, cover_url, "
            "quality, status, priority, source, metadata_json, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (tidal_url, tidal_id, content_type, title, artist, cover_url,
             quality, status, priority, source, json.dumps(metadata or {}), now),
        )
        return cur.fetchone()["id"]


def get_tidal_downloads(status: str | None = None, limit: int = 100) -> list[dict]:
    with get_db_ctx() as cur:
        if status:
            cur.execute(
                "SELECT * FROM tidal_downloads WHERE status = %s ORDER BY priority DESC, created_at LIMIT %s",
                (status, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM tidal_downloads ORDER BY CASE status "
                "WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 WHEN 'processing' THEN 2 "
                "WHEN 'wishlist' THEN 3 WHEN 'completed' THEN 4 WHEN 'failed' THEN 5 END, "
                "priority DESC, created_at LIMIT %s",
                (limit,),
            )
        rows = cur.fetchall()
    results = []
    for r in rows:
        d = dict(r)
        meta = d.pop("metadata_json", {})
        d["metadata"] = meta if isinstance(meta, dict) else json.loads(meta or "{}")
        results.append(d)
    return results


def update_tidal_download(dl_id: int, **kwargs):
    fields = []
    values: list = []
    for key in ("status", "priority", "task_id", "error", "completed_at"):
        if key in kwargs:
            fields.append(f"{key} = %s")
            values.append(kwargs[key])
    if not fields:
        return
    values.append(dl_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE tidal_downloads SET {', '.join(fields)} WHERE id = %s", values)


def delete_tidal_download(dl_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM tidal_downloads WHERE id = %s", (dl_id,))


def get_next_queued_download() -> dict | None:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM tidal_downloads WHERE status = 'queued' ORDER BY priority DESC, created_at LIMIT 1"
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    meta = d.pop("metadata_json", {})
    d["metadata"] = meta if isinstance(meta, dict) else json.loads(meta or "{}")
    return d


# ── Tidal Monitored Artists ─────────────────────────────────────

def set_monitored_artist(artist_name: str, tidal_id: str | None = None, enabled: bool = True):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO tidal_monitored_artists (artist_name, tidal_id, enabled, last_checked) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT(artist_name) DO UPDATE SET enabled = EXCLUDED.enabled, tidal_id = COALESCE(EXCLUDED.tidal_id, tidal_monitored_artists.tidal_id)",
            (artist_name, tidal_id, enabled, now),
        )


def get_monitored_artists() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM tidal_monitored_artists WHERE enabled = TRUE ORDER BY artist_name")
        return [dict(r) for r in cur.fetchall()]


def is_artist_monitored(artist_name: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT enabled FROM tidal_monitored_artists WHERE artist_name = %s", (artist_name,))
        row = cur.fetchone()
    return row["enabled"] if row else False


