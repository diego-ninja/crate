"""Add deterministic entity_uids to library and genre entities.

Revision ID: 016
Revises: 015
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from crate.entity_ids import (
    album_entity_uid,
    artist_entity_uid,
    genre_entity_uid,
    genre_taxonomy_entity_uid,
    track_entity_uid,
)


revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_columns() -> None:
    op.execute("ALTER TABLE library_artists ADD COLUMN IF NOT EXISTS entity_uid UUID")
    op.execute("ALTER TABLE library_albums ADD COLUMN IF NOT EXISTS entity_uid UUID")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS entity_uid UUID")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS audio_fingerprint TEXT")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS audio_fingerprint_source TEXT")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS audio_fingerprint_computed_at TIMESTAMPTZ")
    op.execute("ALTER TABLE genres ADD COLUMN IF NOT EXISTS entity_uid UUID")
    op.execute("ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS entity_uid UUID")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_identity_keys (
            id BIGSERIAL PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_uid UUID NOT NULL,
            key_type TEXT NOT NULL,
            key_value TEXT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            metadata_json JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (entity_type, key_type, key_value),
            UNIQUE (entity_type, entity_uid, key_type, key_value)
        )
        """
    )


def _backfill_library_artists(connection) -> None:
    rows = connection.execute(
        text(
            """
            SELECT id, name, mbid
            FROM library_artists
            WHERE entity_uid IS NULL
            ORDER BY id
            """
        )
    ).mappings()
    for row in rows:
        connection.execute(
            text("UPDATE library_artists SET entity_uid = :entity_uid WHERE id = :artist_id"),
            {
                "artist_id": row["id"],
                "entity_uid": str(artist_entity_uid(name=row["name"], mbid=row.get("mbid"))),
            },
        )


def _backfill_library_albums(connection) -> None:
    rows = connection.execute(
        text(
            """
            SELECT
                a.id,
                a.artist,
                a.name,
                a.year,
                a.musicbrainz_albumid,
                a.musicbrainz_releasegroupid,
                a.tag_album,
                ar.entity_uid AS artist_entity_uid
            FROM library_albums a
            LEFT JOIN library_artists ar ON ar.name = a.artist
            WHERE a.entity_uid IS NULL
            ORDER BY a.id
            """
        )
    ).mappings()
    for row in rows:
        connection.execute(
            text("UPDATE library_albums SET entity_uid = :entity_uid WHERE id = :album_id"),
            {
                "album_id": row["id"],
                "entity_uid": str(
                    album_entity_uid(
                        artist_name=row["artist"],
                        artist_uid=row.get("artist_entity_uid"),
                        album_name=row["name"],
                        year=row.get("year"),
                        musicbrainz_albumid=row.get("musicbrainz_albumid"),
                        musicbrainz_releasegroupid=row.get("musicbrainz_releasegroupid"),
                        tag_album=row.get("tag_album"),
                    )
                ),
            },
        )


def _backfill_library_tracks(connection) -> None:
    rows = connection.execute(
        text(
            """
            SELECT
                t.id,
                t.artist,
                t.album,
                t.title,
                t.filename,
                t.disc_number,
                t.track_number,
                t.musicbrainz_trackid,
                t.musicbrainz_albumid,
                a.entity_uid AS album_entity_uid
            FROM library_tracks t
            LEFT JOIN library_albums a ON a.id = t.album_id
            WHERE t.entity_uid IS NULL
            ORDER BY t.id
            """
        )
    ).mappings()
    for row in rows:
        connection.execute(
            text("UPDATE library_tracks SET entity_uid = :entity_uid WHERE id = :track_id"),
            {
                "track_id": row["id"],
                "entity_uid": str(
                    track_entity_uid(
                        album_uid=row.get("album_entity_uid"),
                        artist_name=row["artist"],
                        album_name=row["album"],
                        title=row.get("title"),
                        filename=row.get("filename"),
                        disc_number=row.get("disc_number"),
                        track_number=row.get("track_number"),
                        musicbrainz_trackid=row.get("musicbrainz_trackid"),
                        musicbrainz_albumid=row.get("musicbrainz_albumid"),
                    )
                ),
            },
        )


def _merge_genre_ids(connection, *, keep_id: int, drop_ids: list[int]) -> None:
    if not drop_ids:
        return

    connection.execute(
        text(
            """
            INSERT INTO artist_genres (artist_name, genre_id, weight, source)
            SELECT artist_name, :keep_id, MAX(weight), MIN(source)
            FROM artist_genres
            WHERE genre_id = ANY(:drop_ids)
            GROUP BY artist_name
            ON CONFLICT (artist_name, genre_id) DO UPDATE
            SET weight = GREATEST(artist_genres.weight, EXCLUDED.weight)
            """
        ),
        {"keep_id": keep_id, "drop_ids": drop_ids},
    )
    connection.execute(
        text(
            """
            INSERT INTO album_genres (album_id, genre_id, weight, source)
            SELECT album_id, :keep_id, MAX(weight), MIN(source)
            FROM album_genres
            WHERE genre_id = ANY(:drop_ids)
            GROUP BY album_id
            ON CONFLICT (album_id, genre_id) DO UPDATE
            SET weight = GREATEST(album_genres.weight, EXCLUDED.weight)
            """
        ),
        {"keep_id": keep_id, "drop_ids": drop_ids},
    )
    connection.execute(
        text("DELETE FROM artist_genres WHERE genre_id = ANY(:drop_ids)"),
        {"drop_ids": drop_ids},
    )
    connection.execute(
        text("DELETE FROM album_genres WHERE genre_id = ANY(:drop_ids)"),
        {"drop_ids": drop_ids},
    )
    connection.execute(
        text("DELETE FROM genres WHERE id = ANY(:drop_ids)"),
        {"drop_ids": drop_ids},
    )


def _canonicalize_duplicate_genres(connection) -> None:
    connection.execute(
        text("SELECT pg_advisory_xact_lock(hashtext('016-entity-uids-genres-dedupe'))")
    )
    duplicate_rows = connection.execute(
        text(
            """
            WITH duplicate_groups AS (
                SELECT
                    lower(trim(name)) AS genre_key,
                    MIN(id)::INTEGER AS keep_id,
                    ARRAY_AGG(id ORDER BY id) AS ids
                FROM genres
                GROUP BY lower(trim(name))
                HAVING COUNT(*) > 1

                UNION

                SELECT
                    lower(trim(slug)) AS genre_key,
                    MIN(id)::INTEGER AS keep_id,
                    ARRAY_AGG(id ORDER BY id) AS ids
                FROM genres
                GROUP BY lower(trim(slug))
                HAVING COUNT(*) > 1
            )
            SELECT DISTINCT genre_key, keep_id, ids
            FROM duplicate_groups
            ORDER BY keep_id, genre_key
            """
        )
    ).mappings().all()

    for row in duplicate_rows:
        ids = [int(item) for item in (row.get("ids") or [])]
        keep_id = int(row["keep_id"])
        drop_ids = [genre_id for genre_id in ids if genre_id != keep_id]
        _merge_genre_ids(connection, keep_id=keep_id, drop_ids=drop_ids)


def _backfill_genres(connection) -> None:
    rows = connection.execute(
        text(
            """
            SELECT id, name, slug
            FROM genres
            WHERE entity_uid IS NULL
            ORDER BY id
            """
        )
    ).mappings()
    for row in rows:
        connection.execute(
            text("UPDATE genres SET entity_uid = :entity_uid WHERE id = :genre_id"),
            {
                "genre_id": row["id"],
                "entity_uid": str(genre_entity_uid(name=row["name"], slug=row["slug"])),
            },
        )


def _backfill_genre_taxonomy_nodes(connection) -> None:
    rows = connection.execute(
        text(
            """
            SELECT id, slug, name, musicbrainz_mbid
            FROM genre_taxonomy_nodes
            WHERE entity_uid IS NULL
            ORDER BY id
            """
        )
    ).mappings()
    for row in rows:
        connection.execute(
            text("UPDATE genre_taxonomy_nodes SET entity_uid = :entity_uid WHERE id = :node_id"),
            {
                "node_id": row["id"],
                "entity_uid": str(
                    genre_taxonomy_entity_uid(
                        slug=row["slug"],
                        name=row["name"],
                        musicbrainz_mbid=row.get("musicbrainz_mbid"),
                    )
                ),
            },
        )


def _create_indexes() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_artists_entity_uid
        ON library_artists(entity_uid)
        WHERE entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_albums_entity_uid
        ON library_albums(entity_uid)
        WHERE entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lib_tracks_entity_uid
        ON library_tracks(entity_uid)
        WHERE entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genres_entity_uid
        ON genres(entity_uid)
        WHERE entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_taxonomy_nodes_entity_uid
        ON genre_taxonomy_nodes(entity_uid)
        WHERE entity_uid IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_entity_identity_keys_entity
        ON entity_identity_keys(entity_type, entity_uid)
        """
    )


def _normalize_key_value(key_type: str, key_value: str | None) -> str:
    from crate.db.repositories.entity_identity_keys import normalize_identity_key_value

    return normalize_identity_key_value(key_type, key_value)


def _upsert_identity_key(connection, *, entity_type: str, entity_uid: str, key_type: str, key_value: str | None, is_primary: bool = False) -> None:
    normalized = _normalize_key_value(key_type, key_value)
    if not normalized:
        return
    connection.execute(
        text(
            """
            INSERT INTO entity_identity_keys (entity_type, entity_uid, key_type, key_value, is_primary)
            VALUES (:entity_type, :entity_uid, :key_type, :key_value, :is_primary)
            ON CONFLICT (entity_type, key_type, key_value) DO UPDATE
            SET entity_uid = EXCLUDED.entity_uid,
                is_primary = entity_identity_keys.is_primary OR EXCLUDED.is_primary
            """
        ),
        {
            "entity_type": entity_type,
            "entity_uid": entity_uid,
            "key_type": key_type,
            "key_value": normalized,
            "is_primary": bool(is_primary),
        },
    )


def _backfill_identity_keys(connection) -> None:
    artist_rows = connection.execute(
        text("SELECT entity_uid::text AS entity_uid, name, slug, mbid, spotify_id FROM library_artists WHERE entity_uid IS NOT NULL")
    ).mappings()
    for row in artist_rows:
        _upsert_identity_key(connection, entity_type="artist", entity_uid=row["entity_uid"], key_type="name", key_value=row["name"], is_primary=True)
        _upsert_identity_key(connection, entity_type="artist", entity_uid=row["entity_uid"], key_type="slug", key_value=row.get("slug"), is_primary=True)
        _upsert_identity_key(connection, entity_type="artist", entity_uid=row["entity_uid"], key_type="mbid", key_value=row.get("mbid"))
        _upsert_identity_key(connection, entity_type="artist", entity_uid=row["entity_uid"], key_type="spotify_id", key_value=row.get("spotify_id"))

    album_rows = connection.execute(
        text(
            """
            SELECT entity_uid::text AS entity_uid, artist, name, slug, musicbrainz_albumid, musicbrainz_releasegroupid
            FROM library_albums
            WHERE entity_uid IS NOT NULL
            """
        )
    ).mappings()
    for row in album_rows:
        _upsert_identity_key(connection, entity_type="album", entity_uid=row["entity_uid"], key_type="scoped_name", key_value=f"{row['artist']}::{row['name']}", is_primary=True)
        _upsert_identity_key(connection, entity_type="album", entity_uid=row["entity_uid"], key_type="slug", key_value=row.get("slug"), is_primary=True)
        _upsert_identity_key(connection, entity_type="album", entity_uid=row["entity_uid"], key_type="musicbrainz_albumid", key_value=row.get("musicbrainz_albumid"))
        _upsert_identity_key(connection, entity_type="album", entity_uid=row["entity_uid"], key_type="musicbrainz_releasegroupid", key_value=row.get("musicbrainz_releasegroupid"))

    track_rows = connection.execute(
        text(
            """
            SELECT entity_uid::text AS entity_uid, album, title, filename, slug, disc_number, track_number, musicbrainz_trackid
            FROM library_tracks
            WHERE entity_uid IS NOT NULL
            """
        )
    ).mappings()
    for row in track_rows:
        scoped_name = f"{row['album']}::{row.get('disc_number') or 1}::{row.get('track_number') or 0}::{row.get('title') or row.get('filename')}"
        _upsert_identity_key(connection, entity_type="track", entity_uid=row["entity_uid"], key_type="scoped_track", key_value=scoped_name, is_primary=True)
        _upsert_identity_key(connection, entity_type="track", entity_uid=row["entity_uid"], key_type="slug", key_value=row.get("slug"), is_primary=True)
        _upsert_identity_key(connection, entity_type="track", entity_uid=row["entity_uid"], key_type="musicbrainz_trackid", key_value=row.get("musicbrainz_trackid"))

    genre_rows = connection.execute(
        text("SELECT entity_uid::text AS entity_uid, name, slug FROM genres WHERE entity_uid IS NOT NULL")
    ).mappings()
    for row in genre_rows:
        _upsert_identity_key(connection, entity_type="genre", entity_uid=row["entity_uid"], key_type="name", key_value=row["name"], is_primary=True)
        _upsert_identity_key(connection, entity_type="genre", entity_uid=row["entity_uid"], key_type="slug", key_value=row["slug"], is_primary=True)

    taxonomy_rows = connection.execute(
        text("SELECT entity_uid::text AS entity_uid, name, slug, musicbrainz_mbid FROM genre_taxonomy_nodes WHERE entity_uid IS NOT NULL")
    ).mappings()
    for row in taxonomy_rows:
        _upsert_identity_key(connection, entity_type="genre_taxonomy", entity_uid=row["entity_uid"], key_type="name", key_value=row["name"], is_primary=True)
        _upsert_identity_key(connection, entity_type="genre_taxonomy", entity_uid=row["entity_uid"], key_type="slug", key_value=row["slug"], is_primary=True)
        _upsert_identity_key(connection, entity_type="genre_taxonomy", entity_uid=row["entity_uid"], key_type="mbid", key_value=row.get("musicbrainz_mbid"))


def upgrade() -> None:
    _add_columns()
    connection = op.get_bind()
    _backfill_library_artists(connection)
    _backfill_library_albums(connection)
    _backfill_library_tracks(connection)
    _canonicalize_duplicate_genres(connection)
    _backfill_genres(connection)
    _backfill_genre_taxonomy_nodes(connection)
    _create_indexes()
    _backfill_identity_keys(connection)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_genre_taxonomy_nodes_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_genres_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_lib_tracks_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_lib_albums_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_lib_artists_entity_uid")
    op.execute("DROP INDEX IF EXISTS idx_entity_identity_keys_entity")
    op.execute("DROP TABLE IF EXISTS entity_identity_keys")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS audio_fingerprint_computed_at")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS audio_fingerprint_source")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS audio_fingerprint")
    op.execute("ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS entity_uid")
    op.execute("ALTER TABLE genres DROP COLUMN IF EXISTS entity_uid")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS entity_uid")
    op.execute("ALTER TABLE library_albums DROP COLUMN IF EXISTS entity_uid")
    op.execute("ALTER TABLE library_artists DROP COLUMN IF EXISTS entity_uid")
