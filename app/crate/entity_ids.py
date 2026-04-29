from __future__ import annotations

import re
import unicodedata
import uuid


_ROOT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "crate:entity-uids:v1")
_ARTIST_NAMESPACE = uuid.uuid5(_ROOT_NAMESPACE, "artist")
_ALBUM_NAMESPACE = uuid.uuid5(_ROOT_NAMESPACE, "album")
_TRACK_NAMESPACE = uuid.uuid5(_ROOT_NAMESPACE, "track")
_GENRE_NAMESPACE = uuid.uuid5(_ROOT_NAMESPACE, "genre")
_GENRE_TAXONOMY_NAMESPACE = uuid.uuid5(_ROOT_NAMESPACE, "genre-taxonomy")

_WS_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^0-9a-z]+")


def _normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_value = ascii_value.casefold()
    return _WS_RE.sub(" ", _NON_ALNUM_RE.sub(" ", ascii_value)).strip()


def _normalize_identifier(value: str | None) -> str:
    return _normalize_text(value).replace(" ", "")


def _uuid5(namespace: uuid.UUID, payload: str) -> uuid.UUID:
    return uuid.uuid5(namespace, payload)


def artist_entity_uid(*, name: str, mbid: str | None = None) -> uuid.UUID:
    canonical_mbid = _normalize_identifier(mbid)
    if canonical_mbid:
        return _uuid5(_ARTIST_NAMESPACE, f"mbid:{canonical_mbid}")
    return _uuid5(_ARTIST_NAMESPACE, f"name:{_normalize_text(name)}")


def album_entity_uid(
    *,
    artist_name: str = "",
    artist_uid: str | uuid.UUID | None = None,
    album_name: str = "",
    year: str | None = None,
    musicbrainz_albumid: str | None = None,
    musicbrainz_releasegroupid: str | None = None,
    tag_album: str | None = None,
) -> uuid.UUID:
    releasegroup_id = _normalize_identifier(musicbrainz_releasegroupid)
    if releasegroup_id:
        return _uuid5(_ALBUM_NAMESPACE, f"mb-releasegroup:{releasegroup_id}")

    album_id = _normalize_identifier(musicbrainz_albumid)
    if album_id:
        return _uuid5(_ALBUM_NAMESPACE, f"mb-album:{album_id}")

    parent = (
        f"artist-uid:{str(artist_uid)}"
        if artist_uid
        else f"artist-name:{_normalize_text(artist_name)}"
    )
    return _uuid5(
        _ALBUM_NAMESPACE,
        "|".join(
            [
                parent,
                f"album:{_normalize_text(album_name or tag_album)}",
                f"tag:{_normalize_text(tag_album or album_name)}",
                f"year:{_normalize_text(year)}",
            ]
        ),
    )


def track_entity_uid(
    *,
    album_uid: str | uuid.UUID | None = None,
    artist_name: str = "",
    album_name: str = "",
    title: str | None = None,
    filename: str | None = None,
    disc_number: int | None = None,
    track_number: int | None = None,
    musicbrainz_trackid: str | None = None,
    musicbrainz_albumid: str | None = None,
) -> uuid.UUID:
    track_id = _normalize_identifier(musicbrainz_trackid)
    if track_id:
        return _uuid5(_TRACK_NAMESPACE, f"mb-track:{track_id}")

    parent = (
        f"album-uid:{str(album_uid)}"
        if album_uid
        else "|".join(
            [
                f"artist-name:{_normalize_text(artist_name)}",
                f"album:{_normalize_text(album_name)}",
                f"mb-album:{_normalize_identifier(musicbrainz_albumid)}",
            ]
        )
    )
    return _uuid5(
        _TRACK_NAMESPACE,
        "|".join(
            [
                parent,
                f"disc:{int(disc_number or 1)}",
                f"track:{int(track_number or 0)}",
                f"title:{_normalize_text(title)}",
                f"file:{_normalize_text(filename)}",
            ]
        ),
    )


def genre_entity_uid(*, name: str = "", slug: str | None = None) -> uuid.UUID:
    canonical_slug = _normalize_text(slug).replace(" ", "-")
    if canonical_slug:
        return _uuid5(_GENRE_NAMESPACE, f"slug:{canonical_slug}")
    return _uuid5(_GENRE_NAMESPACE, f"name:{_normalize_text(name)}")


def genre_taxonomy_entity_uid(
    *,
    slug: str = "",
    name: str | None = None,
    musicbrainz_mbid: str | None = None,
) -> uuid.UUID:
    canonical_mbid = _normalize_identifier(musicbrainz_mbid)
    if canonical_mbid:
        return _uuid5(_GENRE_TAXONOMY_NAMESPACE, f"mbid:{canonical_mbid}")

    canonical_slug = _normalize_text(slug).replace(" ", "-")
    if canonical_slug:
        return _uuid5(_GENRE_TAXONOMY_NAMESPACE, f"slug:{canonical_slug}")
    return _uuid5(_GENRE_TAXONOMY_NAMESPACE, f"name:{_normalize_text(name)}")


__all__ = [
    "album_entity_uid",
    "artist_entity_uid",
    "genre_entity_uid",
    "genre_taxonomy_entity_uid",
    "track_entity_uid",
]
