"""New releases — detection and tracking of new albums from library artists."""

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.serialize import serialize_row
from crate.db.tx import transaction_scope


def upsert_new_release(artist_name: str, album_title: str, tidal_id: str = "",
                       tidal_url: str = "", cover_url: str = "", year: str = "",
                       tracks: int = 0, quality: str = "", release_date: str = "",
                       release_type: str = "", mb_release_group_id: str = "",
                       *, session=None) -> int:
    """Insert or update a detected new release. Returns release ID."""
    if session is None:
        with transaction_scope() as s:
            return upsert_new_release(artist_name, album_title, tidal_id, tidal_url,
                                      cover_url, year, tracks, quality, release_date,
                                      release_type, mb_release_group_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("""
            INSERT INTO new_releases (artist_name, album_title, tidal_id, tidal_url,
                cover_url, year, tracks, quality, status, detected_at,
                release_date, release_type, mb_release_group_id)
            VALUES (:artist_name, :album_title, :tidal_id, :tidal_url, :cover_url, :year, :tracks, :quality, 'detected', :detected_at, :release_date, :release_type, :mb_release_group_id)
            ON CONFLICT (artist_name, album_title) DO UPDATE SET
                tidal_id = EXCLUDED.tidal_id, tidal_url = EXCLUDED.tidal_url,
                cover_url = EXCLUDED.cover_url, year = EXCLUDED.year,
                tracks = EXCLUDED.tracks, quality = EXCLUDED.quality,
                release_date = EXCLUDED.release_date,
                release_type = EXCLUDED.release_type,
                mb_release_group_id = EXCLUDED.mb_release_group_id
            RETURNING id
        """),
        {
            "artist_name": artist_name, "album_title": album_title,
            "tidal_id": tidal_id, "tidal_url": tidal_url, "cover_url": cover_url,
            "year": year, "tracks": tracks, "quality": quality, "detected_at": now,
            "release_date": release_date or None, "release_type": release_type or None,
            "mb_release_group_id": mb_release_group_id or None,
        },
    ).mappings().first()
    return row["id"]


def get_new_releases(status: str = "", upcoming: bool = False, limit: int = 200) -> list[dict]:
    """Get new releases. If upcoming=True, only future releases ordered by release_date."""
    with transaction_scope() as session:
        select_sql = """
            SELECT
                nr.*,
                la.id AS artist_id,
                la.slug AS artist_slug,
                alb.id AS album_id,
                alb.slug AS album_slug
            FROM new_releases nr
            LEFT JOIN library_artists la ON LOWER(la.name) = LOWER(nr.artist_name)
            LEFT JOIN library_albums alb
              ON LOWER(alb.artist) = LOWER(nr.artist_name)
             AND LOWER(alb.name) = LOWER(nr.album_title)
        """
        if upcoming:
            rows = session.execute(
                text(
                    select_sql
                    + "WHERE nr.status NOT IN ('dismissed') "
                    "AND nr.release_date IS NOT NULL AND nr.release_date >= :today "
                    "ORDER BY nr.release_date ASC LIMIT :lim"
                ),
                {"today": datetime.now(timezone.utc).date(), "lim": limit},
            ).mappings().all()
        elif status:
            rows = session.execute(
                text(
                    select_sql
                    + "WHERE nr.status = :status ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT :lim"
                ),
                {"status": status, "lim": limit},
            ).mappings().all()
        else:
            rows = session.execute(
                text(
                    select_sql
                    + "WHERE nr.status NOT IN ('dismissed') ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT :lim"
                ),
                {"lim": limit},
            ).mappings().all()
        return [serialize_row(r) for r in rows]


def mark_release_downloading(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_downloading(release_id, session=s)
    session.execute(
        text("UPDATE new_releases SET status = 'downloading' WHERE id = :id"),
        {"id": release_id},
    )


def mark_release_downloaded(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_downloaded(release_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("UPDATE new_releases SET status = 'downloaded', downloaded_at = :now WHERE id = :id"),
        {"now": now, "id": release_id},
    )


def mark_release_dismissed(release_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return mark_release_dismissed(release_id, session=s)
    session.execute(
        text("UPDATE new_releases SET status = 'dismissed' WHERE id = :id"),
        {"id": release_id},
    )


def is_album_in_library(artist_name: str, album_title: str) -> bool:
    """Check if an album already exists in the library (fuzzy: case-insensitive)."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT 1 FROM library_albums WHERE LOWER(artist) = LOWER(:artist) AND LOWER(name) = LOWER(:album) LIMIT 1"),
            {"artist": artist_name, "album": album_title},
        ).mappings().first()
        return row is not None


def cleanup_old_releases(days: int = 90, *, session=None):
    """Remove dismissed/downloaded releases older than N days."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_old_releases(days, session=s)
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    session.execute(
        text("DELETE FROM new_releases WHERE status IN ('downloaded', 'dismissed') AND detected_at < :cutoff"),
        {"cutoff": cutoff},
    )
