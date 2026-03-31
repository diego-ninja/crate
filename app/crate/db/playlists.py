import json
from datetime import datetime, timezone

from crate.db.core import get_db_ctx

# ── Playlists ────────────────────────────────────────────────────

def _normalize_playlist_row(row: dict) -> dict:
    d = dict(row)
    rules = d.pop("smart_rules_json", None)
    d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
    d["scope"] = d.get("scope") or ("system" if d.get("user_id") is None else "user")
    d["generation_mode"] = d.get("generation_mode") or ("smart" if d.get("is_smart") else "static")
    d["is_curated"] = bool(d.get("is_curated"))
    d["is_active"] = True if d.get("is_active") is None else bool(d.get("is_active"))
    d["navidrome_public"] = bool(d.get("navidrome_public"))
    d["navidrome_projection_status"] = d.get("navidrome_projection_status") or "unprojected"
    d["is_system"] = d["scope"] == "system"
    return d


def _fetch_artwork_tracks(cur, playlist_id: int) -> list[dict]:
    cur.execute(
        """
        SELECT DISTINCT artist, album
        FROM playlist_tracks
        WHERE playlist_id = %s
          AND artist IS NOT NULL AND artist != ''
          AND album IS NOT NULL AND album != ''
        ORDER BY album
        LIMIT 4
        """,
        (playlist_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def create_playlist(name: str, description: str = "", user_id: int | None = None,
                    is_smart: bool = False, smart_rules: dict | None = None,
                    cover_data_url: str | None = None,
                    scope: str | None = None,
                    generation_mode: str | None = None,
                    is_curated: bool = False,
                    is_active: bool = True,
                    managed_by_user_id: int | None = None,
                    curation_key: str | None = None,
                    featured_rank: int | None = None,
                    category: str | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    final_scope = scope or ("system" if user_id is None else "user")
    final_generation_mode = generation_mode or ("smart" if is_smart else "static")
    with get_db_ctx() as cur:
        cur.execute(
            """
            INSERT INTO playlists (
                name, description, cover_data_url, user_id, is_smart, smart_rules_json,
                scope, generation_mode, is_curated, is_active, managed_by_user_id,
                curation_key, featured_rank, category, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                name,
                description,
                cover_data_url,
                user_id,
                is_smart,
                json.dumps(smart_rules) if smart_rules else None,
                final_scope,
                final_generation_mode,
                is_curated,
                is_active,
                managed_by_user_id,
                curation_key,
                featured_rank,
                category,
                now,
                now,
            ),
        )
        return cur.fetchone()["id"]


def get_playlists(user_id: int | None = None) -> list[dict]:
    with get_db_ctx() as cur:
        if user_id:
            cur.execute("SELECT * FROM playlists WHERE user_id = %s ORDER BY updated_at DESC", (user_id,))
        else:
            cur.execute("SELECT * FROM playlists ORDER BY updated_at DESC")
        rows = cur.fetchall()
        results = []
        for r in rows:
            d = _normalize_playlist_row(r)
            d["artwork_tracks"] = _fetch_artwork_tracks(cur, d["id"])
            results.append(d)
    return results


def get_playlist(playlist_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = _normalize_playlist_row(row)
        d["artwork_tracks"] = _fetch_artwork_tracks(cur, d["id"])
        return d


def list_system_playlists(*, only_curated: bool = False, only_active: bool = True,
                          category: str | None = None, user_id: int | None = None) -> list[dict]:
    query = [
        "SELECT p.*"
    ]
    params: list = []
    if user_id is not None:
        query.append(
            """,
            EXISTS (
                SELECT 1
                FROM user_followed_playlists ufp
                WHERE ufp.playlist_id = p.id AND ufp.user_id = %s
            ) AS is_followed
            """
        )
        params.append(user_id)
    query.append("FROM playlists p WHERE p.scope = 'system'")
    if only_curated:
        query.append("AND p.is_curated = TRUE")
    if only_active:
        query.append("AND p.is_active = TRUE")
    if category:
        query.append("AND p.category = %s")
        params.append(category)
    query.append("ORDER BY p.featured_rank NULLS LAST, p.updated_at DESC")
    with get_db_ctx() as cur:
        cur.execute("\n".join(query), params)
        rows = cur.fetchall()
        results = []
        for row in rows:
            item = _normalize_playlist_row(row)
            item["artwork_tracks"] = _fetch_artwork_tracks(cur, item["id"])
            results.append(item)
    return results


def update_playlist(playlist_id: int, **kwargs):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]
    for key in (
        "name", "description", "cover_data_url", "scope", "generation_mode",
        "is_curated", "is_active", "managed_by_user_id", "curation_key",
        "featured_rank", "category", "navidrome_playlist_id",
        "navidrome_public", "navidrome_projection_status",
        "navidrome_projection_error", "navidrome_projected_at",
    ):
        if key in kwargs:
            fields.append(f"{key} = %s")
            values.append(kwargs[key])
    if "is_smart" in kwargs:
        fields.append("is_smart = %s")
        values.append(kwargs["is_smart"])
    if "smart_rules" in kwargs:
        fields.append("smart_rules_json = %s")
        values.append(json.dumps(kwargs["smart_rules"]))
    values.append(playlist_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE playlists SET {', '.join(fields)} WHERE id = %s", values)


def delete_playlist(playlist_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlists WHERE id = %s", (playlist_id,))


def set_playlist_navidrome_projection(
    playlist_id: int,
    *,
    navidrome_playlist_id: str | None = None,
    navidrome_public: bool | None = None,
    status: str | None = None,
    error: str | None = None,
    projected_at: str | None = None,
):
    kwargs: dict = {}
    if navidrome_playlist_id is not None:
        kwargs["navidrome_playlist_id"] = navidrome_playlist_id
    if navidrome_public is not None:
        kwargs["navidrome_public"] = navidrome_public
    if status is not None:
        kwargs["navidrome_projection_status"] = status
    if error is not None:
        kwargs["navidrome_projection_error"] = error
    if projected_at is not None:
        kwargs["navidrome_projected_at"] = projected_at
    if kwargs:
        update_playlist(playlist_id, **kwargs)


def get_playlist_tracks(playlist_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT
                pt.*,
                lt.id AS track_id,
                lt.navidrome_id
            FROM playlist_tracks pt
            LEFT JOIN LATERAL (
                SELECT id, navidrome_id, path
                FROM library_tracks lt
                WHERE lt.path = pt.track_path
                   OR lt.path LIKE ('%%/' || pt.track_path)
                ORDER BY CASE WHEN lt.path = pt.track_path THEN 0 ELSE 1 END
                LIMIT 1
            ) lt ON TRUE
            WHERE pt.playlist_id = %s
            ORDER BY pt.position
            """,
            (playlist_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def add_playlist_tracks(playlist_id: int, tracks: list[dict]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        # Get current max position
        cur.execute("SELECT COALESCE(MAX(position), 0) AS maxp FROM playlist_tracks WHERE playlist_id = %s", (playlist_id,))
        pos = cur.fetchone()["maxp"]
        for t in tracks:
            pos += 1
            cur.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_path, title, artist, album, duration, position, added_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (playlist_id, t["path"], t.get("title", ""), t.get("artist", ""),
                 t.get("album", ""), t.get("duration", 0), pos, now),
            )
        # Update counts
        cur.execute(
            "UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = %s), "
            "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = %s), "
            "updated_at = %s WHERE id = %s",
            (playlist_id, playlist_id, now, playlist_id),
        )


def remove_playlist_track(playlist_id: int, position: int):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s AND position = %s", (playlist_id, position))
        # Reorder remaining
        cur.execute(
            "WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos "
            "FROM playlist_tracks WHERE playlist_id = %s) "
            "UPDATE playlist_tracks SET position = ordered.new_pos "
            "FROM ordered WHERE playlist_tracks.id = ordered.id",
            (playlist_id,),
        )
        cur.execute(
            "UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = %s), "
            "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = %s), "
            "updated_at = %s WHERE id = %s",
            (playlist_id, playlist_id, now, playlist_id),
        )


def reorder_playlist(playlist_id: int, track_ids: list[int]):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        for pos, tid in enumerate(track_ids, 1):
            cur.execute("UPDATE playlist_tracks SET position = %s WHERE id = %s AND playlist_id = %s",
                        (pos, tid, playlist_id))
        cur.execute("UPDATE playlists SET updated_at = %s WHERE id = %s", (now, playlist_id))


def is_playlist_followed(user_id: int, playlist_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT 1 FROM user_followed_playlists WHERE user_id = %s AND playlist_id = %s",
            (user_id, playlist_id),
        )
        return cur.fetchone() is not None


def follow_playlist(user_id: int, playlist_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT 1
            FROM playlists
            WHERE id = %s
              AND scope = 'system'
              AND is_curated = TRUE
              AND is_active = TRUE
            """,
            (playlist_id,),
        )
        if not cur.fetchone():
            return False
        cur.execute(
            """
            INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, playlist_id) DO NOTHING
            """,
            (user_id, playlist_id, now),
        )
        return cur.rowcount > 0


def unfollow_playlist(user_id: int, playlist_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute(
            "DELETE FROM user_followed_playlists WHERE user_id = %s AND playlist_id = %s",
            (user_id, playlist_id),
        )
        return cur.rowcount > 0


def get_playlist_followers_count(playlist_id: int) -> int:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM user_followed_playlists WHERE playlist_id = %s",
            (playlist_id,),
        )
        row = cur.fetchone()
    return int(row["cnt"]) if row else 0


def get_followed_system_playlists(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT p.*, TRUE AS is_followed, ufp.followed_at
            FROM user_followed_playlists ufp
            JOIN playlists p ON p.id = ufp.playlist_id
            WHERE ufp.user_id = %s
              AND p.scope = 'system'
              AND p.is_curated = TRUE
              AND p.is_active = TRUE
            ORDER BY ufp.followed_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
        results = []
        for row in rows:
            item = _normalize_playlist_row(row)
            item["artwork_tracks"] = _fetch_artwork_tracks(cur, item["id"])
            results.append(item)
    return results
