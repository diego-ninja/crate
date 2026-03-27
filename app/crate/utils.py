"""Shared constants and utilities."""

import re
import unicodedata

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
