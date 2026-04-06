from pathlib import Path

from crate.config import load_config

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png", "album.jpg", "album.png"]


def get_config() -> dict:
    return load_config()


def library_path() -> Path:
    return Path(get_config()["library_path"])


def extensions() -> set[str]:
    return set(get_config().get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))


def exclude_dirs() -> set[str]:
    return set(get_config().get("exclude_dirs", ["music"]))


def safe_path(base: Path, user_path: str) -> Path | None:
    resolved = (base / user_path).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        return None
    return resolved


def enrich_radio_tracks(tracks: list[dict]) -> list[dict]:
    from crate.db import get_db_ctx

    if not tracks:
        return []

    track_ids = [track.get("track_id") for track in tracks if track.get("track_id") is not None]
    refs_by_track_id: dict[int, dict] = {}
    if track_ids:
        with get_db_ctx() as cur:
            cur.execute(
                """
                SELECT
                    t.id AS track_id,
                    t.slug AS track_slug,
                    a.id AS album_id,
                    a.slug AS album_slug,
                    ar.id AS artist_id,
                    ar.slug AS artist_slug
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                LEFT JOIN library_artists ar ON ar.name = a.artist
                WHERE t.id = ANY(%s)
                """,
                (track_ids,),
            )
            refs_by_track_id = {row["track_id"]: dict(row) for row in cur.fetchall()}

    enriched: list[dict] = []
    for track in tracks:
        current = dict(track)
        ref = refs_by_track_id.get(track.get("track_id"))
        if ref:
            current.setdefault("track_slug", ref.get("track_slug"))
            current.setdefault("album_id", ref.get("album_id"))
            current.setdefault("album_slug", ref.get("album_slug"))
            current.setdefault("artist_id", ref.get("artist_id"))
            current.setdefault("artist_slug", ref.get("artist_slug"))
        enriched.append(current)
    return enriched


def artist_name_from_id(artist_id: int) -> str | None:
    from crate.db import get_library_artist_by_id
    artist = get_library_artist_by_id(artist_id)
    return artist["name"] if artist else None


def album_names_from_id(album_id: int) -> tuple[str, str] | None:
    from crate.db import get_library_album_by_id
    album = get_library_album_by_id(album_id)
    if not album:
        return None
    return album["artist"], album["name"]
