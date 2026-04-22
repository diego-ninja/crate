import json
import secrets
from datetime import datetime, timezone

from crate.db.tx import transaction_scope
from sqlalchemy import bindparam, text

# ── Playlists ────────────────────────────────────────────────────

def _normalize_playlist_row(row: dict) -> dict:
    d = dict(row)
    rules = d.pop("smart_rules_json", None)
    d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
    d["scope"] = d.get("scope") or ("system" if d.get("user_id") is None else "user")
    d["generation_mode"] = d.get("generation_mode") or ("smart" if d.get("is_smart") else "static")
    d["is_curated"] = bool(d.get("is_curated"))
    d["is_active"] = True if d.get("is_active") is None else bool(d.get("is_active"))
    d["visibility"] = d.get("visibility") or ("public" if d["scope"] == "system" else "private")
    d["is_collaborative"] = bool(d.get("is_collaborative"))
    d["is_system"] = d["scope"] == "system"
    d["auto_refresh_enabled"] = True if d.get("auto_refresh_enabled") is None else bool(d.get("auto_refresh_enabled"))
    d["generation_status"] = d.get("generation_status") or "idle"
    d["generation_error"] = d.get("generation_error")
    if hasattr(d.get("last_generated_at"), "isoformat"):
        d["last_generated_at"] = d["last_generated_at"].isoformat()
    if d.get("cover_path"):
        d["cover_data_url"] = f"/api/playlists/{d['id']}/cover"
    return d


def _fetch_artwork_tracks(session, playlist_id: int) -> list[dict]:
    return _fetch_artwork_tracks_for_playlists(session, [playlist_id]).get(playlist_id, [])


def _fetch_artwork_tracks_for_playlists(session, playlist_ids: list[int]) -> dict[int, list[dict]]:
    if not playlist_ids:
        return {}
    rows = session.execute(
        text("""
        WITH artwork_groups AS (
            SELECT
                pt.playlist_id,
                COALESCE(lt.artist, pt.artist) AS artist,
                ar.id AS artist_id,
                ar.slug AS artist_slug,
                COALESCE(lt.album, pt.album) AS album,
                alb.id AS album_id,
                alb.slug AS album_slug
            FROM playlist_tracks pt
            LEFT JOIN LATERAL (
                SELECT id, storage_id::text, path, artist, album, album_id
                FROM library_tracks lt
                WHERE lt.id = pt.track_id
                   OR lt.path = pt.track_path
                   OR lt.path LIKE ('%/' || pt.track_path)
                ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 WHEN lt.path = pt.track_path THEN 1 ELSE 2 END
                LIMIT 1
            ) lt ON TRUE
            LEFT JOIN library_albums alb
              ON alb.id = lt.album_id
              OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
            LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
            WHERE pt.playlist_id IN :playlist_ids
              AND COALESCE(lt.artist, pt.artist, '') != ''
              AND COALESCE(lt.album, pt.album, '') != ''
            GROUP BY
                pt.playlist_id,
                COALESCE(lt.artist, pt.artist),
                ar.id,
                ar.slug,
                COALESCE(lt.album, pt.album),
                alb.id,
                alb.slug
        ),
        ranked_artwork AS (
            SELECT
                playlist_id,
                artist,
                artist_id,
                artist_slug,
                album,
                album_id,
                album_slug,
                ROW_NUMBER() OVER (
                    PARTITION BY playlist_id
                    ORDER BY album, artist
                ) AS artwork_rank
            FROM artwork_groups
        )
        SELECT
            playlist_id,
            artist,
            artist_id,
            artist_slug,
            album,
            album_id,
            album_slug
        FROM ranked_artwork
        WHERE artwork_rank <= 4
        ORDER BY playlist_id, artwork_rank
        """).bindparams(bindparam("playlist_ids", expanding=True)),
        {"playlist_ids": playlist_ids},
    ).mappings().all()
    artwork_by_playlist = {playlist_id: [] for playlist_id in playlist_ids}
    for row in rows:
        item = dict(row)
        playlist_id = int(item.pop("playlist_id"))
        artwork_by_playlist.setdefault(playlist_id, []).append(item)
    return artwork_by_playlist


def _attach_artwork_tracks(session, playlists: list[dict]) -> list[dict]:
    artwork_by_playlist = _fetch_artwork_tracks_for_playlists(
        session,
        [int(item["id"]) for item in playlists if item.get("id") is not None],
    )
    for item in playlists:
        item["artwork_tracks"] = artwork_by_playlist.get(int(item["id"]), [])
    return playlists


def create_playlist(name: str, description: str = "", user_id: int | None = None,
                    is_smart: bool = False, smart_rules: dict | None = None,
                    cover_data_url: str | None = None,
                    cover_path: str | None = None,
                    scope: str | None = None,
                    visibility: str | None = None,
                    is_collaborative: bool = False,
                    generation_mode: str | None = None,
                    is_curated: bool = False,
                    is_active: bool = True,
                    managed_by_user_id: int | None = None,
                    curation_key: str | None = None,
                    featured_rank: int | None = None,
                    category: str | None = None,
                    *, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return create_playlist(
                name, description, user_id, is_smart, smart_rules,
                cover_data_url, cover_path, scope, visibility, is_collaborative,
                generation_mode, is_curated, is_active, managed_by_user_id,
                curation_key, featured_rank, category, session=s,
            )
    now = datetime.now(timezone.utc).isoformat()
    final_scope = scope or ("system" if user_id is None else "user")
    final_visibility = visibility or ("public" if final_scope == "system" else "private")
    final_generation_mode = generation_mode or ("smart" if is_smart else "static")
    row = session.execute(
        text("""
        INSERT INTO playlists (
            name, description, cover_data_url, user_id, is_smart, smart_rules_json,
            cover_path, scope, visibility, is_collaborative, generation_mode, is_curated, is_active, managed_by_user_id,
            curation_key, featured_rank, category, created_at, updated_at
        )
        VALUES (:name, :description, :cover_data_url, :user_id, :is_smart, :smart_rules_json,
                :cover_path, :scope, :visibility, :is_collaborative, :generation_mode, :is_curated, :is_active, :managed_by_user_id,
                :curation_key, :featured_rank, :category, :created_at, :updated_at)
        RETURNING id
        """),
        {
            "name": name,
            "description": description,
            "cover_data_url": cover_data_url,
            "user_id": user_id,
            "is_smart": is_smart,
            "smart_rules_json": json.dumps(smart_rules) if smart_rules else None,
            "cover_path": cover_path,
            "scope": final_scope,
            "visibility": final_visibility,
            "is_collaborative": is_collaborative,
            "generation_mode": final_generation_mode,
            "is_curated": is_curated,
            "is_active": is_active,
            "managed_by_user_id": managed_by_user_id,
            "curation_key": curation_key,
            "featured_rank": featured_rank,
            "category": category,
            "created_at": now,
            "updated_at": now,
        },
    ).mappings().first()
    playlist_id = row["id"]
    if user_id is not None:
        session.execute(
            text("""
            INSERT INTO playlist_members (playlist_id, user_id, role, invited_by, created_at)
            VALUES (:playlist_id, :user_id, 'owner', :invited_by, :created_at)
            ON CONFLICT (playlist_id, user_id) DO NOTHING
            """),
            {"playlist_id": playlist_id, "user_id": user_id, "invited_by": user_id, "created_at": now},
        )
    return playlist_id


def get_playlists(user_id: int | None = None) -> list[dict]:
    with transaction_scope() as session:
        if user_id:
            rows = session.execute(
                text("""
                SELECT DISTINCT p.*
                FROM playlists p
                LEFT JOIN playlist_members pm ON pm.playlist_id = p.id
                WHERE p.user_id = :user_id OR pm.user_id = :user_id2
                ORDER BY p.updated_at DESC
                """),
                {"user_id": user_id, "user_id2": user_id},
            ).mappings().all()
        else:
            rows = session.execute(text("SELECT * FROM playlists ORDER BY updated_at DESC")).mappings().all()
        results = [_normalize_playlist_row(r) for r in rows]
        return _attach_artwork_tracks(session, results)


def get_playlist(playlist_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(text("SELECT * FROM playlists WHERE id = :playlist_id"), {"playlist_id": playlist_id}).mappings().first()
        if not row:
            return None
        d = _normalize_playlist_row(row)
        d["artwork_tracks"] = _fetch_artwork_tracks(session, d["id"])
        return d


def list_system_playlists(*, only_curated: bool = False, only_active: bool = True,
                          category: str | None = None, user_id: int | None = None) -> list[dict]:
    query_parts = [
        """
        SELECT
            p.*,
            COALESCE(followers.follower_count, 0)::int AS follower_count
        """
    ]
    params: dict = {}
    if user_id is not None:
        query_parts.append(
            """,
            EXISTS (
                SELECT 1
                FROM user_followed_playlists ufp
                WHERE ufp.playlist_id = p.id AND ufp.user_id = :follow_user_id
            ) AS is_followed
            """
        )
        params["follow_user_id"] = user_id
    query_parts.append(
        """
        FROM playlists p
        LEFT JOIN (
            SELECT playlist_id, COUNT(*)::int AS follower_count
            FROM user_followed_playlists
            GROUP BY playlist_id
        ) followers ON followers.playlist_id = p.id
        WHERE p.scope = 'system'
        """
    )
    if only_curated:
        query_parts.append("AND p.is_curated = TRUE")
    if only_active:
        query_parts.append("AND p.is_active = TRUE")
    if category:
        query_parts.append("AND p.category = :category")
        params["category"] = category
    query_parts.append("ORDER BY p.featured_rank NULLS LAST, p.updated_at DESC")
    with transaction_scope() as session:
        rows = session.execute(text("\n".join(query_parts)), params).mappings().all()
        results = [_normalize_playlist_row(row) for row in rows]
        return _attach_artwork_tracks(session, results)


def update_playlist(playlist_id: int, *, session=None, **kwargs):
    if session is None:
        with transaction_scope() as s:
            return update_playlist(playlist_id, session=s, **kwargs)
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = :p_updated_at"]
    params: dict = {"p_updated_at": now}
    for key in (
        "name", "description", "cover_data_url", "cover_path", "scope", "visibility",
        "is_collaborative", "generation_mode", "auto_refresh_enabled",
        "is_curated", "is_active", "managed_by_user_id", "curation_key",
        "featured_rank", "category",
    ):
        if key in kwargs:
            param_name = f"p_{key}"
            fields.append(f"{key} = :{param_name}")
            params[param_name] = kwargs[key]
    if "is_smart" in kwargs:
        fields.append("is_smart = :p_is_smart")
        params["p_is_smart"] = kwargs["is_smart"]
    if "smart_rules" in kwargs:
        fields.append("smart_rules_json = :p_smart_rules_json")
        params["p_smart_rules_json"] = json.dumps(kwargs["smart_rules"])
    params["playlist_id"] = playlist_id
    session.execute(text(f"UPDATE playlists SET {', '.join(fields)} WHERE id = :playlist_id"), params)


def delete_playlist(playlist_id: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return delete_playlist(playlist_id, session=s)
    session.execute(text("DELETE FROM playlists WHERE id = :playlist_id"), {"playlist_id": playlist_id})


def get_playlist_tracks(playlist_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                pt.*,
                lt.id AS track_id,
                lt.storage_id::text AS track_storage_id,
                ar.id AS artist_id,
                ar.slug AS artist_slug,
                alb.id AS album_id,
                alb.slug AS album_slug
            FROM playlist_tracks pt
            LEFT JOIN LATERAL (
                SELECT id, storage_id::text, path, artist, album, album_id
                FROM library_tracks lt
                WHERE lt.id = pt.track_id
                   OR lt.path = pt.track_path
                   OR lt.path LIKE ('%/' || pt.track_path)
                ORDER BY CASE WHEN lt.id = pt.track_id THEN 0 WHEN lt.path = pt.track_path THEN 1 ELSE 2 END
                LIMIT 1
            ) lt ON TRUE
            LEFT JOIN library_albums alb
              ON alb.id = lt.album_id
              OR (lt.album_id IS NULL AND alb.artist = COALESCE(lt.artist, pt.artist) AND alb.name = COALESCE(lt.album, pt.album))
            LEFT JOIN library_artists ar ON ar.name = COALESCE(lt.artist, pt.artist)
            WHERE pt.playlist_id = :playlist_id
            ORDER BY pt.position
            """),
            {"playlist_id": playlist_id},
        ).mappings().all()
        return [dict(r) for r in rows]


def add_playlist_tracks(playlist_id: int, tracks: list[dict], *, session=None):
    if session is None:
        with transaction_scope() as s:
            return add_playlist_tracks(playlist_id, tracks, session=s)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("SELECT COALESCE(MAX(position), 0) AS maxp FROM playlist_tracks WHERE playlist_id = :playlist_id"),
        {"playlist_id": playlist_id},
    ).mappings().first()
    pos = row["maxp"]
    for t in tracks:
        pos += 1
        session.execute(
            text("INSERT INTO playlist_tracks (playlist_id, track_id, track_path, title, artist, album, duration, position, added_at) "
                 "VALUES (:playlist_id, :track_id, :track_path, :title, :artist, :album, :duration, :position, :added_at)"),
            {
                "playlist_id": playlist_id,
                "track_id": t.get("track_id") or t.get("libraryTrackId"),
                "track_path": t.get("path") or "",
                "title": t.get("title", ""),
                "artist": t.get("artist", ""),
                "album": t.get("album", ""),
                "duration": t.get("duration", 0),
                "position": pos,
                "added_at": now,
            },
        )
    session.execute(
        text("UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :pid1), "
             "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = :pid2), "
             "updated_at = :now WHERE id = :pid3"),
        {"pid1": playlist_id, "pid2": playlist_id, "now": now, "pid3": playlist_id},
    )


def replace_playlist_tracks(playlist_id: int, tracks: list[dict], *, session=None):
    """Atomically replace all tracks in a playlist (DELETE + INSERT in one transaction)."""
    if session is None:
        with transaction_scope() as s:
            return replace_playlist_tracks(playlist_id, tracks, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(text("DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id"), {"playlist_id": playlist_id})
    pos = 0
    for t in tracks:
        pos += 1
        session.execute(
            text("INSERT INTO playlist_tracks (playlist_id, track_id, track_path, title, artist, album, duration, position, added_at) "
                 "VALUES (:playlist_id, :track_id, :track_path, :title, :artist, :album, :duration, :position, :added_at)"),
            {
                "playlist_id": playlist_id,
                "track_id": t.get("track_id") or t.get("libraryTrackId"),
                "track_path": t.get("path") or "",
                "title": t.get("title", ""),
                "artist": t.get("artist", ""),
                "album": t.get("album", ""),
                "duration": t.get("duration", 0),
                "position": pos,
                "added_at": now,
            },
        )
    session.execute(
        text("UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :pid1), "
             "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = :pid2), "
             "updated_at = :now WHERE id = :pid3"),
        {"pid1": playlist_id, "pid2": playlist_id, "now": now, "pid3": playlist_id},
    )


def remove_playlist_track(playlist_id: int, position: int, *, session=None):
    if session is None:
        with transaction_scope() as s:
            return remove_playlist_track(playlist_id, position, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("DELETE FROM playlist_tracks WHERE playlist_id = :playlist_id AND position = :position"),
        {"playlist_id": playlist_id, "position": position},
    )
    session.execute(
        text("WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos "
             "FROM playlist_tracks WHERE playlist_id = :playlist_id) "
             "UPDATE playlist_tracks SET position = ordered.new_pos "
             "FROM ordered WHERE playlist_tracks.id = ordered.id"),
        {"playlist_id": playlist_id},
    )
    session.execute(
        text("UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :pid1), "
             "total_duration = (SELECT COALESCE(SUM(duration), 0) FROM playlist_tracks WHERE playlist_id = :pid2), "
             "updated_at = :now WHERE id = :pid3"),
        {"pid1": playlist_id, "pid2": playlist_id, "now": now, "pid3": playlist_id},
    )


def reorder_playlist(playlist_id: int, track_ids: list[int], *, session=None):
    if session is None:
        with transaction_scope() as s:
            return reorder_playlist(playlist_id, track_ids, session=s)
    now = datetime.now(timezone.utc).isoformat()
    for pos, tid in enumerate(track_ids, 1):
        session.execute(
            text("UPDATE playlist_tracks SET position = :pos WHERE id = :tid AND playlist_id = :playlist_id"),
            {"pos": pos, "tid": tid, "playlist_id": playlist_id},
        )
    session.execute(text("UPDATE playlists SET updated_at = :now WHERE id = :playlist_id"), {"now": now, "playlist_id": playlist_id})


def is_playlist_followed(user_id: int, playlist_id: int) -> bool:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT 1 FROM user_followed_playlists WHERE user_id = :user_id AND playlist_id = :playlist_id"),
            {"user_id": user_id, "playlist_id": playlist_id},
        ).mappings().first()
        return row is not None


def follow_playlist(user_id: int, playlist_id: int, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return follow_playlist(user_id, playlist_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("""
        SELECT 1
        FROM playlists
        WHERE id = :playlist_id
          AND scope = 'system'
          AND is_active = TRUE
        """),
        {"playlist_id": playlist_id},
    ).mappings().first()
    if not row:
        return False
    result = session.execute(
        text("""
        INSERT INTO user_followed_playlists (user_id, playlist_id, followed_at)
        VALUES (:user_id, :playlist_id, :followed_at)
        ON CONFLICT (user_id, playlist_id) DO NOTHING
        """),
        {"user_id": user_id, "playlist_id": playlist_id, "followed_at": now},
    )
    return result.rowcount > 0


def unfollow_playlist(user_id: int, playlist_id: int, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return unfollow_playlist(user_id, playlist_id, session=s)
    result = session.execute(
        text("DELETE FROM user_followed_playlists WHERE user_id = :user_id AND playlist_id = :playlist_id"),
        {"user_id": user_id, "playlist_id": playlist_id},
    )
    return result.rowcount > 0


def get_playlist_followers_count(playlist_id: int) -> int:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM user_followed_playlists WHERE playlist_id = :playlist_id"),
            {"playlist_id": playlist_id},
        ).mappings().first()
    return int(row["cnt"]) if row else 0


def get_followed_system_playlists(user_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                p.*,
                TRUE AS is_followed,
                ufp.followed_at,
                COALESCE(followers.follower_count, 0)::int AS follower_count
            FROM user_followed_playlists ufp
            JOIN playlists p ON p.id = ufp.playlist_id
            LEFT JOIN (
                SELECT playlist_id, COUNT(*)::int AS follower_count
                FROM user_followed_playlists
                GROUP BY playlist_id
            ) followers ON followers.playlist_id = p.id
            WHERE ufp.user_id = :user_id
              AND p.scope = 'system'
              AND p.is_active = TRUE
            ORDER BY ufp.followed_at DESC
            """),
            {"user_id": user_id},
        ).mappings().all()
        results = [_normalize_playlist_row(row) for row in rows]
        return _attach_artwork_tracks(session, results)


def get_playlist_members(playlist_id: int) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
            SELECT
                pm.playlist_id,
                pm.user_id,
                pm.role,
                pm.invited_by,
                pm.created_at,
                u.username,
                u.name AS display_name,
                u.avatar
            FROM playlist_members pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.playlist_id = :playlist_id
            ORDER BY CASE pm.role WHEN 'owner' THEN 0 ELSE 1 END, pm.created_at ASC
            """),
            {"playlist_id": playlist_id},
        ).mappings().all()
        return [dict(row) for row in rows]


def get_playlist_member(playlist_id: int, user_id: int) -> dict | None:
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT * FROM playlist_members WHERE playlist_id = :playlist_id AND user_id = :user_id"),
            {"playlist_id": playlist_id, "user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def can_view_playlist(playlist: dict | None, user_id: int | None) -> bool:
    if not playlist:
        return False
    if playlist.get("scope") == "system":
        return True
    if playlist.get("visibility") == "public":
        return True
    if user_id is None:
        return False
    if playlist.get("user_id") == user_id:
        return True
    return get_playlist_member(playlist["id"], user_id) is not None


def can_edit_playlist(playlist: dict | None, user_id: int | None) -> bool:
    if not playlist or user_id is None:
        return False
    if playlist.get("scope") == "system":
        return False
    if playlist.get("user_id") == user_id:
        return True
    member = get_playlist_member(playlist["id"], user_id)
    return bool(member and member.get("role") in {"owner", "collab"})


def is_playlist_owner(playlist: dict | None, user_id: int | None) -> bool:
    if not playlist or user_id is None:
        return False
    if playlist.get("user_id") == user_id:
        return True
    member = get_playlist_member(playlist["id"], user_id)
    return bool(member and member.get("role") == "owner")


def add_playlist_member(playlist_id: int, user_id: int, role: str = "collab", invited_by: int | None = None, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return add_playlist_member(playlist_id, user_id, role, invited_by, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text("""
        INSERT INTO playlist_members (playlist_id, user_id, role, invited_by, created_at)
        VALUES (:playlist_id, :user_id, :role, :invited_by, :created_at)
        ON CONFLICT (playlist_id, user_id) DO UPDATE SET
            role = EXCLUDED.role,
            invited_by = COALESCE(EXCLUDED.invited_by, playlist_members.invited_by)
        """),
        {"playlist_id": playlist_id, "user_id": user_id, "role": role, "invited_by": invited_by, "created_at": now},
    )
    return True


def remove_playlist_member(playlist_id: int, user_id: int, *, session=None) -> bool:
    if session is None:
        with transaction_scope() as s:
            return remove_playlist_member(playlist_id, user_id, session=s)
    result = session.execute(
        text("DELETE FROM playlist_members WHERE playlist_id = :playlist_id AND user_id = :user_id"),
        {"playlist_id": playlist_id, "user_id": user_id},
    )
    return result.rowcount > 0


def create_playlist_invite(
    playlist_id: int,
    created_by: int | None,
    *,
    expires_in_hours: int = 168,
    max_uses: int | None = 20,
    session=None,
) -> dict:
    if session is None:
        with transaction_scope() as s:
            return create_playlist_invite(playlist_id, created_by,
                                          expires_in_hours=expires_in_hours,
                                          max_uses=max_uses, session=s)
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(24)
    expires_at = (now.timestamp() + expires_in_hours * 3600) if expires_in_hours > 0 else None
    expires_at_iso = datetime.fromtimestamp(expires_at, timezone.utc).isoformat() if expires_at else None
    row = session.execute(
        text("""
        INSERT INTO playlist_invites (token, playlist_id, created_by, expires_at, max_uses, created_at)
        VALUES (:token, :playlist_id, :created_by, :expires_at, :max_uses, :created_at)
        RETURNING *
        """),
        {"token": token, "playlist_id": playlist_id, "created_by": created_by,
         "expires_at": expires_at_iso, "max_uses": max_uses, "created_at": now.isoformat()},
    ).mappings().first()
    return dict(row)


def consume_playlist_invite(token: str, *, session=None) -> dict | None:
    if session is None:
        with transaction_scope() as s:
            return consume_playlist_invite(token, session=s)
    now = datetime.now(timezone.utc).isoformat()
    row = session.execute(
        text("""
        UPDATE playlist_invites
        SET use_count = use_count + 1
        WHERE token = :token
          AND (expires_at IS NULL OR expires_at > :now)
          AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING *
        """),
        {"token": token, "now": now},
    ).mappings().first()
    return dict(row) if row else None


def get_playlist_filter_options() -> dict:
    with transaction_scope() as session:
        formats = [r["format"] for r in session.execute(
            text("SELECT DISTINCT format FROM library_tracks WHERE format IS NOT NULL AND format != '' ORDER BY format")
        ).mappings().all()]

        keys = [r["audio_key"] for r in session.execute(
            text("SELECT DISTINCT audio_key FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != '' ORDER BY audio_key")
        ).mappings().all()]

        scales = [r["audio_scale"] for r in session.execute(
            text("SELECT DISTINCT audio_scale FROM library_tracks WHERE audio_scale IS NOT NULL AND audio_scale != '' ORDER BY audio_scale")
        ).mappings().all()]

        artists = [r["name"] for r in session.execute(
            text("SELECT name FROM library_artists ORDER BY name")
        ).mappings().all()]

        yr = session.execute(
            text("SELECT MIN(year) AS min_y, MAX(year) AS max_y FROM library_tracks WHERE year IS NOT NULL AND year != ''")
        ).mappings().first()

        bpm = session.execute(
            text("SELECT MIN(bpm) AS min_b, MAX(bpm) AS max_b FROM library_tracks WHERE bpm IS NOT NULL")
        ).mappings().first()

    return {
        "formats": formats,
        "keys": keys,
        "scales": scales,
        "artists": artists,
        "year_range": [yr["min_y"] or "1960", yr["max_y"] or "2026"],
        "bpm_range": [int(bpm["min_b"] or 60), int(bpm["max_b"] or 200)],
    }


_FIELD_COLUMNS: dict[str, str] = {
    "genre": "t.genre",
    "artist": "t.artist",
    "album": "a.name",
    "title": "t.title",
    "year": "t.year",
    "format": "t.format",
    "audio_key": "t.audio_key",
    "bpm": "t.bpm",
    "energy": "t.energy",
    "danceability": "t.danceability",
    "valence": "t.valence",
    "acousticness": "t.acousticness",
    "instrumentalness": "t.instrumentalness",
    "loudness": "t.loudness",
    "dynamic_range": "t.dynamic_range",
    "rating": "t.rating",
    "bit_depth": "t.bit_depth",
    "sample_rate": "t.sample_rate",
    "duration": "t.duration",
    "popularity": "t.popularity",
}

_TEXT_FIELDS = {"genre", "artist", "album", "title", "format", "audio_key"}

_SORT_MAP: dict[str, str] = {
    "random": "RANDOM()",
    # Use the consolidated floating score first; fall back to the raw signals
    # and add a light random tie-breaker to avoid album-sized blocks.
    "popularity": (
        "CASE WHEN t.popularity_score IS NULL AND t.lastfm_playcount IS NULL "
        "AND t.lastfm_listeners IS NULL AND t.popularity IS NULL "
        "THEN 1 ELSE 0 END ASC, "
        "COALESCE(t.popularity_score, -1) DESC, "
        "COALESCE(t.lastfm_playcount, 0) DESC, "
        "COALESCE(t.lastfm_listeners, 0) DESC, "
        "COALESCE(t.lastfm_top_rank, 999999) ASC, "
        "COALESCE(t.popularity, 0) DESC, "
        "RANDOM()"
    ),
    "bpm": "t.bpm ASC NULLS LAST",
    "energy": "t.energy DESC NULLS LAST",
    "title": "t.title ASC",
}


def _combine_sql_extrema(expressions: list[str], mode: str = "greatest") -> str:
    if not expressions:
        return "0.0"
    if len(expressions) == 1:
        return expressions[0]
    fn = "LEAST" if mode == "least" else "GREATEST"
    return f"{fn}({', '.join(expressions)})"


def _build_genre_relevance_expression(values: list[str], params: dict, next_param) -> str:
    per_value_scores: list[str] = []

    for raw_value in values:
        value = raw_value.strip()
        if not value:
            continue

        p_track = next_param("g")
        p_album = next_param("g")
        p_artist = next_param("g")
        pattern = f"%{value}%"
        params[p_track] = pattern
        params[p_album] = pattern
        params[p_artist] = pattern

        per_value_scores.append(
            f"""GREATEST(
                CASE WHEN t.genre ILIKE :{p_track} THEN 1.0 ELSE 0.0 END,
                COALESCE((
                    SELECT MAX(ag.weight)
                    FROM album_genres ag
                    JOIN genres g ON g.id = ag.genre_id
                    WHERE ag.album_id = a.id
                      AND (g.name ILIKE :{p_album} OR g.slug ILIKE :{p_album})
                ), 0.0),
                COALESCE((
                    SELECT MAX(arg.weight)
                    FROM artist_genres arg
                    JOIN genres g ON g.id = arg.genre_id
                    WHERE arg.artist_name = t.artist
                      AND (g.name ILIKE :{p_artist} OR g.slug ILIKE :{p_artist})
                ), 0.0)
            )"""
        )

    return _combine_sql_extrema(per_value_scores, mode="greatest")


def execute_smart_rules(rules: dict, *, count_only: bool = False) -> list[dict] | int:
    """Execute smart playlist rules against the library DB.

    When count_only=True, returns an int (total matching tracks).
    Otherwise returns the track list capped by limit.
    """
    match_mode = rules.get("match", "all")
    rule_list = rules.get("rules", [])
    limit = rules.get("limit", 50)
    sort = rules.get("sort", "random")
    deduplicate_artist = rules.get("deduplicate_artist", False)
    max_per_artist = rules.get("max_per_artist", 3)

    conditions: list[str] = []
    genre_score_exprs: list[str] = []
    params: dict = {}
    param_idx = 0

    def _next(prefix: str = "p") -> str:
        nonlocal param_idx
        param_idx += 1
        return f"{prefix}_{param_idx}"

    def _split_pipe(val: str) -> list[str]:
        return [v.strip() for v in val.split("|") if v.strip()]

    for rule in rule_list:
        field = rule.get("field", "")
        op = rule.get("op", "")
        value = rule.get("value")
        col = _FIELD_COLUMNS.get(field)
        if not col:
            continue

        # Special case: genre contains uses album/artist weighted genre profiles
        # and direct track tags to compute a relevance score.
        if field == "genre" and op == "contains":
            vals = _split_pipe(value) if isinstance(value, str) and "|" in value else [str(value)]
            score_expr = _build_genre_relevance_expression(vals, params, _next)
            conditions.append(f"({score_expr}) > 0")
            genre_score_exprs.append(score_expr)
            continue

        # Pipe-delimited multi-value → IN
        if isinstance(value, str) and "|" in value and op in ("eq", "contains"):
            vals = _split_pipe(value)
            pnames = []
            for v in vals:
                p = _next("v")
                params[p] = v
                pnames.append(f":{p}")
            conditions.append(f"{col} IN ({','.join(pnames)})")
            continue

        # Generic operator handling
        if op == "eq":
            p = _next("v")
            if field in _TEXT_FIELDS:
                conditions.append(f"{col} ILIKE :{p}")
                params[p] = str(value)
            else:
                conditions.append(f"{col} = :{p}")
                params[p] = value
        elif op == "neq":
            p = _next("v")
            conditions.append(f"{col} != :{p}")
            params[p] = value
        elif op == "contains":
            p = _next("v")
            conditions.append(f"{col} ILIKE :{p}")
            params[p] = f"%{value}%"
        elif op == "not_contains":
            p = _next("v")
            conditions.append(f"{col} NOT ILIKE :{p}")
            params[p] = f"%{value}%"
        elif op == "gte":
            p = _next("v")
            conditions.append(f"{col} >= :{p}")
            params[p] = value
        elif op == "lte":
            p = _next("v")
            conditions.append(f"{col} <= :{p}")
            params[p] = value
        elif op == "between" and isinstance(value, list) and len(value) >= 2:
            p1, p2 = _next("lo"), _next("hi")
            conditions.append(f"{col} BETWEEN :{p1} AND :{p2}")
            params[p1] = value[0]
            params[p2] = value[1]
        elif op == "in" and isinstance(value, list):
            pnames = []
            for v in value:
                p = _next("v")
                params[p] = v
                pnames.append(f":{p}")
            if pnames:
                conditions.append(f"{col} IN ({','.join(pnames)})")

    joiner = " AND " if match_mode == "all" else " OR "
    where = joiner.join(conditions) if conditions else "1=1"

    if count_only:
        query = f"""
            SELECT COUNT(*) AS cnt
            FROM library_tracks t
            LEFT JOIN library_albums a ON t.album_id = a.id
            LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
            WHERE {where}
        """
        with transaction_scope() as session:
            row = session.execute(text(query), params).mappings().first()
        return row["cnt"] if row else 0

    sort_clause = _SORT_MAP.get(sort, "RANDOM()")
    if genre_score_exprs:
        genre_relevance = _combine_sql_extrema(
            genre_score_exprs,
            mode="least" if match_mode == "all" else "greatest",
        )
        sort_clause = f"{genre_relevance} DESC, {sort_clause}"
    fetch_limit = limit * 3 if deduplicate_artist else limit
    params["lim"] = fetch_limit

    query = f"""
        SELECT t.id, t.storage_id::text, t.path, t.title, t.artist, a.name AS album,
               t.duration, t.format, t.bpm, t.energy, t.genre,
               a.id AS album_id, a.slug AS album_slug,
               a_artist.id AS artist_id, a_artist.slug AS artist_slug
        FROM library_tracks t
        LEFT JOIN library_albums a ON t.album_id = a.id
        LEFT JOIN library_artists a_artist ON t.artist = a_artist.name
        WHERE {where}
        ORDER BY {sort_clause}
        LIMIT :lim
    """

    with transaction_scope() as session:
        rows = session.execute(text(query), params).mappings().all()

    results = [dict(r) for r in rows]

    if deduplicate_artist and max_per_artist > 0:
        artist_counts: dict[str, int] = {}
        deduped: list[dict] = []
        for track in results:
            artist = track.get("artist", "")
            count = artist_counts.get(artist, 0)
            if count < max_per_artist:
                deduped.append(track)
                artist_counts[artist] = count + 1
                if len(deduped) >= limit:
                    break
        return deduped

    return results[:limit]


# ── Smart playlist generators ─────────────────────────────────────

def generate_by_genre(genre: str, limit: int = 50) -> list[int]:
    params = {"genre": f"%{genre.strip()}%", "lim": limit}
    genre_relevance = """GREATEST(
        CASE WHEN g.name ILIKE :genre OR g.slug ILIKE :genre THEN COALESCE(ag.weight, 0.0) ELSE 0.0 END,
        COALESCE((
            SELECT MAX(arg.weight)
            FROM artist_genres arg
            JOIN genres g2 ON g2.id = arg.genre_id
            WHERE arg.artist_name = t.artist
              AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
        ), 0.0),
        CASE WHEN t.genre ILIKE :genre THEN 1.0 ELSE 0.0 END
    )"""
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT
                t.id,
                MAX(""" + genre_relevance + """) AS genre_relevance,
                MAX(COALESCE(t.popularity_score, -1)) AS popularity_score
            FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            LEFT JOIN album_genres ag ON ag.album_id = a.id
            LEFT JOIN genres g ON g.id = ag.genre_id
            WHERE (
                (g.name ILIKE :genre OR g.slug ILIKE :genre)
                OR t.genre ILIKE :genre
                OR EXISTS (
                    SELECT 1
                    FROM artist_genres arg
                    JOIN genres g2 ON g2.id = arg.genre_id
                    WHERE arg.artist_name = t.artist
                      AND (g2.name ILIKE :genre OR g2.slug ILIKE :genre)
                )
            )
            GROUP BY t.id
            ORDER BY genre_relevance DESC,
                     popularity_score DESC,
                     RANDOM()
            LIMIT :lim
        """), params).mappings().all()
        return [r["id"] for r in rows]


def generate_by_decade(decade: int, limit: int = 50) -> list[int]:
    year_start = str(decade)
    year_end = str(decade + 9)
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id FROM library_tracks t
            JOIN library_albums a ON a.id = t.album_id
            WHERE a.year >= :year_start AND a.year <= :year_end
            ORDER BY RANDOM()
            LIMIT :lim
        """), {"year_start": year_start, "year_end": year_end, "lim": limit}).mappings().all()
        return [r["id"] for r in rows]


def generate_by_artist(artist_name: str, limit: int = 50) -> list[int]:
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id FROM library_tracks t
            WHERE t.artist = :artist
            ORDER BY t.album_id, t.track_number
            LIMIT :lim
        """), {"artist": artist_name, "lim": limit}).mappings().all()
        return [r["id"] for r in rows]


def generate_similar_artists(similar_names: list[str], limit: int = 50) -> list[int]:
    if not similar_names:
        return []
    with transaction_scope() as session:
        rows = session.execute(text("""
            SELECT t.id FROM library_tracks t
            WHERE t.artist = ANY(:names)
            ORDER BY RANDOM()
            LIMIT :lim
        """), {"names": similar_names, "lim": limit}).mappings().all()
        return [r["id"] for r in rows]


def generate_random(limit: int = 50) -> list[int]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT id FROM library_tracks ORDER BY RANDOM() LIMIT :lim"),
            {"lim": limit},
        ).mappings().all()
        return [r["id"] for r in rows]


# ── Generation log ────────────────────────────────────────────────

def log_generation_start(playlist_id: int, rules: dict | None, triggered_by: str = "manual") -> int:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        row = session.execute(
            text("""
                INSERT INTO playlist_generation_log (playlist_id, started_at, status, rule_snapshot_json, triggered_by)
                VALUES (:pid, :now, 'running', :rules, :triggered_by)
                RETURNING id
            """),
            {"pid": playlist_id, "now": now,
             "rules": json.dumps(rules, default=str) if rules else None,
             "triggered_by": triggered_by},
        ).mappings().first()
    return row["id"] if row else 0


def log_generation_complete(log_id: int, track_count: int, duration_sec: int):
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE playlist_generation_log
                SET status = 'completed', completed_at = :now, track_count = :tc, duration_sec = :dur
                WHERE id = :id
            """),
            {"id": log_id, "now": now, "tc": track_count, "dur": duration_sec},
        )


def log_generation_failed(log_id: int, error: str):
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        session.execute(
            text("""
                UPDATE playlist_generation_log
                SET status = 'failed', completed_at = :now, error = :error
                WHERE id = :id
            """),
            {"id": log_id, "now": now, "error": error[:500]},
        )


def get_generation_history(playlist_id: int, limit: int = 5) -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("""
                SELECT * FROM playlist_generation_log
                WHERE playlist_id = :pid
                ORDER BY started_at DESC LIMIT :lim
            """),
            {"pid": playlist_id, "lim": limit},
        ).mappings().all()
    results = []
    for r in rows:
        d = dict(r)
        snap = d.pop("rule_snapshot_json", None)
        d["rule_snapshot"] = snap if isinstance(snap, dict) else (json.loads(snap) if snap else None)
        for key in ("started_at", "completed_at"):
            if hasattr(d.get(key), "isoformat"):
                d[key] = d[key].isoformat()
        results.append(d)
    return results


def set_generation_status(playlist_id: int, status: str, error: str | None = None):
    now = datetime.now(timezone.utc).isoformat()
    updates = ["generation_status = :status", "updated_at = :now"]
    params: dict = {"pid": playlist_id, "status": status, "now": now}
    if status == "idle":
        updates.append("last_generated_at = :now")
        updates.append("generation_error = NULL")
    elif status == "failed" and error:
        updates.append("generation_error = :error")
        params["error"] = error[:500]
    with transaction_scope() as session:
        session.execute(
            text(f"UPDATE playlists SET {', '.join(updates)} WHERE id = :pid"),
            params,
        )


def get_smart_playlists_for_refresh() -> list[dict]:
    """Get smart system playlists eligible for scheduled regeneration."""
    with transaction_scope() as session:
        rows = session.execute(
            text("""
                SELECT * FROM playlists
                WHERE scope = 'system'
                  AND generation_mode = 'smart'
                  AND is_active = TRUE
                  AND auto_refresh_enabled = TRUE
                  AND (last_generated_at IS NULL OR last_generated_at < now() - interval '24 hours')
                ORDER BY last_generated_at NULLS FIRST
            """)
        ).mappings().all()
    return [_normalize_playlist_row(r) for r in rows]


def duplicate_playlist(playlist_id: int, *, session=None) -> dict | None:
    """Duplicate a playlist (metadata + rules, not tracks for smart)."""
    if session is None:
        with transaction_scope() as s:
            return duplicate_playlist(playlist_id, session=s)

    original = session.execute(
        text("SELECT * FROM playlists WHERE id = :id"), {"id": playlist_id}
    ).mappings().first()
    if not original:
        return None

    orig = dict(original)
    now = datetime.now(timezone.utc).isoformat()
    new_name = f"{orig.get('name', 'Playlist')} (Copy)"

    row = session.execute(
        text("""
            INSERT INTO playlists (name, description, scope, user_id, managed_by_user_id,
                is_smart, generation_mode, smart_rules_json, is_curated, is_active,
                category, featured_rank, visibility, auto_refresh_enabled,
                created_at, updated_at)
            VALUES (:name, :desc, :scope, :uid, :managed,
                :smart, :mode, :rules, :curated, :active,
                :cat, :rank, :vis, :refresh,
                :now, :now)
            RETURNING id
        """),
        {
            "name": new_name, "desc": orig.get("description"),
            "scope": orig.get("scope", "system"), "uid": orig.get("user_id"),
            "managed": orig.get("managed_by_user_id"),
            "smart": orig.get("is_smart", False), "mode": orig.get("generation_mode", "static"),
            "rules": orig.get("smart_rules_json"),
            "curated": orig.get("is_curated", False), "active": False,
            "cat": orig.get("category"), "rank": None,
            "vis": orig.get("visibility", "public"), "refresh": orig.get("auto_refresh_enabled", True),
            "now": now,
        },
    ).mappings().first()

    if not row:
        return None
    new_id = row["id"]

    # For static playlists, also duplicate tracks
    if orig.get("generation_mode") != "smart":
        session.execute(
            text("""
                INSERT INTO playlist_tracks (playlist_id, track_id, track_path, track_storage_id,
                    title, artist, album, duration, position, added_at)
                SELECT :new_id, track_id, track_path, track_storage_id,
                    title, artist, album, duration, position, :now
                FROM playlist_tracks WHERE playlist_id = :old_id
                ORDER BY position
            """),
            {"new_id": new_id, "old_id": playlist_id, "now": now},
        )
        session.execute(
            text("""
                UPDATE playlists SET track_count = (
                    SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :id
                ) WHERE id = :id
            """),
            {"id": new_id},
        )

    new_playlist = session.execute(
        text("SELECT * FROM playlists WHERE id = :id"), {"id": new_id}
    ).mappings().first()
    return _normalize_playlist_row(new_playlist) if new_playlist else None
