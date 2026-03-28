from datetime import datetime, timezone

from crate.db.core import get_db_ctx


# ── Follows ──────────────────────────────────────────────────

def follow_artist(user_id: int, artist_name: str) -> bool:
    """Follow an artist. Returns True if newly followed."""
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO user_follows (user_id, artist_name, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, artist_name, now))
        return cur.rowcount > 0


def unfollow_artist(user_id: int, artist_name: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM user_follows WHERE user_id = %s AND artist_name = %s", (user_id, artist_name))
        return cur.rowcount > 0


def get_followed_artists(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT uf.artist_name, uf.created_at, la.album_count, la.track_count, la.has_photo
            FROM user_follows uf
            LEFT JOIN library_artists la ON la.name = uf.artist_name
            WHERE uf.user_id = %s
            ORDER BY uf.created_at DESC
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]


def is_following(user_id: int, artist_name: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM user_follows WHERE user_id = %s AND artist_name = %s", (user_id, artist_name))
        return cur.fetchone() is not None


# ── Saved Albums ─────────────────────────────────────────────

def save_album(user_id: int, album_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO user_saved_albums (user_id, album_id, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, album_id, now))
        return cur.rowcount > 0


def unsave_album(user_id: int, album_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM user_saved_albums WHERE user_id = %s AND album_id = %s", (user_id, album_id))
        return cur.rowcount > 0


def get_saved_albums(user_id: int) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT usa.created_at AS saved_at, la.id, la.artist, la.name, la.year, la.has_cover, la.track_count, la.total_duration
            FROM user_saved_albums usa
            JOIN library_albums la ON la.id = usa.album_id
            WHERE usa.user_id = %s
            ORDER BY usa.created_at DESC
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]


def is_album_saved(user_id: int, album_id: int) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM user_saved_albums WHERE user_id = %s AND album_id = %s", (user_id, album_id))
        return cur.fetchone() is not None


# ── Liked Tracks ─────────────────────────────────────────────

def like_track(user_id: int, track_path: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO user_liked_tracks (user_id, track_path, created_at) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user_id, track_path, now))
        return cur.rowcount > 0


def unlike_track(user_id: int, track_path: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM user_liked_tracks WHERE user_id = %s AND track_path = %s", (user_id, track_path))
        return cur.rowcount > 0


def get_liked_tracks(user_id: int, limit: int = 100) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT ult.track_path, ult.created_at AS liked_at,
                   lt.title, lt.artist, lt.album, lt.duration, lt.navidrome_id
            FROM user_liked_tracks ult
            LEFT JOIN library_tracks lt ON lt.path = ult.track_path
            WHERE ult.user_id = %s
            ORDER BY ult.created_at DESC
            LIMIT %s
        """, (user_id, limit))
        return [dict(r) for r in cur.fetchall()]


def is_track_liked(user_id: int, track_path: str) -> bool:
    with get_db_ctx() as cur:
        cur.execute("SELECT 1 FROM user_liked_tracks WHERE user_id = %s AND track_path = %s", (user_id, track_path))
        return cur.fetchone() is not None


# ── Play History ─────────────────────────────────────────────

def record_play(user_id: int, track_path: str, title: str = "", artist: str = "", album: str = ""):
    now = datetime.now(timezone.utc).isoformat()
    with get_db_ctx() as cur:
        cur.execute(
            "INSERT INTO play_history (user_id, track_path, title, artist, album, played_at) VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, track_path, title, artist, album, now))


def get_play_history(user_id: int, limit: int = 50) -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT track_path, title, artist, album, played_at
            FROM play_history
            WHERE user_id = %s
            ORDER BY played_at DESC
            LIMIT %s
        """, (user_id, limit))
        return [dict(r) for r in cur.fetchall()]


def get_play_stats(user_id: int) -> dict:
    """Get listening stats for a user."""
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS total_plays FROM play_history WHERE user_id = %s", (user_id,))
        total = cur.fetchone()["total_plays"]
        cur.execute("""
            SELECT artist, COUNT(*) AS plays FROM play_history
            WHERE user_id = %s GROUP BY artist ORDER BY plays DESC LIMIT 10
        """, (user_id,))
        top_artists = [dict(r) for r in cur.fetchall()]
    return {"total_plays": total, "top_artists": top_artists}


# ── User Library Summary ─────────────────────────────────────

def get_user_library_counts(user_id: int) -> dict:
    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM user_follows WHERE user_id = %s", (user_id,))
        follows = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM user_saved_albums WHERE user_id = %s", (user_id,))
        albums = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM user_liked_tracks WHERE user_id = %s", (user_id,))
        likes = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) AS c FROM playlists WHERE user_id = %s", (user_id,))
        playlists = cur.fetchone()["c"]
    return {"followed_artists": follows, "saved_albums": albums, "liked_tracks": likes, "playlists": playlists}
