import json
from datetime import date, datetime
from pathlib import Path

from crate.config import load_config
from crate.db.repositories.library import enrich_track_refs, get_library_album_by_id, get_library_artist_by_id

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png", "album.jpg", "album.png"]


class DateTimeEncoder(json.JSONEncoder):
    """JSON encoder that handles datetime/date from TIMESTAMPTZ columns."""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, date):
            return obj.isoformat()
        return super().default(obj)


def json_dumps(obj, **kwargs) -> str:
    """json.dumps with datetime support. Use instead of json.dumps for DB data."""
    return json.dumps(obj, cls=DateTimeEncoder, ensure_ascii=False, **kwargs)


def coerce_date(value) -> date | None:
    """Normalize a DB/date-ish value to a datetime.date, returning None on failure.

    Needed after the TIMESTAMPTZ migration: DATE columns return datetime.date
    and TIMESTAMPTZ columns return datetime.datetime from psycopg2. Legacy
    code that did str slicing or strptime on those values now crashes.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


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
    if not tracks:
        return []

    track_ids = [track.get("track_id") for track in tracks if track.get("track_id") is not None]
    refs_by_track_id = enrich_track_refs(track_ids) if track_ids else {}

    enriched: list[dict] = []
    for track in tracks:
        current = dict(track)
        ref = refs_by_track_id.get(track.get("track_id"))
        if ref:
            current.setdefault("track_storage_id", ref.get("track_storage_id"))
            current.setdefault("track_slug", ref.get("track_slug"))
            current.setdefault("album_id", ref.get("album_id"))
            current.setdefault("album_slug", ref.get("album_slug"))
            current.setdefault("artist_id", ref.get("artist_id"))
            current.setdefault("artist_slug", ref.get("artist_slug"))
        enriched.append(current)
    return enriched


def artist_name_from_id(artist_id: int) -> str | None:
    artist = get_library_artist_by_id(artist_id)
    return artist["name"] if artist else None


def album_names_from_id(album_id: int) -> tuple[str, str] | None:
    album = get_library_album_by_id(album_id)
    if not album:
        return None
    return album["artist"], album["name"]
