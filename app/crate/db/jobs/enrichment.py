"""DB functions for enrichment worker handlers."""

from collections.abc import Mapping, Sequence
import json
from typing import Any

from sqlalchemy import text

from crate.release_dates import normalize_release_date
from crate.db.repositories.global_catalog_dirty_sources import (
    enqueue_local_dirty_source,
)
from crate.db.tx import transaction_scope


def get_albums_without_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''"
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_albums_needing_release_metadata() -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT album.*, artist.mbid AS artist_mbid
                    FROM library_albums album
                    LEFT JOIN library_artists artist
                      ON LOWER(artist.name) = LOWER(album.artist)
                    WHERE album.musicbrainz_albumid IS NULL
                       OR album.musicbrainz_albumid = ''
                       OR album.release_group_primary_type IS NULL
                       OR album.release_group_primary_type = ''
                       OR album.release_date IS NULL
                       OR album.release_date = ''
                    ORDER BY album.artist, album.year NULLS LAST, album.name
                    """
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def update_album_mbid(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"
            ),
            {"mbid": mbid, "id": album_id},
        )


def update_album_release_group_id(album_id: int, release_group_id: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"
            ),
            {"rgid": release_group_id, "id": album_id},
        )


def update_track_mbids(track_id: int, album_mbid: str, track_mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                "WHERE id = :id"
            ),
            {"album_mbid": album_mbid, "track_mbid": track_mbid, "id": track_id},
        )


def persist_album_release_mbids(
    album_id: int, tracks_db: Sequence[Mapping[str, Any]], release: dict
) -> None:
    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    release_group_primary_type = release.get("release_group_primary_type")
    release_group_secondary_types = list(
        release.get("release_group_secondary_types") or []
    )
    release_date = normalize_release_date(release.get("first_release_date")) or ""
    mb_tracks = release.get("tracks", [])

    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_albums
                SET musicbrainz_albumid = :mbid,
                    release_date = COALESCE(
                        NULLIF(:release_date, ''),
                        release_date
                    ),
                    release_group_primary_type = COALESCE(
                        :release_group_primary_type,
                        release_group_primary_type
                    ),
                    release_group_secondary_types =
                        CAST(:release_group_secondary_types AS jsonb),
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            {
                "mbid": release_mbid,
                "release_group_primary_type": release_group_primary_type,
                "release_date": release_date,
                "release_group_secondary_types": json.dumps(
                    release_group_secondary_types
                ),
                "id": album_id,
            },
        )
        if release_group_id:
            session.execute(
                text(
                    "UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"
                ),
                {"rgid": release_group_id, "id": album_id},
            )
        entity_uid = session.execute(
            text("SELECT entity_uid::text FROM library_albums WHERE id = :id"),
            {"id": album_id},
        ).scalar_one_or_none()
        if entity_uid:
            enqueue_local_dirty_source(
                "album", str(entity_uid), "upsert", session=session
            )
        for index, db_track in enumerate(tracks_db):
            if index >= len(mb_tracks):
                break
            track_mbid = mb_tracks[index].get("mbid", "")
            if track_mbid:
                session.execute(
                    text(
                        "UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                        "WHERE id = :id"
                    ),
                    {
                        "album_mbid": release_mbid,
                        "track_mbid": track_mbid,
                        "id": db_track["id"],
                    },
                )


def persist_album_release_group_types(updates: list[dict]) -> int:
    if not updates:
        return 0
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE library_albums
                SET musicbrainz_releasegroupid = COALESCE(
                        NULLIF(:musicbrainz_releasegroupid, ''),
                        musicbrainz_releasegroupid
                    ),
                    release_group_primary_type = COALESCE(
                        :release_group_primary_type,
                        release_group_primary_type
                    ),
                    release_date = COALESCE(
                        NULLIF(:release_date, ''),
                        release_date
                    ),
                    release_group_secondary_types =
                        CAST(:release_group_secondary_types AS jsonb),
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            [
                {
                    **update,
                    "musicbrainz_releasegroupid": str(
                        update.get("musicbrainz_releasegroupid") or ""
                    ),
                    "release_group_primary_type": update.get(
                        "release_group_primary_type"
                    ),
                    "release_date": normalize_release_date(update.get("release_date"))
                    or "",
                    "release_group_secondary_types": json.dumps(
                        update.get("release_group_secondary_types") or []
                    ),
                }
                for update in updates
            ],
        )
        rows = (
            session.execute(
                text(
                    """
                    SELECT id, entity_uid::text AS entity_uid
                    FROM library_albums
                    WHERE id = ANY(CAST(:ids AS bigint[]))
                    """
                ),
                {"ids": [int(update["id"]) for update in updates]},
            )
            .mappings()
            .all()
        )
        for row in rows:
            if row["entity_uid"]:
                enqueue_local_dirty_source(
                    "album", str(row["entity_uid"]), "upsert", session=session
                )
    return len(updates)


def update_album_mbid_and_propagate(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"
            ),
            {"mbid": mbid, "id": album_id},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET musicbrainz_albumid = :mbid "
                "WHERE album_id = :album_id AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')"
            ),
            {"mbid": mbid, "album_id": album_id},
        )


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def update_album_has_cover(album_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET has_cover = 1 WHERE id = :id"),
            {"id": album_id},
        )


def update_album_path_after_reorganize(
    old_path: str, new_path: str, clean_name: str
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"
            ),
            {"name": clean_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET path = REPLACE(path, :old_path, :new_path) WHERE path LIKE :pattern"
            ),
            {"old_path": old_path, "new_path": new_path, "pattern": old_path + "%"},
        )


def update_artist_content_hash(artist_name: str, content_hash: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET content_hash = :hash WHERE name = :name"),
            {"hash": content_hash, "name": artist_name},
        )


def get_artists_with_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
            SELECT id, slug, name, mbid, album_count, has_photo, listeners
            FROM library_artists
            WHERE mbid IS NOT NULL AND mbid != ''
            ORDER BY name
            """
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def get_album_names_for_artist(artist_name: str) -> set[str]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text("SELECT name FROM library_albums WHERE artist = :artist"),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
        return {row["name"].lower() for row in rows}


def get_album_names_for_artists(artist_names: Sequence[str]) -> dict[str, set[str]]:
    """Return normalized local album names grouped by artist in one query."""
    names = [str(name).strip() for name in artist_names if str(name).strip()]
    if not names:
        return {}
    names_by_key = {name.lower(): name for name in names}

    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT artist, name
                    FROM library_albums
                    WHERE LOWER(artist) = ANY(CAST(:artists AS text[]))
                    """
                ),
                {"artists": list(names_by_key)},
            )
            .mappings()
            .all()
        )

    grouped = {name: set() for name in names}
    for row in rows:
        artist = str(row["artist"] or "")
        album_name = str(row["name"] or "").strip().lower()
        canonical_name = names_by_key.get(artist.lower())
        if canonical_name and album_name:
            grouped[canonical_name].add(album_name)
    return grouped
