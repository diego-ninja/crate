"""Worker-only resolution of original artwork sources."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import mutagen
import requests

from crate.artist_hero_publication import (
    ArtistHeroArtifactIdentity,
    artist_hero_artifact_source_path,
)
from crate.artwork_variants import ArtworkAsset
from crate.audio import get_audio_files
from crate.config import load_config
from crate.db.repositories.library import (
    get_library_album_by_entity_uid,
    get_library_artist,
    get_library_artist_by_entity_uid,
)
from crate.db.queries.genres_taxonomy import get_genre_taxonomy_cover_path
from crate.external_artist_artwork import external_artist_artwork_path_from_key
from crate.genre_covers import genre_cover_abspath
from crate.release_covers import release_cover_abspath
from crate.storage_layout import resolve_album_dir, resolve_artist_dir
from crate.utils import COVER_NAMES, PHOTO_NAMES

ARTIST_PHOTO_NAMES = tuple(sorted(PHOTO_NAMES))
_MAX_SOURCE_BYTES = 25 * 1024 * 1024

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def library_path() -> Path:
    return Path(load_config()["library_path"])


def extensions() -> set[str]:
    return set(
        load_config().get(
            "audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]
        )
    )


@dataclass(frozen=True)
class ArtworkSource:
    content: bytes
    media_type: str
    origin: str


def _file_source(path: Path) -> ArtworkSource | None:
    try:
        if not path.is_file():
            return None
        if path.stat().st_size > _MAX_SOURCE_BYTES:
            return None
        return ArtworkSource(
            content=path.read_bytes(),
            media_type=_MEDIA_TYPES.get(
                path.suffix.lower(), "application/octet-stream"
            ),
            origin="local-file",
        )
    except OSError:
        return None


def extract_embedded_artwork(audio_file: Path) -> tuple[bytes, str] | None:
    try:
        audio = getattr(mutagen, "File")(audio_file)
    except Exception:
        return None
    if audio is None:
        return None

    pictures = getattr(audio, "pictures", None)
    if pictures:
        picture = pictures[0]
        return picture.data, picture.mime

    tags = getattr(audio, "tags", None)
    if not tags:
        return None
    try:
        keys = list(tags.keys()) if hasattr(tags, "keys") else list(tags)
    except Exception:
        return None
    for key in keys:
        if not isinstance(key, str) or not key.startswith("APIC"):
            continue
        frame = tags.get(key) if hasattr(tags, "get") else tags[key]
        data = getattr(frame, "data", None)
        if data:
            return data, getattr(frame, "mime", None) or "image/jpeg"
    return None


def _album_source(asset: ArtworkAsset) -> ArtworkSource | None:
    album = get_library_album_by_entity_uid(asset.entity_key)
    if not album:
        return None
    artist = get_library_artist(str(album.get("artist") or ""))
    album_dir = resolve_album_dir(library_path(), album, artist=artist)
    if album_dir is None or not album_dir.is_dir():
        return None
    for cover_name in COVER_NAMES:
        source = _file_source(album_dir / cover_name)
        if source is not None:
            return source
    for track in get_audio_files(album_dir, extensions()):
        embedded = extract_embedded_artwork(track)
        if embedded is not None:
            content, media_type = embedded
            return ArtworkSource(content, media_type, "embedded")
    return None


def _fetch_artist_photo_provider(name: str) -> tuple[bytes, str] | None:
    try:
        from crate.lastfm import get_best_artist_image

        content = get_best_artist_image(name)
        return (content, "image/jpeg") if content else None
    except Exception:
        return None


def _fetch_artist_background_provider(name: str) -> tuple[bytes, str] | None:
    try:
        from crate.lastfm import (
            download_artist_image,
            get_fanart_all_images,
            get_lastfm_best_background,
        )

        fanart = get_fanart_all_images(name) or {}
        backgrounds = fanart.get("backgrounds") or []
        if backgrounds:
            content = download_artist_image(backgrounds[0], timeout=10)
            if content:
                return content, "image/jpeg"
        content = get_lastfm_best_background(name)
        return (content, "image/jpeg") if content else None
    except Exception:
        return None


def _artist_source(
    asset: ArtworkAsset, *, allow_provider: bool
) -> ArtworkSource | None:
    artist = get_library_artist_by_entity_uid(asset.entity_key)
    if not artist:
        return None
    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if artist_dir is None or not artist_dir.is_dir():
        return None

    artist_name = str(artist.get("name") or "")
    if asset.kind == "artist-background":
        background = _file_source(artist_dir / "background.jpg")
        if background is not None:
            return background
        for photo_name in ARTIST_PHOTO_NAMES:
            photo = _file_source(artist_dir / photo_name)
            if photo is not None:
                return photo
        if not allow_provider:
            return None
        provider = _fetch_artist_background_provider(artist_name)
        return ArtworkSource(*provider, "provider") if provider else None
    for photo_name in ARTIST_PHOTO_NAMES:
        source = _file_source(artist_dir / photo_name)
        if source is not None:
            return source

    for album_dir in sorted(artist_dir.iterdir()):
        if not album_dir.is_dir() or album_dir.name.startswith("."):
            continue
        for cover_name in COVER_NAMES:
            source = _file_source(album_dir / cover_name)
            if source is not None:
                return source
        tracks = get_audio_files(album_dir, extensions())
        if tracks:
            embedded = extract_embedded_artwork(tracks[0])
            if embedded is not None:
                return ArtworkSource(*embedded, "embedded")
    if not allow_provider:
        return None
    provider = _fetch_artist_photo_provider(artist_name)
    return ArtworkSource(*provider, "provider") if provider else None


def _artist_hero_source(asset: ArtworkAsset) -> ArtworkSource | None:
    identity_parts = asset.entity_key.split(":", 2)
    if len(identity_parts) == 3:
        entity_uid, composition, render_revision = identity_parts
        try:
            identity = ArtistHeroArtifactIdentity(
                artist_entity_uid=entity_uid,
                composition=composition,
                render_revision=render_revision,
            )
        except ValueError:
            return None
        source = _file_source(artist_hero_artifact_source_path(identity))
        if source is None:
            return None
        return ArtworkSource(source.content, source.media_type, "revision-artifact")

    if len(identity_parts) != 2:
        return None
    entity_uid, composition = identity_parts
    if composition not in {"desktop", "mobile"}:
        return None
    artist = get_library_artist_by_entity_uid(entity_uid)
    if not artist:
        return None
    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if artist_dir is None or not artist_dir.is_dir():
        return None
    return _file_source(artist_dir / f"artist-hero-{composition}.webp")


def _release_source(
    asset: ArtworkAsset, *, allow_provider: bool
) -> ArtworkSource | None:
    try:
        release_id = int(asset.entity_key)
    except ValueError:
        return None
    local = _file_source(release_cover_abspath(release_id))
    if local is not None:
        return local
    if not allow_provider:
        return None

    from crate.db.repositories.library_release_reads import get_release_by_id

    release = get_release_by_id(release_id)
    cover_url = str((release or {}).get("cover_url") or "")
    if not cover_url.startswith(("http://", "https://")):
        return None
    try:
        response = requests.get(
            cover_url, timeout=(3, 10), headers={"Accept": "image/*"}
        )
        response.raise_for_status()
    except requests.RequestException:
        return None
    content_type = response.headers.get("content-type") or "image/jpeg"
    if (
        not content_type.startswith("image/")
        or not response.content
        or len(response.content) > _MAX_SOURCE_BYTES
    ):
        return None
    return ArtworkSource(response.content, content_type, "provider")


def resolve_artwork_source(
    asset: ArtworkAsset, *, allow_provider: bool = True
) -> ArtworkSource | None:
    source: ArtworkSource | None
    if asset.kind == "album-cover":
        source = _album_source(asset)
    elif asset.kind in {"artist-photo", "artist-background"}:
        source = _artist_source(asset, allow_provider=allow_provider)
    elif asset.kind == "artist-hero":
        source = _artist_hero_source(asset)
    elif asset.kind == "genre-cover":
        cover_path = get_genre_taxonomy_cover_path(asset.entity_key)
        absolute = genre_cover_abspath(cover_path)
        source = _file_source(absolute) if absolute is not None else None
    elif asset.kind == "release-cover":
        source = _release_source(asset, allow_provider=allow_provider)
    elif asset.kind == "external-artist":
        path = external_artist_artwork_path_from_key(asset.entity_key)
        source = _file_source(path) if path is not None else None
    else:
        source = None
    if source is not None and len(source.content) > _MAX_SOURCE_BYTES:
        return None
    return source
