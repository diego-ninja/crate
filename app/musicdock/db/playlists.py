import json
from datetime import datetime, timezone
from musicdock.db.core import get_db_ctx

# ── Playlists ────────────────────────────────────────────────────

def create_playlist(name: str, description: str = "", user_id: int | None = None,
                    is_smart: bool = False, smart_rules: dict | None = None) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO playlists (name, description, user_id, is_smart, smart_rules_json, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (name, description, user_id, is_smart,
             json.dumps(smart_rules) if smart_rules else None, now, now),
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
        d = dict(r)
        rules = d.pop("smart_rules_json", None)
        d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
        results.append(d)
    return results


def get_playlist(playlist_id: int) -> dict | None:
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM playlists WHERE id = %s", (playlist_id,))
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    rules = d.pop("smart_rules_json", None)
    d["smart_rules"] = rules if isinstance(rules, dict) else (json.loads(rules) if rules else None)
    return d


def update_playlist(playlist_id: int, **kwargs):
    now = datetime.now(timezone.utc).isoformat()
    fields = ["updated_at = %s"]
    values: list = [now]
    for key in ("name", "description"):
        if key in kwargs:
            fields.append(f"{key} = %s")
            values.append(kwargs[key])
    if "smart_rules" in kwargs:
        fields.append("smart_rules_json = %s")
        values.append(json.dumps(kwargs["smart_rules"]))
    values.append(playlist_id)
    with get_db_ctx() as cur:
        cur.execute(f"UPDATE playlists SET {', '.join(fields)} WHERE id = %s", values)


def delete_playlist(playlist_id: int):
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlists WHERE id = %s", (playlist_id,))


def get_playlist_tracks(playlist_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM playlist_tracks WHERE playlist_id = %s ORDER BY position",
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


