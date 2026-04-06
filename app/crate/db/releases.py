"""New releases — detection and tracking of new albums from library artists."""

import json
from datetime import datetime, timezone
from crate.db.core import get_db_ctx


def upsert_new_release(artist_name: str, album_title: str, tidal_id: str = "",
                       tidal_url: str = "", cover_url: str = "", year: str = "",
                       tracks: int = 0, quality: str = "", release_date: str = "",
                       release_type: str = "", mb_release_group_id: str = "") -> int:
    """Insert or update a detected new release. Returns release ID."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO new_releases (artist_name, album_title, tidal_id, tidal_url,
                cover_url, year, tracks, quality, status, detected_at,
                release_date, release_type, mb_release_group_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'detected', %s, %s, %s, %s)
            ON CONFLICT (artist_name, album_title) DO UPDATE SET
                tidal_id = EXCLUDED.tidal_id, tidal_url = EXCLUDED.tidal_url,
                cover_url = EXCLUDED.cover_url, year = EXCLUDED.year,
                tracks = EXCLUDED.tracks, quality = EXCLUDED.quality,
                release_date = EXCLUDED.release_date,
                release_type = EXCLUDED.release_type,
                mb_release_group_id = EXCLUDED.mb_release_group_id
            RETURNING id
        """, (artist_name, album_title, tidal_id, tidal_url, cover_url, year, tracks, quality, now,
              release_date or None, release_type or None, mb_release_group_id or None))
        return cur.fetchone()["id"]


def get_new_releases(status: str = "", upcoming: bool = False, limit: int = 200) -> list[dict]:
    """Get new releases. If upcoming=True, only future releases ordered by release_date."""
    with get_db_ctx() as cur:
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
            cur.execute(
                select_sql
                + "WHERE nr.status NOT IN ('dismissed') "
                "AND nr.release_date IS NOT NULL AND nr.release_date >= %s "
                "ORDER BY nr.release_date ASC LIMIT %s",
                (datetime.now(timezone.utc).strftime("%Y-%m-%d"), limit),
            )
        elif status:
            cur.execute(
                select_sql
                + "WHERE nr.status = %s ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT %s",
                (status, limit),
            )
        else:
            cur.execute(
                select_sql
                + "WHERE nr.status NOT IN ('dismissed') ORDER BY nr.release_date DESC NULLS LAST, nr.detected_at DESC LIMIT %s",
                (limit,),
            )
        return [dict(r) for r in cur.fetchall()]


def mark_release_downloading(release_id: int):
    with get_db_ctx() as cur:
        cur.execute("UPDATE new_releases SET status = 'downloading' WHERE id = %s", (release_id,))


def mark_release_downloaded(release_id: int):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("UPDATE new_releases SET status = 'downloaded', downloaded_at = %s WHERE id = %s", (now, release_id))


def mark_release_dismissed(release_id: int):
    with get_db_ctx() as cur:
        cur.execute("UPDATE new_releases SET status = 'dismissed' WHERE id = %s", (release_id,))


def is_album_in_library(artist_name: str, album_title: str) -> bool:
    """Check if an album already exists in the library (fuzzy: case-insensitive)."""
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT 1 FROM library_albums WHERE LOWER(artist) = LOWER(%s) AND LOWER(name) = LOWER(%s) LIMIT 1",
            (artist_name, album_title),
        )
        return cur.fetchone() is not None


def cleanup_old_releases(days: int = 90):
    """Remove dismissed/downloaded releases older than N days."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM new_releases WHERE status IN ('downloaded', 'dismissed') AND detected_at < %s", (cutoff,))
