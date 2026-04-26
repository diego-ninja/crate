"""Stats and quality read helpers for the library repository."""

from __future__ import annotations

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryAlbum, LibraryArtist, LibraryTrack
from crate.db.repositories.library_shared import album_to_dict
from crate.db.tx import read_scope


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


__all__ = [
    "get_album_quality_map",
    "get_albums_missing_covers",
    "get_library_stats",
    "get_library_track_count",
    "get_track_path_by_id",
    "get_track_rating",
]
