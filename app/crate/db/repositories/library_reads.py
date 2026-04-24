"""Read-side helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.orm.releases import NewRelease
from crate.db.repositories.library_shared import album_to_dict, artist_to_dict, coerce_uuid, track_to_dict
from crate.db.tx import read_scope


def get_library_artists(
    q: str | None = None,
    sort: str = "name",
    page: int = 1,
    per_page: int = 60,
    *,
    session: Session | None = None,
) -> tuple[list[dict], int]:
    def _impl(s: Session) -> tuple[list[dict], int]:
        base = select(LibraryArtist)
        count_stmt = select(func.count()).select_from(LibraryArtist)
        if q:
            like = f"%{q}%"
            predicate = LibraryArtist.name.ilike(like)
            base = base.where(predicate)
            count_stmt = count_stmt.where(predicate)

        sort_map = {
            "name": LibraryArtist.name.asc(),
            "albums": LibraryArtist.album_count.desc(),
            "tracks": LibraryArtist.track_count.desc(),
            "size": LibraryArtist.total_size.desc(),
            "updated": LibraryArtist.updated_at.desc(),
        }
        rows = s.execute(
            base.order_by(sort_map.get(sort, LibraryArtist.name.asc())).limit(per_page).offset((page - 1) * per_page)
        ).scalars().all()
        total = int(s.execute(count_stmt).scalar_one() or 0)
        return [artist_to_dict(row) for row in rows], total

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_artist(name: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryArtist).where(
                or_(
                    func.lower(LibraryArtist.name) == func.lower(name),
                    LibraryArtist.folder_name == name,
                )
            ).limit(1)
        ).scalar_one_or_none()
        return artist_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_artist_by_id(artist_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.get(LibraryArtist, artist_id)
        return artist_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_albums(
    artist: str,
    include_quarantined: bool = False,
    *,
    session: Session | None = None,
) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        stmt = select(LibraryAlbum).where(func.lower(LibraryAlbum.artist) == func.lower(artist))
        if not include_quarantined:
            stmt = stmt.where(LibraryAlbum.quarantined_at.is_(None))
        rows = s.execute(stmt.order_by(LibraryAlbum.year, LibraryAlbum.name)).scalars().all()
        return [album_to_dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_album(artist: str, album: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryAlbum).where(
                func.lower(LibraryAlbum.artist) == func.lower(artist),
                func.lower(LibraryAlbum.name) == func.lower(album),
            ).limit(1)
        ).scalar_one_or_none()
        return album_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_album_by_id(album_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.get(LibraryAlbum, album_id)
        return album_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_tracks(album_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            select(LibraryTrack)
            .where(LibraryTrack.album_id == album_id)
            .order_by(LibraryTrack.disc_number, LibraryTrack.track_number)
        ).scalars().all()
        return [track_to_dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_track_by_id(track_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.get(LibraryTrack, track_id)
        return track_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_track_by_storage_id(storage_id: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            select(LibraryTrack).where(LibraryTrack.storage_id == coerce_uuid(storage_id)).limit(1)
        ).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_track_by_path(path: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(select(LibraryTrack).where(LibraryTrack.path == path).limit(1)).scalar_one_or_none()
        return track_to_dict(row)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_tracks_by_storage_ids(storage_ids: list[str], *, session: Session | None = None) -> dict[str, dict]:
    cleaned_ids = [storage_id for storage_id in storage_ids if storage_id]
    if not cleaned_ids:
        return {}

    uuids = [coerce_uuid(storage_id) for storage_id in cleaned_ids]

    def _impl(s: Session) -> dict[str, dict]:
        rows = s.execute(select(LibraryTrack).where(LibraryTrack.storage_id.in_(uuids))).scalars().all()
        return {
            str(row.storage_id): track_to_dict(row)
            for row in rows
            if row.storage_id is not None
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_album_quality_map(
    album_ids: list[int],
    *,
    include_format: bool = False,
    session: Session | None = None,
) -> dict[int, dict]:
    cleaned_ids = [int(album_id) for album_id in album_ids if album_id]
    if not cleaned_ids:
        return {}

    format_sql = "MODE() WITHIN GROUP (ORDER BY format) AS format," if include_format else "NULL::TEXT AS format,"

    def _impl(s: Session) -> dict[int, dict]:
        rows = s.execute(
            text(
                f"""
                SELECT album_id,
                       {format_sql}
                       MAX(bit_depth) AS bit_depth,
                       MAX(sample_rate) AS sample_rate
                FROM library_tracks
                WHERE album_id = ANY(:ids) AND format IS NOT NULL
                GROUP BY album_id
                """
            ),
            {"ids": cleaned_ids},
        ).mappings().all()
        return {
            int(row["album_id"]): {
                "format": row.get("format"),
                "bit_depth": row.get("bit_depth"),
                "sample_rate": row.get("sample_rate"),
            }
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_stats(*, session: Session | None = None) -> dict:
    def _impl(s: Session) -> dict:
        artists = int(s.execute(select(func.count()).select_from(LibraryArtist)).scalar_one() or 0)
        albums = int(s.execute(select(func.count()).select_from(LibraryAlbum)).scalar_one() or 0)
        tracks = int(s.execute(select(func.count()).select_from(LibraryTrack)).scalar_one() or 0)
        total_size = int(s.execute(select(func.coalesce(func.sum(LibraryArtist.total_size), 0))).scalar_one() or 0)
        fmt_rows = s.execute(
            text(
                """
                SELECT format, COUNT(*) AS cnt
                FROM library_tracks
                WHERE format IS NOT NULL
                GROUP BY format
                ORDER BY cnt DESC
                """
            )
        ).mappings().all()
        return {
            "artists": artists,
            "albums": albums,
            "tracks": tracks,
            "total_size": total_size,
            "formats": {row["format"]: row["cnt"] for row in fmt_rows},
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_library_track_count(*, session: Session | None = None) -> int:
    def _impl(s: Session) -> int:
        return int(s.execute(select(func.count()).select_from(LibraryTrack)).scalar_one() or 0)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_track_rating(track_id: int, *, session: Session | None = None) -> int:
    def _impl(s: Session) -> int:
        rating = s.execute(select(LibraryTrack.rating).where(LibraryTrack.id == track_id).limit(1)).scalar_one_or_none()
        return int(rating or 0)

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_track_path_by_id(track_id: int, *, session: Session | None = None) -> str | None:
    def _impl(s: Session) -> str | None:
        return s.execute(select(LibraryTrack.path).where(LibraryTrack.id == track_id).limit(1)).scalar_one_or_none()

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_albums_missing_covers(*, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            select(LibraryAlbum)
            .where(or_(LibraryAlbum.has_cover == 0, LibraryAlbum.has_cover.is_(None)))
            .order_by(LibraryAlbum.artist, LibraryAlbum.year)
        ).scalars().all()
        return [album_to_dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_release_by_id(release_id: int, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.get(NewRelease, release_id)
        if row is None:
            return None
        return {
            "id": row.id,
            "artist_name": row.artist_name,
            "album_title": row.album_title,
            "tidal_id": row.tidal_id,
            "tidal_url": row.tidal_url,
            "cover_url": row.cover_url,
            "year": row.year,
            "tracks": row.tracks,
            "quality": row.quality,
            "status": row.status,
            "detected_at": row.detected_at,
            "downloaded_at": row.downloaded_at,
            "release_date": row.release_date,
            "release_type": row.release_type,
            "mb_release_group_id": row.mb_release_group_id,
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_analysis_tracks(artist_name: str, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT t.title,
                       t.bpm AS tempo,
                       t.audio_key AS key,
                       t.audio_scale AS scale,
                       t.energy,
                       t.danceability,
                       t.valence,
                       t.acousticness,
                       t.instrumentalness,
                       t.loudness,
                       t.dynamic_range,
                       t.spectral_complexity,
                       t.mood_json
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.artist = :artist_name AND t.bpm IS NOT NULL
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_refs_by_names(names: list[str], *, session: Session | None = None) -> dict[str, dict]:
    if not names:
        return {}

    lowered = [name.lower() for name in names]

    def _impl(s: Session) -> dict[str, dict]:
        rows = s.execute(
            select(LibraryArtist.id, LibraryArtist.slug, LibraryArtist.name).where(func.lower(LibraryArtist.name).in_(lowered))
        ).all()
        return {
            row.name.lower(): {"id": row.id, "slug": row.slug}
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def get_artist_tracks_for_setlist(artist_name: str, *, session: Session | None = None) -> list[dict]:
    def _impl(s: Session) -> list[dict]:
        rows = s.execute(
            text(
                """
                SELECT
                    t.id,
                    t.title,
                    t.path,
                    t.duration,
                    a.name AS album
                FROM library_tracks t
                JOIN library_albums a ON a.id = t.album_id
                WHERE a.artist = :artist_name
                ORDER BY a.year NULLS LAST, a.name, t.disc_number NULLS LAST, t.track_number NULLS LAST, t.title
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def find_user_playlist_by_name(user_id: int, playlist_name: str, *, session: Session | None = None) -> dict | None:
    def _impl(s: Session) -> dict | None:
        row = s.execute(
            text(
                """
                SELECT id
                FROM playlists
                WHERE user_id = :user_id
                  AND scope = 'user'
                  AND name = :playlist_name
                ORDER BY updated_at DESC NULLS LAST, id DESC
                LIMIT 1
                """
            ),
            {"user_id": user_id, "playlist_name": playlist_name},
        ).mappings().first()
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def enrich_track_refs(track_ids: list[int], *, session: Session | None = None) -> dict[int, dict]:
    if not track_ids:
        return {}

    def _impl(s: Session) -> dict[int, dict]:
        rows = s.execute(
            select(
                LibraryTrack.id.label("track_id"),
                LibraryTrack.storage_id.label("track_storage_id"),
                LibraryTrack.slug.label("track_slug"),
                LibraryAlbum.id.label("album_id"),
                LibraryAlbum.slug.label("album_slug"),
                LibraryArtist.id.label("artist_id"),
                LibraryArtist.slug.label("artist_slug"),
            )
            .join(LibraryAlbum, LibraryTrack.album_id == LibraryAlbum.id)
            .outerjoin(LibraryArtist, LibraryArtist.name == LibraryAlbum.artist)
            .where(LibraryTrack.id.in_(track_ids))
        ).mappings().all()
        return {
            row["track_id"]: {
                **dict(row),
                "track_storage_id": str(row["track_storage_id"]) if row.get("track_storage_id") is not None else None,
            }
            for row in rows
        }

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


__all__ = [
    "enrich_track_refs",
    "find_user_playlist_by_name",
    "get_album_quality_map",
    "get_albums_missing_covers",
    "get_artist_analysis_tracks",
    "get_artist_refs_by_names",
    "get_artist_tracks_for_setlist",
    "get_library_album",
    "get_library_album_by_id",
    "get_library_albums",
    "get_library_artist",
    "get_library_artist_by_id",
    "get_library_artists",
    "get_library_stats",
    "get_library_track_by_id",
    "get_library_track_by_path",
    "get_library_track_by_storage_id",
    "get_library_track_count",
    "get_library_tracks",
    "get_library_tracks_by_storage_ids",
    "get_release_by_id",
    "get_track_path_by_id",
    "get_track_rating",
]
