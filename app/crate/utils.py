"""Shared constants and utilities."""

import re
import unicodedata
from datetime import datetime, timezone

PHOTO_NAMES = {"artist.jpg", "artist.png", "photo.jpg"}

AUDIO_EXTENSIONS = {".flac", ".mp3", ".m4a", ".ogg", ".opus"}

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"]


def init_musicbrainz():
    """Set MusicBrainz user agent once."""
    import musicbrainzngs
    musicbrainzngs.set_useragent("crate", "1.0", "https://github.com/crate")


def normalize_key(name: str) -> str:
    """Normalize a name for case-insensitive, unicode-safe comparison."""
    name = unicodedata.normalize("NFC", name.lower().strip())
    for ch in "\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d":
        name = name.replace(ch, "-")
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"-+", "-", name)
    return name


def to_datetime(value) -> datetime | None:
    """Normalize a DB/date-ish value to a timezone-aware datetime.

    After the TIMESTAMPTZ migration, psycopg2 returns datetime objects for
    TIMESTAMPTZ/TIMESTAMP columns. Older code that called
    ``datetime.fromisoformat(row["updated_at"])`` now raises TypeError. Use
    this helper instead — it accepts datetime, str or None and always returns
    a timezone-aware datetime (or None on failure).
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return None
