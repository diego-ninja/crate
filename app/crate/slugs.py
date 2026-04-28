import re
import unicodedata


_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str | None, fallback: str = "item") -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = _NON_ALNUM_RE.sub("-", ascii_value).strip("-")
    return slug or fallback


def build_artist_slug(name: str | None) -> str:
    return slugify(name, "artist")


def build_album_slug(artist_name: str | None, album_name: str | None) -> str:
    return slugify(f"{artist_name or ''}-{album_name or ''}", "album")


def build_public_album_slug(album_name: str | None) -> str:
    return slugify(album_name, "album")


def build_track_slug(artist_name: str | None, title: str | None, filename: str | None = None) -> str:
    return slugify(f"{artist_name or ''}-{title or filename or ''}", "track")
