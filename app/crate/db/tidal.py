import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.serialize import serialize_row, serialize_rows
from crate.db.tx import transaction_scope

# ── Tidal Downloads ──────────────────────────────────────────────

def add_tidal_download(tidal_url: str, tidal_id: str, content_type: str, title: str,
                       artist: str | None = None, cover_url: str | None = None,
                       quality: str = "max", status: str = "queued", priority: int = 0,
                       source: str | None = None, metadata: dict | None = None,
                       *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return add_tidal_download(tidal_url, tidal_id, content_type, title,
                                      artist, cover_url, quality, status, priority,
                                      source, metadata, session=s)
    now = datetime.now(timezone.utc).isoformat()
    existing = session.execute(
        text("SELECT id FROM tidal_downloads WHERE tidal_id = :tidal_id AND status NOT IN ('completed', 'failed')"),
        {"tidal_id": tidal_id},
    ).mappings().first()
    if existing:
        return existing["id"]
    row = session.execute(
        text(
            "INSERT INTO tidal_downloads (tidal_url, tidal_id, content_type, title, artist, cover_url, "
            "quality, status, priority, source, metadata_json, created_at) "
            "VALUES (:tidal_url, :tidal_id, :content_type, :title, :artist, :cover_url, "
            ":quality, :status, :priority, :source, :metadata_json, :created_at) RETURNING id"
        ),
        {
            "tidal_url": tidal_url, "tidal_id": tidal_id, "content_type": content_type,
            "title": title, "artist": artist, "cover_url": cover_url,
            "quality": quality, "status": status, "priority": priority,
            "source": source, "metadata_json": json.dumps(metadata or {}),
            "created_at": now,
        },
    ).mappings().first()
    return row["id"]


def get_tidal_downloads(status: str | None = None, limit: int = 100) -> list[dict]:
    with transaction_scope() as session:
        if status:
            rows = session.execute(
                text("SELECT * FROM tidal_downloads WHERE status = :status ORDER BY priority DESC, created_at LIMIT :lim"),
                {"status": status, "lim": limit},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    "SELECT * FROM tidal_downloads ORDER BY CASE status "
                    "WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 WHEN 'processing' THEN 2 "
                    "WHEN 'wishlist' THEN 3 WHEN 'completed' THEN 4 WHEN 'failed' THEN 5 END, "
                    "priority DESC, created_at LIMIT :lim"
                ),
                {"lim": limit},
            ).mappings().all()
    results = []
    for r in rows:
        d = serialize_row(r)
        meta = d.pop("metadata_json", {})
        d["metadata"] = meta if isinstance(meta, dict) else json.loads(meta or "{}")
        results.append(d)
    return results


def get_tidal_download(dl_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM tidal_downloads WHERE id = :id"),
            {"id": dl_id},
        ).mappings().first()
    if not row:
        return None
    d = serialize_row(row)
    meta = d.pop("metadata_json", {})
    d["metadata"] = meta if isinstance(meta, dict) else json.loads(meta or "{}")
    return d


def update_tidal_download(dl_id: int, *, session=None, **kwargs):
    fields = []
    params: dict = {"id": dl_id}
    idx = 0
    for key in ("status", "priority", "task_id", "error", "completed_at"):
        if key in kwargs:
            fields.append(f"{key} = :val{idx}")
            params[f"val{idx}"] = kwargs[key]
            idx += 1
    if not fields:
        return
    if session is None:
        with transaction_scope() as s:
            return update_tidal_download(dl_id, session=s, **kwargs)
    session.execute(
        text(f"UPDATE tidal_downloads SET {', '.join(fields)} WHERE id = :id"),
        params,
    )


def delete_tidal_download(dl_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_tidal_download(dl_id, session=s)
    session.execute(
        text("DELETE FROM tidal_downloads WHERE id = :id"),
        {"id": dl_id},
    )


def get_next_queued_download() -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM tidal_downloads WHERE status = 'queued' ORDER BY priority DESC, created_at LIMIT 1")
        ).mappings().first()
    if not row:
        return None
    d = serialize_row(row)
    meta = d.pop("metadata_json", {})
    d["metadata"] = meta if isinstance(meta, dict) else json.loads(meta or "{}")
    return d


# ── Tidal Monitored Artists ─────────────────────────────────────

def set_monitored_artist(artist_name: str, tidal_id: str | None = None, enabled: bool = True, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return set_monitored_artist(artist_name, tidal_id, enabled, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text(
            "INSERT INTO tidal_monitored_artists (artist_name, tidal_id, enabled, last_checked) "
            "VALUES (:artist_name, :tidal_id, :enabled, :last_checked) "
            "ON CONFLICT(artist_name) DO UPDATE SET enabled = EXCLUDED.enabled, "
            "tidal_id = COALESCE(EXCLUDED.tidal_id, tidal_monitored_artists.tidal_id)"
        ),
        {"artist_name": artist_name, "tidal_id": tidal_id, "enabled": enabled, "last_checked": now},
    )


def get_monitored_artists() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM tidal_monitored_artists WHERE enabled = TRUE ORDER BY artist_name")
        ).mappings().all()
        return serialize_rows(rows)


def is_artist_monitored(artist_name: str) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT enabled FROM tidal_monitored_artists WHERE artist_name = :artist_name"),
            {"artist_name": artist_name},
        ).mappings().first()
    return row["enabled"] if row else False
