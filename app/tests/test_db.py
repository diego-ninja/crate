"""Tests for crate.db — CRUD operations on PostgreSQL."""

import json
import os
import time
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
from unittest.mock import patch
from uuid import uuid4

import psycopg2
import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE, TEST_DB_NAME

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestBootstrap:
    def test_init_db_stamps_alembic_baseline(self, pg_db):
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            row = session.execute(text("SELECT version_num FROM alembic_version")).mappings().first()

        cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
        cfg.set_main_option(
            "script_location",
            os.path.join(os.path.dirname(__file__), "..", "crate", "db", "migrations"),
        )
        script = ScriptDirectory.from_config(cfg)

        assert row is not None
        assert row["version_num"] == script.get_current_head()

    def test_init_db_does_not_require_legacy_bridge_tracking(self, pg_db):
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            row = session.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = 'public'
                          AND table_name = 'schema_versions'
                    ) AS exists
                    """
                )
            ).mappings().first()

        assert row is not None
        assert row["exists"] is False

    def test_pg_db_writes_stay_in_test_database(self, pg_db):
        marker = "LEAK_GUARD_ARTIST_20260417"
        pg_db.upsert_artist({"name": marker})

        user = os.environ.get("CRATE_POSTGRES_USER", "crate")
        password = os.environ.get("CRATE_POSTGRES_PASSWORD", "crate")
        host = os.environ.get("CRATE_POSTGRES_HOST", "localhost")
        port = os.environ.get("CRATE_POSTGRES_PORT", "5432")

        def _count(dbname: str) -> int:
            conn = psycopg2.connect(
                f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
            )
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) FROM library_artists WHERE name = %s",
                        (marker,),
                    )
                    return cur.fetchone()[0]
            finally:
                conn.close()

        assert _count(TEST_DB_NAME) == 1
        # The main "crate" database only exists in local dev environments.
        # In CI there is only the test database, so skip the leak check.
        try:
            assert _count("crate") == 0
        except psycopg2.OperationalError:
            pass  # DB doesn't exist in CI — no leak possible

    def test_fresh_bootstrap_includes_late_legacy_columns(self, pg_db):
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND (
                        (table_name = 'users' AND column_name IN (
                            'subsonic_token',
                            'city',
                            'country',
                            'country_code',
                            'latitude',
                            'longitude',
                            'show_location_mode',
                            'show_radius_km'
                        ))
                        OR
                        (table_name = 'shows' AND column_name IN (
                            'lastfm_event_id',
                            'lastfm_url',
                            'lastfm_attendance',
                            'tickets_url',
                            'scrape_city'
                        ))
                      )
                    """
                )
            ).mappings().all()

        present = {(row["table_name"], row["column_name"]) for row in rows}
        expected = {
            ("users", "subsonic_token"),
            ("users", "city"),
            ("users", "country"),
            ("users", "country_code"),
            ("users", "latitude"),
            ("users", "longitude"),
            ("users", "show_location_mode"),
            ("users", "show_radius_km"),
            ("shows", "lastfm_event_id"),
            ("shows", "lastfm_url"),
            ("shows", "lastfm_attendance"),
            ("shows", "tickets_url"),
            ("shows", "scrape_city"),
        }

        assert expected <= present


class TestPlaylistTrackEntityRefs:
    def test_add_playlist_tracks_persists_entity_and_storage_refs(self, pg_db):
        from crate.db.repositories.playlists_create import create_playlist
        from crate.db.repositories.playlists_tracks import add_playlist_tracks
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Playlist Ref Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Playlist Ref Artist",
                "name": "Playlist Ref Album",
                "path": "/music/playlist-ref-artist/playlist-ref-album",
                "track_count": 1,
                "total_size": 1024,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        track_path = "/music/playlist-ref-artist/playlist-ref-album/01-track.flac"
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Playlist Ref Artist",
                "album": "Playlist Ref Album",
                "filename": "01-track.flac",
                "title": "Playlist Ref Track",
                "path": track_path,
                "duration": 180.0,
                "size": 1024,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            track_row = session.execute(
                text(
                    """
                    SELECT id, entity_uid::text AS entity_uid, storage_id::text AS storage_id, path
                    FROM library_tracks
                    WHERE path = :track_path
                    """
                ),
                {"track_path": track_path},
            ).mappings().first()
        track_id = track_row["id"]

        playlist_id = create_playlist("Playlist Ref Test")
        add_playlist_tracks(playlist_id, [{"track_id": track_id}])

        with transaction_scope() as session:
            row = session.execute(
                text(
                    """
                    SELECT
                        track_id,
                        track_entity_uid::text AS track_entity_uid,
                        track_storage_id::text AS track_storage_id,
                        track_path,
                        title,
                        artist,
                        album
                    FROM playlist_tracks
                    WHERE playlist_id = :playlist_id
                    ORDER BY position
                    LIMIT 1
                    """
                ),
                {"playlist_id": playlist_id},
            ).mappings().first()

        assert row is not None
        assert row["track_id"] == track_id
        assert row["track_entity_uid"] == track_row["entity_uid"]
        assert row["track_storage_id"] == track_row["storage_id"]
        assert row["track_path"] == track_row["path"]
        assert row["title"] == "Playlist Ref Track"
        assert row["artist"] == "Playlist Ref Artist"
        assert row["album"] == "Playlist Ref Album"

    def test_get_playlist_tracks_resolves_by_persisted_entity_uid_when_track_id_is_missing(self, pg_db):
        from crate.db.repositories.playlists_create import create_playlist
        from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Playlist Resolve Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Playlist Resolve Artist",
                "name": "Playlist Resolve Album",
                "path": "/music/playlist-resolve-artist/playlist-resolve-album",
                "track_count": 1,
                "total_size": 2048,
                "total_duration": 210.0,
                "formats": ["flac"],
            }
        )
        track_path = "/music/playlist-resolve-artist/playlist-resolve-album/01-resolve.flac"
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Playlist Resolve Artist",
                "album": "Playlist Resolve Album",
                "filename": "01-resolve.flac",
                "title": "Resolve Me",
                "path": track_path,
                "duration": 210.0,
                "size": 2048,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            track_row = session.execute(
                text(
                    """
                    SELECT id, entity_uid::text AS entity_uid, storage_id::text AS storage_id, path
                    FROM library_tracks
                    WHERE path = :track_path
                    """
                ),
                {"track_path": track_path},
            ).mappings().first()
        track_id = track_row["id"]

        playlist_id = create_playlist("Playlist Resolve Test")
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO playlist_tracks (
                        playlist_id,
                        track_id,
                        track_entity_uid,
                        track_storage_id,
                        track_path,
                        title,
                        artist,
                        album,
                        duration,
                        position,
                        added_at
                    )
                    VALUES (
                        :playlist_id,
                        NULL,
                        :track_entity_uid,
                        :track_storage_id,
                        :track_path,
                        :title,
                        :artist,
                        :album,
                        0,
                        1,
                        NOW()
                    )
                    """
                ),
                {
                    "playlist_id": playlist_id,
                    "track_entity_uid": track_row["entity_uid"],
                    "track_storage_id": track_row["storage_id"],
                    "track_path": "stale/path.flac",
                    "title": "Stale Title",
                    "artist": "Stale Artist",
                    "album": "Stale Album",
                },
            )

        tracks = get_playlist_tracks(playlist_id)

        assert len(tracks) == 1
        assert tracks[0]["track_id"] == track_id
        assert tracks[0]["track_entity_uid"] == track_row["entity_uid"]
        assert tracks[0]["track_storage_id"] == track_row["storage_id"]
        assert tracks[0]["track_path"] == track_row["path"]
        assert tracks[0]["title"] == "Resolve Me"
        assert tracks[0]["artist"] == "Playlist Resolve Artist"
        assert tracks[0]["album"] == "Playlist Resolve Album"


class TestAnalyticsQueries:
    def test_get_insights_mood_distribution_aggregates_in_sql_with_shadow_fallback(self, pg_db):
        from crate.db.queries.analytics_audio_feature_queries import get_insights_mood_distribution
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Mood Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Mood Artist",
                "name": "Mood Album",
                "path": "/music/Mood Artist/Mood Album",
                "track_count": 2,
                "total_size": 2000,
                "total_duration": 360.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Mood Artist",
                "album": "Mood Album",
                "filename": "01-first.flac",
                "title": "First",
                "path": "/music/Mood Artist/Mood Album/01-first.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Mood Artist",
                "album": "Mood Album",
                "filename": "02-second.flac",
                "title": "Second",
                "path": "/music/Mood Artist/Mood Album/02-second.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT id
                    FROM library_tracks
                    WHERE album_id = :album_id
                    ORDER BY id
                    """
                ),
                {"album_id": album_id},
            ).mappings().all()
            first_id = rows[0]["id"]
            second_id = rows[1]["id"]
            session.execute(
                text("UPDATE library_tracks SET mood_json = CAST(:mood_json AS jsonb) WHERE id = :id"),
                {"id": first_id, "mood_json": json.dumps({"happy": 0.5, "calm": 0.2})},
            )
            session.execute(
                text(
                    """
                    INSERT INTO track_analysis_features (track_id, mood_json, updated_at)
                    VALUES (:track_id, CAST(:mood_json AS jsonb), NOW())
                    ON CONFLICT (track_id) DO UPDATE SET
                        mood_json = EXCLUDED.mood_json,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"track_id": second_id, "mood_json": json.dumps({"happy": 0.8, "tense": 0.4})},
            )

        moods = get_insights_mood_distribution()

        assert moods[:3] == [
            {"mood": "happy", "score": 1.3},
            {"mood": "tense", "score": 0.4},
            {"mood": "calm", "score": 0.2},
        ]


class TestHealthQueries:
    def test_get_zombie_artists_ignores_artists_with_real_content(self, pg_db):
        from crate.db.queries.health import get_zombie_artists

        alive = "Zombie Guard Alive"
        zombie = "Zombie Guard Dead"

        pg_db.upsert_artist({"name": alive, "album_count": 0, "track_count": 0, "total_size": 0, "formats": []})
        pg_db.upsert_album(
            {
                "artist": alive,
                "name": "Still Here",
                "path": "/music/zombie-guard-alive/still-here",
                "track_count": 3,
                "total_size": 1234,
                "formats": ["flac"],
                "year": "2024",
            }
        )
        pg_db.upsert_artist({"name": zombie, "album_count": 0, "track_count": 0, "total_size": 0, "formats": []})

        names = {row["name"] for row in get_zombie_artists()}

        assert alive not in names
        assert zombie in names


class TestRepairJobs:
    def test_rename_artist_updates_fk_children_without_violation(self, pg_db):
        from crate.db.jobs.repair import rename_artist
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Birds in Row"})
        album_id = pg_db.upsert_album({
            "artist": "Birds in Row",
            "name": "You, Me & the Violence",
            "path": "/music/Birds in Row/You, Me & the Violence",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Birds in Row",
            "album": "You, Me & the Violence",
            "filename": "01 - Pilori.flac",
            "title": "Pilori",
            "track_number": 1,
            "format": "flac",
            "path": "/music/Birds in Row/You, Me & the Violence/01 - Pilori.flac",
        })

        with transaction_scope() as session:
            genre_name = f"Screamo-{uuid4().hex[:8]}"
            genre_id = session.execute(
                text("INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"),
                {"name": genre_name, "slug": genre_name.lower()},
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                    VALUES (:artist_name, :genre_id, 1.0, 'tags')
                    """
                ),
                {"artist_name": "Birds in Row", "genre_id": genre_id},
            )

        rename_artist("Birds in Row", "Birds In Row", "birds-in-row")

        with transaction_scope() as session:
            artists = session.execute(
                text("SELECT name, folder_name FROM library_artists ORDER BY name")
            ).mappings().all()
            albums = session.execute(
                text("SELECT artist FROM library_albums")
            ).mappings().all()
            tracks = session.execute(
                text("SELECT artist FROM library_tracks")
            ).mappings().all()
            artist_genres = session.execute(
                text("SELECT artist_name FROM artist_genres")
            ).mappings().all()

        assert [row["name"] for row in artists] == ["Birds In Row"]
        assert artists[0]["folder_name"] == "birds-in-row"
        assert {row["artist"] for row in albums} == {"Birds In Row"}
        assert {row["artist"] for row in tracks} == {"Birds In Row"}
        assert {row["artist_name"] for row in artist_genres} == {"Birds In Row"}


class TestGenreTaxonomyCleanup:
    def test_genre_entities_get_deterministic_entity_uids(self, pg_db):
        from crate.db.repositories.genres_assignments import get_or_create_genre
        from crate.db.tx import transaction_scope
        from crate.entity_ids import genre_entity_uid

        with transaction_scope() as session:
            genre_id = get_or_create_genre("Rock en español", session=session)
            row = session.execute(
                text("SELECT entity_uid::text AS entity_uid, slug FROM genres WHERE id = :genre_id"),
                {"genre_id": genre_id},
            ).mappings().first()

        assert row is not None
        assert row["entity_uid"] == str(genre_entity_uid(name="rock en español", slug=row["slug"]))

    def test_genre_taxonomy_entity_uid_stays_stable_when_mbid_arrives_later(self, pg_db):
        from crate.db.tx import transaction_scope

        first = pg_db.upsert_genre_taxonomy_node("post-hardcore", name="post hardcore")
        with transaction_scope() as session:
            second = pg_db.upsert_genre_taxonomy_node(
                "post-hardcore",
                name="post hardcore",
                musicbrainz_mbid="123e4567-e89b-12d3-a456-426614174000",
                session=session,
            )

        assert first is not None
        assert second is not None
        assert first["entity_uid"] == second["entity_uid"]

    def test_assign_genre_alias_is_noop_when_alias_already_points_to_same_canonical(self, pg_db):
        from crate.db.jobs.genre_taxonomy import assign_genre_alias_in_session
        from crate.db.tx import transaction_scope

        pg_db.upsert_genre_taxonomy_node("rock", name="rock")
        with transaction_scope() as session:
            assert assign_genre_alias_in_session(session, "rock en español", "rock") is True
        with transaction_scope() as session:
            assert assign_genre_alias_in_session(session, "rock en español", "rock") is True
            count = session.execute(
                text(
                    """
                    SELECT COUNT(*)::INTEGER AS cnt
                    FROM genre_taxonomy_aliases
                    WHERE alias_name = 'rock en español'
                    """
                )
            ).mappings().first()["cnt"]
        assert count == 1

    def test_list_unmapped_genres_for_inference_skips_legacy_row_when_alias_name_already_exists(self, pg_db):
        from crate.db.jobs.genre_taxonomy import assign_genre_alias_in_session
        from crate.db.queries.genres_library_catalog import (
            get_unmapped_genre_count,
            list_unmapped_genres_for_inference,
        )
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Duncan Dhu"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Duncan Dhu",
                "name": "20 anos de canciones",
                "path": "/music/Duncan Dhu/20 anos de canciones",
            }
        )
        with transaction_scope() as session:
            pg_db.upsert_genre_taxonomy_node("rock", name="rock", session=session)
            assert assign_genre_alias_in_session(session, "rock en español", "rock") is True
            session.execute(
                text(
                    """
                    INSERT INTO genres (id, name, slug)
                    VALUES (353, 'rock en español', 'rock-en-espaol')
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES (:album_id, 353, 1.0, 'tags')
                    """
                ),
                {"album_id": album_id},
            )

        items = list_unmapped_genres_for_inference(limit=20)
        assert all(item["slug"] != "rock-en-espaol" for item in items)
        assert get_unmapped_genre_count() == 0

    def test_list_unmapped_genres_for_inference_includes_focused_genre_even_if_already_mapped(self, pg_db):
        from crate.db.jobs.genre_taxonomy import assign_genre_alias_in_session
        from crate.db.queries.genres_library_catalog import list_unmapped_genres_for_inference
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Instrumental Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Instrumental Artist",
                "name": "Instrumental Album",
                "path": "/music/Instrumental Artist/Instrumental Album",
            }
        )
        with transaction_scope() as session:
            pg_db.upsert_genre_taxonomy_node("rock", name="rock", session=session)
            assert assign_genre_alias_in_session(session, "instrumental", "rock") is True
            session.execute(
                text(
                    """
                    INSERT INTO genres (id, name, slug)
                    VALUES (354, 'instrumental', 'instrumental')
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES (:album_id, 354, 1.0, 'tags')
                    """
                ),
                {"album_id": album_id},
            )

        items = list_unmapped_genres_for_inference(limit=20, focus_slug="instrumental")

        assert len(items) == 1
        assert items[0]["slug"] == "instrumental"

    def test_merge_duplicate_library_genres_merges_references_and_deletes_duplicates(self, pg_db):
        from crate.db.jobs.genre_taxonomy import merge_duplicate_library_genres_in_session
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Alternative Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Alternative Artist",
                "name": "Alternative Album",
                "path": "/music/Alternative Artist/Alternative Album",
            }
        )

        with transaction_scope() as session:
            session.execute(
                text("INSERT INTO genres (id, name, slug) VALUES (1001, 'Alternative', 'Alternative')")
            )
            session.execute(
                text("INSERT INTO genres (id, name, slug) VALUES (1002, 'alternative', 'alternative')")
            )
            session.execute(
                text(
                    """
                    INSERT INTO artist_genres (artist_name, genre_id, weight, source)
                    VALUES
                        ('Alternative Artist', 1001, 0.7, 'tags'),
                        ('Alternative Artist', 1002, 0.9, 'tags')
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES
                        (:album_id, 1001, 0.6, 'tags'),
                        (:album_id, 1002, 0.8, 'tags')
                    """
                ),
                {"album_id": album_id},
            )
            merged = merge_duplicate_library_genres_in_session(session)

        assert merged == [
            {
                "genre_key": "alternative",
                "keep_id": 1001,
                "drop_ids": [1002],
                "names": ["Alternative", "alternative"],
                "slugs": ["Alternative", "alternative"],
            }
        ]

        with transaction_scope() as session:
            genre_rows = session.execute(
                text("SELECT id, name, slug FROM genres WHERE id IN (1001, 1002) ORDER BY id")
            ).mappings().all()
            artist_rows = session.execute(
                text(
                    """
                    SELECT artist_name, genre_id, weight
                    FROM artist_genres
                    WHERE artist_name = 'Alternative Artist'
                    ORDER BY genre_id
                    """
                )
            ).mappings().all()
            album_rows = session.execute(
                text(
                    """
                    SELECT album_id, genre_id, weight
                    FROM album_genres
                    WHERE album_id = :album_id
                    ORDER BY genre_id
                    """
                ),
                {"album_id": album_id},
            ).mappings().all()

        assert genre_rows == [{"id": 1001, "name": "Alternative", "slug": "Alternative"}]
        assert artist_rows == [{"artist_name": "Alternative Artist", "genre_id": 1001, "weight": 0.9}]
        assert album_rows == [{"album_id": album_id, "genre_id": 1001, "weight": 0.8}]

    def test_cleanup_invalid_genre_taxonomy_nodes_dry_run_and_delete(self, pg_db):
        from crate.db.tx import transaction_scope

        pg_db.upsert_genre_taxonomy_node("metalcore", name="metalcore")
        pg_db.upsert_genre_taxonomy_node("wikidata", name="wikidata:")
        pg_db.upsert_genre_taxonomy_node("q183862", name="q183862")
        pg_db.upsert_genre_taxonomy_node(
            "https://rateyourmusic.com/genre/metalcore/",
            name="https://rateyourmusic.com/genre/metalcore/",
        )
        pg_db.upsert_genre_taxonomy_edge("metalcore", "wikidata", relation_type="related")

        preview = pg_db.cleanup_invalid_genre_taxonomy_nodes(dry_run=True)

        assert preview["dry_run"] is True
        assert preview["invalid_count"] == 3
        assert preview["deleted_count"] == 0
        assert {item["reason"] for item in preview["items"]} == {
            "external-section-marker",
            "external-url",
            "wikidata-entity-id",
        }

        deleted = pg_db.cleanup_invalid_genre_taxonomy_nodes(dry_run=False)

        assert deleted["dry_run"] is False
        assert deleted["deleted_count"] == 3

        with transaction_scope() as session:
            slugs = {
                row["slug"]
                for row in session.execute(
                    text("SELECT slug FROM genre_taxonomy_nodes")
                ).mappings().all()
            }
            assert "metalcore" in slugs
            assert "wikidata" not in slugs
            assert "q183862" not in slugs
            assert "https-rateyourmusic-com-genre-metalcore" not in slugs

            alias_count = session.execute(
                text(
                    """
                    SELECT COUNT(*)::INTEGER AS cnt
                    FROM genre_taxonomy_aliases
                    WHERE alias_slug IN (
                        'wikidata',
                        'q183862',
                        'https-rateyourmusic-com-genre-metalcore'
                    )
                    """
                )
            ).mappings().first()["cnt"]
            deleted_ids = [
                r["id"]
                for r in session.execute(
                    text(
                        """
                        SELECT id FROM genre_taxonomy_nodes
                        WHERE slug IN ('wikidata', 'q183862', 'https-rateyourmusic-com-genre-metalcore')
                        """
                    )
                ).mappings().all()
            ]
            if deleted_ids:
                edge_count = session.execute(
                    text(
                        """
                        SELECT COUNT(*)::INTEGER AS cnt
                        FROM genre_taxonomy_edges
                        WHERE source_genre_id = ANY(:ids)
                           OR target_genre_id = ANY(:ids)
                        """
                    ),
                    {"ids": deleted_ids},
                ).mappings().first()["cnt"]
            else:
                edge_count = 0

        assert alias_count == 0
        assert edge_count == 0


class TestBlissFallbackQueries:
    def test_find_best_candidate_falls_back_to_bliss_vector_when_embedding_missing(self, pg_db):
        from crate.db.paths import _find_best_candidate
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Fallback Artist"})
        album_id = pg_db.upsert_album({
            "artist": "Fallback Artist",
            "name": "Fallback Album",
            "path": "/music/Fallback Artist/Fallback Album",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Fallback Artist",
            "album": "Fallback Album",
            "filename": "01 - Near.flac",
            "title": "Near",
            "track_number": 1,
            "format": "flac",
            "path": "/music/Fallback Artist/Fallback Album/01 - Near.flac",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Fallback Artist",
            "album": "Fallback Album",
            "filename": "02 - Far.flac",
            "title": "Far",
            "track_number": 2,
            "format": "flac",
            "path": "/music/Fallback Artist/Fallback Album/02 - Far.flac",
        })

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = NULL
                    WHERE path = :path
                    """
                ),
                {
                    "vector": [0.0] * 20,
                    "path": "/music/Fallback Artist/Fallback Album/01 - Near.flac",
                },
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = NULL
                    WHERE path = :path
                    """
                ),
                {
                    "vector": [1.0] * 20,
                    "path": "/music/Fallback Artist/Fallback Album/02 - Far.flac",
                },
            )

        candidate = _find_best_candidate(
            [0.0] * 20,
            exclude_ids=set(),
            exclude_titles=set(),
            recent_artists=[],
            sim_graph={},
            genre_map={},
            member_graph={},
            target_artists=[],
        )

        assert candidate is not None
        assert candidate["title"] == "Near"

    def test_find_anchor_track_falls_back_to_bliss_vector_when_embedding_missing(self, pg_db):
        from crate.db.paths import _find_anchor_track
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Anchor Artist"})
        artist = pg_db.get_library_artist("Anchor Artist")
        assert artist is not None
        album_id = pg_db.upsert_album({
            "artist": "Anchor Artist",
            "name": "Anchor Album",
            "path": "/music/Anchor Artist/Anchor Album",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Anchor Artist",
            "album": "Anchor Album",
            "filename": "01 - Close.flac",
            "title": "Close",
            "track_number": 1,
            "format": "flac",
            "path": "/music/Anchor Artist/Anchor Album/01 - Close.flac",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Anchor Artist",
            "album": "Anchor Album",
            "filename": "02 - Distant.flac",
            "title": "Distant",
            "track_number": 2,
            "format": "flac",
            "path": "/music/Anchor Artist/Anchor Album/02 - Distant.flac",
        })

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = NULL
                    WHERE path = :path
                    """
                ),
                {
                    "vector": [0.1] * 20,
                    "path": "/music/Anchor Artist/Anchor Album/01 - Close.flac",
                },
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = NULL
                    WHERE path = :path
                    """
                ),
                {
                    "vector": [0.9] * 20,
                    "path": "/music/Anchor Artist/Anchor Album/02 - Distant.flac",
                },
            )

        anchor = _find_anchor_track("artist", str(artist["id"]), [0.1] * 20, set())

        assert anchor is not None
        assert anchor["title"] == "Close"


class TestTaskCRUD:
    def test_create_task(self, pg_db):
        task_id = pg_db.create_task("scan", {"only": "naming"})
        assert task_id is not None
        assert len(task_id) == 12

    def test_create_task_with_shared_session_dispatches_after_commit(self, pg_db):
        from crate.db.tx import transaction_scope

        with patch("crate.db.repositories.tasks_mutations.dispatch_task") as mock_dispatch:
            with transaction_scope() as session:
                task_id = pg_db.create_task("scan", session=session)
                assert mock_dispatch.call_count == 0
                assert pg_db.get_task(task_id) is None

            mock_dispatch.assert_called_once_with("scan", task_id)
            assert pg_db.get_task(task_id) is not None

    def test_create_task_with_shared_session_does_not_dispatch_on_rollback(self, pg_db):
        from crate.db.tx import transaction_scope

        task_id = None
        with patch("crate.db.repositories.tasks_mutations.dispatch_task") as mock_dispatch:
            with pytest.raises(RuntimeError, match="boom"):
                with transaction_scope() as session:
                    task_id = pg_db.create_task("scan", session=session)
                    raise RuntimeError("boom")

        assert task_id is not None
        assert mock_dispatch.call_count == 0
        assert pg_db.get_task(task_id) is None

    def test_cleanup_zombie_tasks_marks_stale_running_rows_failed(self, pg_db):
        from crate.db.tasks import cleanup_zombie_tasks
        from crate.db.tx import transaction_scope

        now = datetime.now(timezone.utc)
        stale_heartbeat_task = uuid4().hex[:12]
        stale_updated_task = uuid4().hex[:12]
        healthy_task = uuid4().hex[:12]

        with transaction_scope() as session:
            for task_id, heartbeat_at, updated_at in (
                (
                    stale_heartbeat_task,
                    now - timedelta(minutes=12),
                    now - timedelta(minutes=1),
                ),
                (
                    stale_updated_task,
                    None,
                    now - timedelta(minutes=8),
                ),
                (
                    healthy_task,
                    now - timedelta(minutes=1),
                    now - timedelta(minutes=1),
                ),
            ):
                session.execute(
                    text(
                        """
                        INSERT INTO tasks (
                            id, type, status, params_json, priority, pool,
                            max_duration_sec, max_retries, created_at, updated_at, heartbeat_at
                        ) VALUES (
                            :id, 'scan', 'running', '{}'::jsonb, 2, 'default',
                            1800, 0, :created_at, :updated_at, :heartbeat_at
                        )
                        """
                    ),
                    {
                        "id": task_id,
                        "created_at": now.isoformat(),
                        "updated_at": updated_at.isoformat(),
                        "heartbeat_at": heartbeat_at.isoformat() if heartbeat_at else None,
                    },
                )

        cleaned = cleanup_zombie_tasks(heartbeat_timeout_min=5, no_heartbeat_timeout_min=3)

        assert cleaned == 2
        assert pg_db.get_task(stale_heartbeat_task)["status"] == "failed"
        assert pg_db.get_task(stale_updated_task)["status"] == "failed"
        assert pg_db.get_task(healthy_task)["status"] == "running"


class TestManagementQueries:
    def test_upsert_metric_rollup_inserts_and_accumulates_jsonb_tags(self, pg_db):
        from crate.db.management import upsert_metric_rollup, query_metric_rollups
        from crate.db.tx import transaction_scope

        metric_name = f"test.metric.rollup.{uuid4().hex[:8]}"
        tags_json = json.dumps({"route": "/api/status", "status": "200"}, sort_keys=True)
        bucket_start = "2026-04-23T00:00:00+00:00"

        with transaction_scope() as session:
            session.execute(
                text("DELETE FROM metric_rollups WHERE name = :name"),
                {"name": metric_name},
            )

        upsert_metric_rollup(
            name=metric_name,
            tags_json=tags_json,
            period="hour",
            bucket_start=bucket_start,
            count=2,
            sum_value=300.0,
            min_value=100.0,
            max_value=200.0,
            avg_value=150.0,
        )
        upsert_metric_rollup(
            name=metric_name,
            tags_json=tags_json,
            period="hour",
            bucket_start=bucket_start,
            count=1,
            sum_value=150.0,
            min_value=150.0,
            max_value=150.0,
            avg_value=150.0,
        )

        rows = query_metric_rollups(name=metric_name, period="hour", limit=10)

        assert len(rows) == 1
        row = rows[0]
        assert row["count"] == 3
        assert float(row["sum_value"]) == pytest.approx(450.0)
        assert float(row["min_value"]) == pytest.approx(100.0)
        assert float(row["max_value"]) == pytest.approx(200.0)
        assert float(row["avg_value"]) == pytest.approx(150.0)
        assert row["tags_json"] == json.loads(tags_json)


class TestPlaylistQueryBatching:
    def test_list_system_playlists_batches_artwork_fetch(self):
        from contextlib import contextmanager
        from types import SimpleNamespace

        from crate.db.playlists import list_system_playlists

        execute_calls: list[tuple[object, dict | None]] = []
        main_rows = [
            {
                "playlist": SimpleNamespace(
                    id=1,
                    name="Playlist One",
                    description="A",
                    cover_data_url=None,
                    cover_path=None,
                    user_id=None,
                    is_smart=False,
                    smart_rules_json=None,
                    scope="system",
                    visibility="public",
                    is_collaborative=False,
                    generation_mode="static",
                    auto_refresh_enabled=False,
                    is_curated=True,
                    is_active=True,
                    managed_by_user_id=None,
                    curation_key=None,
                    featured_rank=None,
                    category=None,
                    track_count=0,
                    total_duration=0,
                    generation_status=None,
                    generation_error=None,
                    last_generated_at=None,
                    created_at="2026-04-23T10:00:00+00:00",
                    updated_at="2026-04-23T12:00:00+00:00",
                ),
                "follower_count": 3,
                "is_followed": True,
            },
            {
                "playlist": SimpleNamespace(
                    id=2,
                    name="Playlist Two",
                    description="B",
                    cover_data_url=None,
                    cover_path=None,
                    user_id=None,
                    is_smart=False,
                    smart_rules_json=None,
                    scope="system",
                    visibility="public",
                    is_collaborative=False,
                    generation_mode="smart",
                    auto_refresh_enabled=False,
                    is_curated=True,
                    is_active=True,
                    managed_by_user_id=None,
                    curation_key=None,
                    featured_rank=None,
                    category=None,
                    track_count=0,
                    total_duration=0,
                    generation_status=None,
                    generation_error=None,
                    last_generated_at=None,
                    created_at="2026-04-23T09:00:00+00:00",
                    updated_at="2026-04-23T11:00:00+00:00",
                ),
                "follower_count": 1,
                "is_followed": False,
            },
        ]
        artwork_rows = [
            {
                "playlist_id": 1,
                "artist": "Converge",
                "artist_id": 101,
                "artist_slug": "converge",
                "album": "Jane Doe",
                "album_id": 201,
                "album_slug": "jane-doe",
            },
            {
                "playlist_id": 2,
                "artist": "Poison The Well",
                "artist_id": 102,
                "artist_slug": "poison-the-well",
                "album": "The Opposite of December",
                "album_id": 202,
                "album_slug": "the-opposite-of-december",
            },
        ]

        class MockMappings:
            def __init__(self, rows):
                self._rows = rows

            def all(self):
                return self._rows

        class MockSession:
            def execute(self, statement, params=None):
                execute_calls.append((statement, params))
                rows = main_rows if len(execute_calls) == 1 else artwork_rows

                class Result:
                    def all(self_nonlocal):
                        if rows is main_rows:
                            return [(row["playlist"], row["follower_count"], row["is_followed"]) for row in rows]
                        return rows

                    def mappings(self_nonlocal):
                        return MockMappings(rows)

                return Result()

        @contextmanager
        def mock_scope():
            yield MockSession()

        with patch("crate.db.repositories.playlists_collection_reads.read_scope", mock_scope):
            playlists = list_system_playlists(user_id=7)

        assert len(execute_calls) == 2
        assert [playlist["id"] for playlist in playlists] == [1, 2]
        assert playlists[0]["follower_count"] == 3
        assert playlists[0]["is_followed"] is True
        assert playlists[0]["artwork_tracks"][0]["artist"] == "Converge"
        assert playlists[1]["artwork_tracks"][0]["artist"] == "Poison The Well"


class TestHomeCaching:
    def test_get_or_compute_home_cache_coalesces_in_process(self):
        from crate.db.home import _get_or_compute_home_cache

        cache_store: dict[str, dict] = {}
        compute_started = Event()
        release_compute = Event()
        compute_calls = {"count": 0}
        results: list[dict] = []

        def fake_get_cache(key: str, max_age_seconds: int | None = None):
            return cache_store.get(key)

        def fake_set_cache(key: str, value: dict, ttl: int | None = None):
            cache_store[key] = value

        def compute() -> dict:
            compute_calls["count"] += 1
            compute_started.set()
            release_compute.wait(2)
            return {"ok": True, "n": compute_calls["count"]}

        def worker():
            results.append(
                _get_or_compute_home_cache(
                    "home:test:1",
                    max_age_seconds=600,
                    ttl=600,
                    compute=compute,
                )
            )

        with patch("crate.db.cache_store.get_cache", side_effect=fake_get_cache), \
             patch("crate.db.cache_store.set_cache", side_effect=fake_set_cache):
            thread_one = Thread(target=worker)
            thread_one.start()
            assert compute_started.wait(1)

            thread_two = Thread(target=worker)
            thread_two.start()

            time.sleep(0.05)
            release_compute.set()
            thread_one.join()
            thread_two.join()

        assert compute_calls["count"] == 1
        assert results == [{"ok": True, "n": 1}, {"ok": True, "n": 1}]

    def test_get_or_compute_home_cache_waits_for_cross_process_notification(self):
        from crate.db.home import _get_or_compute_home_cache
        from crate.db.home_cache import _home_cache_ready_channel

        class FakePubSub:
            def __init__(self):
                self.messages: list[dict] = []
                self.signal = Event()
                self.subscribed: list[str] = []
                self.unsubscribed: list[str] = []
                self.closed = False

            def subscribe(self, channel: str):
                self.subscribed.append(channel)

            def unsubscribe(self, channel: str):
                self.unsubscribed.append(channel)

            def get_message(self, ignore_subscribe_messages: bool = True, timeout: float = 0.0):
                del ignore_subscribe_messages
                if not self.signal.wait(timeout):
                    return None
                self.signal.clear()
                if self.messages:
                    return self.messages.pop(0)
                return None

            def close(self):
                self.closed = True

            def push(self, payload: str):
                self.messages.append({"type": "message", "data": payload})
                self.signal.set()

        class FakeRedis:
            def __init__(self, pubsub: FakePubSub):
                self._pubsub = pubsub
                self.published: list[tuple[str, str]] = []

            def set(self, *args, **kwargs):
                return False

            def pubsub(self):
                return self._pubsub

            def publish(self, channel: str, payload: str):
                self.published.append((channel, payload))
                self._pubsub.push(payload)

        cache_store: dict[str, dict] = {}
        cache_key = "home:test:cross-process"
        cache_reads = {"count": 0}
        fake_pubsub = FakePubSub()
        fake_redis = FakeRedis(fake_pubsub)
        result: list[dict] = []

        def fake_get_cache(key: str, max_age_seconds: int | None = None):
            del max_age_seconds
            cache_reads["count"] += 1
            return cache_store.get(key)

        def fake_set_cache(key: str, value: dict, ttl: int | None = None):
            del ttl
            cache_store[key] = value

        def worker():
            result.append(
                _get_or_compute_home_cache(
                    cache_key,
                    max_age_seconds=600,
                    ttl=600,
                    compute=lambda: (_ for _ in ()).throw(AssertionError("compute should not run")),
                    wait_timeout_seconds=1.0,
                )
            )

        with patch("crate.db.cache_store.get_cache", side_effect=fake_get_cache), \
             patch("crate.db.cache_store.set_cache", side_effect=fake_set_cache), \
             patch("crate.db.cache_runtime._get_redis", return_value=fake_redis):
            thread = Thread(target=worker)
            thread.start()

            time.sleep(0.35)
            cache_store[cache_key] = {"ok": True}
            fake_redis.publish(_home_cache_ready_channel(cache_key), "ready")
            thread.join()

        assert result == [{"ok": True}]
        assert fake_pubsub.subscribed == [_home_cache_ready_channel(cache_key)]
        assert fake_pubsub.unsubscribed == [_home_cache_ready_channel(cache_key)]
        assert fake_pubsub.closed is True
        assert cache_reads["count"] <= 4

    def test_get_home_context_skips_fallback_genre_query_when_top_genres_exist(self):
        from crate.db.home import _get_home_context

        with patch("crate.db.home.get_followed_artists", return_value=[{"artist_name": "Converge"}]), \
             patch("crate.db.home.get_saved_albums", return_value=[]), \
             patch("crate.db.home.get_top_artists", return_value=[{"artist_name": "Converge"}]), \
             patch("crate.db.home.get_top_albums", return_value=[]), \
             patch("crate.db.home.get_top_genres", return_value=[{"genre_name": "Metalcore", "play_count": 10}]), \
             patch("crate.db.home.get_followed_artist_genre_names", side_effect=AssertionError("fallback genre query should not run")):
            context = _get_home_context(1)

        assert context["top_genres_lower"]
        assert context["mix_seed_genres"]

    def test_get_task(self, pg_db):
        task_id = pg_db.create_task("scan")
        task = pg_db.get_task(task_id)
        assert task is not None
        assert task["id"] == task_id
        assert task["type"] == "scan"
        assert task["status"] == "pending"
        assert task["params"] == {}

    def test_get_task_not_found(self, pg_db):
        assert pg_db.get_task("nonexistent") is None

    def test_update_task_status(self, pg_db):
        task_id = pg_db.create_task("scan")
        pg_db.update_task(task_id, status="running")
        task = pg_db.get_task(task_id)
        assert task["status"] == "running"

    def test_update_task_progress(self, pg_db):
        task_id = pg_db.create_task("scan")
        pg_db.update_task(task_id, progress="50%")
        task = pg_db.get_task(task_id)
        assert task["progress"] == "50%"

    def test_update_task_result(self, pg_db):
        task_id = pg_db.create_task("scan")
        pg_db.update_task(task_id, status="completed", result={"issues": 5})
        task = pg_db.get_task(task_id)
        assert task["status"] == "completed"
        assert task["result"] == {"issues": 5}

    def test_update_task_error(self, pg_db):
        task_id = pg_db.create_task("scan")
        pg_db.update_task(task_id, status="failed", error="Something broke")
        task = pg_db.get_task(task_id)
        assert task["status"] == "failed"
        assert task["error"] == "Something broke"

    def test_list_tasks(self, pg_db):
        pg_db.create_task("scan")
        pg_db.create_task("library_sync")
        pg_db.create_task("scan")
        tasks = pg_db.list_tasks()
        assert len(tasks) == 3

    def test_list_tasks_filter_status(self, pg_db):
        t1 = pg_db.create_task("scan")
        pg_db.create_task("scan")
        pg_db.update_task(t1, status="running")
        running = pg_db.list_tasks(status="running")
        assert len(running) == 1
        assert running[0]["id"] == t1

    def test_list_tasks_filter_type(self, pg_db):
        pg_db.create_task("scan")
        pg_db.create_task("library_sync")
        scans = pg_db.list_tasks(task_type="scan")
        assert len(scans) == 1

    def test_list_tasks_limit(self, pg_db):
        for _ in range(5):
            pg_db.create_task("scan")
        tasks = pg_db.list_tasks(limit=3)
        assert len(tasks) == 3

    def test_get_task_activity_snapshot(self, pg_db):
        from crate.db.queries.tasks import get_task_activity_snapshot

        running_id = pg_db.create_task("scan", pool="fast")
        delegated_id = pg_db.create_task("library_sync", pool="heavy")
        pending_id = pg_db.create_task("repair", pool="default")
        heavy_pending_id = pg_db.create_task("migrate_storage_v2", pool="heavy")
        completed_id = pg_db.create_task("enrich", pool="default")

        pg_db.update_task(running_id, status="running")
        pg_db.update_task(delegated_id, status="delegated")
        pg_db.update_task(completed_id, status="completed")

        snapshot = get_task_activity_snapshot(running_limit=10, pending_limit=10, recent_limit=10)

        assert snapshot["running_count"] == 2
        assert snapshot["pending_count"] == 2
        assert {task["id"] for task in snapshot["running_tasks"]} == {running_id, delegated_id}
        assert {task["id"] for task in snapshot["pending_tasks"]} == {pending_id, heavy_pending_id}
        assert snapshot["queue_breakdown"] == {
            "running": {"fast": 1, "default": 0, "heavy": 1, "maintenance": 0, "playback": 0},
            "pending": {"fast": 0, "default": 1, "heavy": 1, "maintenance": 0, "playback": 0},
        }
        assert snapshot["db_heavy_gate"] == {"active": 0, "pending": 2, "blocking": False}
        assert {task["id"] for task in snapshot["recent_tasks"]} >= {
            running_id,
            delegated_id,
            pending_id,
            heavy_pending_id,
            completed_id,
        }

    def test_claim_next_task(self, pg_db):
        t1 = pg_db.create_task("scan")
        pg_db.create_task("library_sync")
        claimed = pg_db.claim_next_task()
        assert claimed is not None
        assert claimed["id"] == t1
        # After claiming, task should be running
        task = pg_db.get_task(t1)
        assert task["status"] == "running"

    def test_claim_next_task_empty(self, pg_db):
        assert pg_db.claim_next_task() is None

    def test_claim_skips_running(self, pg_db):
        t1 = pg_db.create_task("scan")
        pg_db.update_task(t1, status="running")
        t2 = pg_db.create_task("scan")
        claimed = pg_db.claim_next_task()
        assert claimed["id"] == t2

    def test_task_params_preserved(self, pg_db):
        task_id = pg_db.create_task("scan", {"only": "naming", "deep": True})
        task = pg_db.get_task(task_id)
        assert task["params"]["only"] == "naming"
        assert task["params"]["deep"] is True


class TestSettings:
    def test_get_setting_default(self, pg_db):
        val = pg_db.get_setting("nonexistent", "default_val")
        assert val == "default_val"

    def test_set_and_get_setting(self, pg_db):
        pg_db.set_setting("theme", "dark")
        assert pg_db.get_setting("theme") == "dark"

    def test_set_setting_upsert(self, pg_db):
        pg_db.set_setting("theme", "dark")
        pg_db.set_setting("theme", "light")
        assert pg_db.get_setting("theme") == "light"

    def test_get_setting_none_default(self, pg_db):
        assert pg_db.get_setting("missing") is None


class TestCache:
    def test_set_and_get_cache(self, pg_db):
        pg_db.set_cache("test_key", {"value": 42})
        result = pg_db.get_cache("test_key")
        assert result == {"value": 42}

    def test_get_cache_missing(self, pg_db):
        assert pg_db.get_cache("nonexistent") is None

    def test_delete_cache(self, pg_db):
        pg_db.set_cache("to_delete", {"x": 1})
        pg_db.delete_cache("to_delete")
        assert pg_db.get_cache("to_delete") is None

    def test_cache_upsert(self, pg_db):
        pg_db.set_cache("key", {"v": 1})
        pg_db.set_cache("key", {"v": 2})
        assert pg_db.get_cache("key") == {"v": 2}

    def test_cache_max_age(self, pg_db):
        from unittest.mock import patch
        pg_db.set_cache("aged", {"data": True})
        # With a very large max_age, should return data
        result = pg_db.get_cache("aged", max_age_seconds=3600)
        assert result is not None
        # Clear L1 memory cache and disable L2 Redis so max_age is tested at PG level
        from crate.db.cache import _mem_cache
        _mem_cache.pop("aged", None)
        with patch("crate.db.cache_store._get_redis", return_value=None):
            # With max_age=0, should return None (expired immediately)
            result = pg_db.get_cache("aged", max_age_seconds=0)
            assert result is None


class TestMBCache:
    def test_set_and_get_mb_cache(self, pg_db):
        pg_db.set_mb_cache("artist:test", {"mbid": "abc123"})
        result = pg_db.get_mb_cache("artist:test")
        assert result == {"mbid": "abc123"}

    def test_get_mb_cache_missing(self, pg_db):
        assert pg_db.get_mb_cache("nonexistent") is None


class TestLibraryCRUD:
    def test_upsert_artist(self, pg_db):
        pg_db.upsert_artist({
            "name": "Test Artist",
            "album_count": 3,
            "track_count": 30,
            "total_size": 1024 * 1024 * 500,
            "formats": ["flac", "mp3"],
            "primary_format": "flac",
            "has_photo": 1,
            "dir_mtime": 1700000000.0,
        })
        artist = pg_db.get_library_artist("Test Artist")
        assert artist is not None
        assert artist["name"] == "Test Artist"
        assert artist["album_count"] == 3
        assert artist["track_count"] == 30
        assert "flac" in artist["formats"]
        assert artist["entity_uid"] is not None
        assert artist["storage_id"] is None

    def test_upsert_artist_update(self, pg_db):
        pg_db.upsert_artist({"name": "Artist A", "album_count": 1, "track_count": 5})
        pg_db.upsert_artist({"name": "Artist A", "album_count": 2, "track_count": 15})
        artist = pg_db.get_library_artist("Artist A")
        assert artist["album_count"] == 2
        assert artist["track_count"] == 15

    def test_upsert_artist_entity_uid_stays_stable_when_mbid_arrives_later(self, pg_db):
        pg_db.upsert_artist({"name": "High Vis"})
        original = pg_db.get_library_artist("High Vis")
        assert original is not None

        pg_db.upsert_artist({"name": "High Vis", "mbid": "123e4567-e89b-12d3-a456-426614174000"})
        updated = pg_db.get_library_artist("High Vis")

        assert updated is not None
        assert updated["entity_uid"] == original["entity_uid"]
        assert updated["mbid"] == "123e4567-e89b-12d3-a456-426614174000"

    def test_upsert_artist_reuses_canonical_name_for_same_storage_identity(self, pg_db):
        storage_id = "d7b2189f-8d0c-4909-87fe-fd465daa2aac"
        canonical = pg_db.upsert_artist(
            {
                "name": "Terror",
                "storage_id": storage_id,
                "folder_name": storage_id,
                "album_count": 0,
                "track_count": 0,
                "total_size": 0,
                "formats": [],
            }
        )
        assert canonical == "Terror"

        reused = pg_db.upsert_artist(
            {
                "name": "terror",
                "storage_id": storage_id,
                "folder_name": storage_id,
                "album_count": 0,
                "track_count": 0,
                "total_size": 0,
                "formats": [],
            }
        )
        assert reused == "Terror"

        artists, _total = pg_db.get_library_artists(per_page=100)
        terror_rows = [artist for artist in artists if artist["name"].lower() == "terror"]
        assert len(terror_rows) == 1

    def test_upsert_artist_updates_existing_row_by_storage_identity_without_duplicate_insert(self, pg_db):
        from crate.db.tx import transaction_scope

        storage_id = "d7b2189f-8d0c-4909-87fe-fd465daa2aac"
        canonical = pg_db.upsert_artist(
            {
                "name": "Terror",
                "storage_id": storage_id,
                "folder_name": storage_id,
                "album_count": 0,
                "track_count": 0,
                "total_size": 0,
                "formats": [],
            }
        )
        assert canonical == "Terror"

        with transaction_scope() as session:
            reused = pg_db.upsert_artist(
                {
                    "name": "Terror ",
                    "storage_id": storage_id,
                    "folder_name": storage_id,
                    "album_count": 2,
                    "track_count": 22,
                    "total_size": 2048,
                    "formats": ["flac"],
                },
                session=session,
            )
            assert reused == "Terror"

        artist = pg_db.get_library_artist("Terror")
        assert artist is not None
        assert artist["track_count"] == 22
        artists, _total = pg_db.get_library_artists(per_page=100)
        terror_rows = [row for row in artists if row["name"] == "Terror"]
        assert len(terror_rows) == 1
        with transaction_scope() as session:
            raw_artist = session.execute(
                text(
                    """
                    SELECT storage_id::text AS storage_id
                    FROM library_artists
                    WHERE name = :name
                    """
                ),
                {"name": "Terror"},
            ).mappings().first()
            keys = session.execute(
                text(
                    """
                    SELECT key_type, key_value
                    FROM entity_identity_keys
                    WHERE entity_type = 'artist' AND entity_uid::text = :entity_uid
                    ORDER BY key_type
                    """
                ),
                {"entity_uid": artist["entity_uid"]},
            ).mappings().all()
        assert raw_artist is not None
        assert raw_artist["storage_id"] == storage_id
        assert {row["key_type"] for row in keys} >= {"name", "slug"}

    def test_upsert_album(self, pg_db):
        pg_db.upsert_artist({"name": "Artist B"})
        album_id = pg_db.upsert_album({
            "artist": "Artist B",
            "name": "Album One",
            "path": "/music/Artist B/Album One",
            "track_count": 10,
            "total_size": 1024 * 1024 * 100,
            "total_duration": 3600.0,
            "formats": ["flac"],
            "year": "2023",
            "genre": "Rock",
            "has_cover": 1,
        })
        assert album_id is not None
        assert isinstance(album_id, int)
        album = pg_db.get_library_album("Artist B", "Album One")
        assert album is not None
        assert album["entity_uid"] is not None
        assert album["storage_id"] is None

    def test_upsert_track(self, pg_db):
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Artist C"})
        album_id = pg_db.upsert_album({
            "artist": "Artist C",
            "name": "Album X",
            "path": "/music/Artist C/Album X",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Artist C",
            "album": "Album X",
            "filename": "01 - Song.flac",
            "title": "Song",
            "track_number": 1,
            "format": "flac",
            "path": "/music/Artist C/Album X/01 - Song.flac",
        })
        tracks = pg_db.get_library_tracks(album_id)
        assert len(tracks) == 1
        assert tracks[0]["title"] == "Song"
        assert tracks[0]["entity_uid"] is not None
        assert tracks[0]["storage_id"] is None

        with transaction_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT pipeline, state
                    FROM track_processing_state
                    WHERE track_id = :track_id
                    ORDER BY pipeline
                    """
                ),
                {"track_id": tracks[0]["id"]},
            ).mappings().all()

        assert [row["pipeline"] for row in rows] == ["analysis", "bliss"]
        assert all(row["state"] == "pending" for row in rows)

    def test_upsert_track_reuses_row_when_path_changes_but_entity_uid_matches(self, pg_db):
        from crate.db.tx import transaction_scope

        pg_db.upsert_artist({"name": "Converge"})
        album_id = pg_db.upsert_album(
            {
                "artist": "Converge",
                "name": "Jane Doe",
                "path": "/music/converge/jane-doe",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Converge",
                "album": "Jane Doe",
                "entity_uid": "123e4567-e89b-12d3-a456-426614174100",
                "filename": "01.flac",
                "title": "Concubine",
                "track_number": 1,
                "disc_number": 1,
                "path": "/music/converge/jane-doe/01.flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "Converge",
                "album": "Jane Doe",
                "entity_uid": "123e4567-e89b-12d3-a456-426614174100",
                "filename": "01-concubine.flac",
                "title": "Concubine",
                "track_number": 1,
                "disc_number": 1,
                "path": "/music/converge/jane-doe-remastered/01-concubine.flac",
            }
        )

        tracks = pg_db.get_library_tracks(album_id)
        assert len(tracks) == 1
        assert tracks[0]["path"] == "/music/converge/jane-doe-remastered/01-concubine.flac"
        with transaction_scope() as session:
            count = session.execute(text("SELECT COUNT(*)::int AS cnt FROM library_tracks")).mappings().first()["cnt"]
        assert count == 1

    def test_get_library_artists_pagination(self, pg_db):
        for i in range(5):
            pg_db.upsert_artist({"name": f"Artist {i:02d}"})
        artists, total = pg_db.get_library_artists(page=1, per_page=3)
        assert total == 5
        assert len(artists) == 3

    def test_get_library_artists_search(self, pg_db):
        pg_db.upsert_artist({"name": "Radiohead"})
        pg_db.upsert_artist({"name": "Rage Against The Machine"})
        pg_db.upsert_artist({"name": "Tool"})
        artists, total = pg_db.get_library_artists(q="Radio")
        assert total == 1
        assert artists[0]["name"] == "Radiohead"

    def test_get_library_stats(self, pg_db):
        pg_db.upsert_artist({"name": "Stats Artist", "total_size": 500000})
        album_id = pg_db.upsert_album({
            "artist": "Stats Artist",
            "name": "Stats Album",
            "path": "/music/Stats Artist/Stats Album",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Stats Artist",
            "album": "Stats Album",
            "filename": "track.flac",
            "format": "flac",
            "path": "/music/Stats Artist/Stats Album/track.flac",
        })
        stats = pg_db.get_library_stats()
        assert stats["artists"] == 1
        assert stats["albums"] == 1
        assert stats["tracks"] == 1

    def test_delete_artist_cascades(self, pg_db):
        pg_db.upsert_artist({"name": "Delete Me"})
        album_id = pg_db.upsert_album({
            "artist": "Delete Me",
            "name": "Gone Album",
            "path": "/music/Delete Me/Gone Album",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Delete Me",
            "album": "Gone Album",
            "filename": "track.flac",
            "path": "/music/Delete Me/Gone Album/track.flac",
        })
        pg_db.delete_artist("Delete Me")
        assert pg_db.get_library_artist("Delete Me") is None
        assert pg_db.get_library_albums("Delete Me") == []

    def test_delete_album(self, pg_db):
        pg_db.upsert_artist({"name": "ArtistD"})
        pg_db.upsert_album({
            "artist": "ArtistD",
            "name": "AlbumToDelete",
            "path": "/music/ArtistD/AlbumToDelete",
        })
        pg_db.delete_album("/music/ArtistD/AlbumToDelete")
        assert pg_db.get_library_album("ArtistD", "AlbumToDelete") is None


class TestDirMtimes:
    def test_set_and_get(self, pg_db):
        pg_db.set_dir_mtime("/music/Artist/Album", 1700000000.0, {"tracks": 10})
        result = pg_db.get_dir_mtime("/music/Artist/Album")
        assert result is not None
        mtime, data = result
        assert mtime == 1700000000.0
        assert data == {"tracks": 10}

    def test_get_missing(self, pg_db):
        assert pg_db.get_dir_mtime("/nonexistent") is None

    def test_delete(self, pg_db):
        pg_db.set_dir_mtime("/music/temp", 1.0)
        pg_db.delete_dir_mtime("/music/temp")
        assert pg_db.get_dir_mtime("/music/temp") is None

    def test_get_all_with_prefix(self, pg_db):
        pg_db.set_dir_mtime("/music/A/Album1", 1.0)
        pg_db.set_dir_mtime("/music/A/Album2", 2.0)
        pg_db.set_dir_mtime("/music/B/Album1", 3.0)
        result = pg_db.get_all_dir_mtimes("/music/A/")
        assert len(result) == 2


class TestScanResults:
    def test_save_and_get_latest(self, pg_db):
        task_id = pg_db.create_task("scan")
        issues = [{"type": "bad_naming", "severity": "warning", "description": "test"}]
        pg_db.save_scan_result(task_id, issues)
        latest = pg_db.get_latest_scan()
        assert latest is not None
        assert len(latest["issues"]) == 1
        assert latest["issues"][0]["type"] == "bad_naming"

    def test_get_latest_scan_empty(self, pg_db):
        assert pg_db.get_latest_scan() is None


class TestReadModels:
    def test_ui_snapshot_roundtrip_and_versioning(self, pg_db):
        from crate.db.read_models import get_or_build_ui_snapshot, get_ui_snapshot, upsert_ui_snapshot

        upsert_ui_snapshot(
            "ops",
            "dashboard",
            {"status": {"pending_imports": 3}},
            generation_ms=11,
            stale_after_seconds=30,
        )
        first = get_ui_snapshot("ops", "dashboard", max_age_seconds=30)

        assert first is not None
        assert first["version"] == 1

        snapshot = get_or_build_ui_snapshot(
            scope="ops",
            subject_key="dashboard",
            max_age_seconds=30,
            fresh=False,
            build=lambda: {"status": {"pending_imports": 9}},
        )
        assert snapshot["status"]["pending_imports"] == 3
        assert snapshot["snapshot"]["version"] == 1

        upsert_ui_snapshot(
            "ops",
            "dashboard",
            {"status": {"pending_imports": 7}},
            generation_ms=9,
            stale_after_seconds=30,
        )
        second = get_ui_snapshot("ops", "dashboard", max_age_seconds=30)

        assert second is not None
        assert second["version"] == 2

    def test_ui_snapshot_records_source_sequence(self, pg_db, monkeypatch):
        from crate.db.read_models import get_or_build_ui_snapshot

        monkeypatch.setattr("crate.db.ui_snapshot_building.get_latest_domain_event_id", lambda **kw: 42)

        snapshot = get_or_build_ui_snapshot(
            scope="ops",
            subject_key="dashboard",
            max_age_seconds=30,
            fresh=True,
            build=lambda: {"status": {"pending_imports": 1}},
        )

        assert snapshot["snapshot"]["source_seq"] == 42

    def test_mark_ui_snapshots_stale_marks_matching_rows(self, pg_db):
        from crate.db.read_models import get_ui_snapshot, mark_ui_snapshots_stale, upsert_ui_snapshot

        upsert_ui_snapshot("home:discovery", "1", {"hero": None}, stale_after_seconds=300)
        fresh = get_ui_snapshot("home:discovery", "1", max_age_seconds=300)
        assert fresh is not None

        affected = mark_ui_snapshots_stale(scope_prefix="home:")
        stale = get_ui_snapshot("home:discovery", "1", max_age_seconds=300)

        assert affected >= 1
        assert stale is None

    def test_analytics_surfaces_facade_reexports_snapshot_helpers(self, pg_db):
        from crate.db.analytics_surfaces import empty_missing_report, empty_quality_report, missing_snapshot_subject_key

        quality = empty_quality_report(computing=True, task_id="quality-1")
        missing = empty_missing_report(
            artist="Drive Like Jehu",
            artist_id=7,
            local=[{"id": 10, "name": "Yank Crime"}],
            error="missing metadata",
        )

        assert quality["computing"] is True
        assert quality["task_id"] == "quality-1"
        assert missing["artist_id"] == 7
        assert missing["local_count"] == 1
        assert missing["error"] == "missing metadata"
        assert missing_snapshot_subject_key(7) == "artist:7"

    def test_ops_runtime_state_roundtrip(self, pg_db):
        from crate.db.read_models import get_ops_runtime_state, set_ops_runtime_state

        set_ops_runtime_state("public_status", {"pending_imports": 4, "issue_count": 2})
        state = get_ops_runtime_state("public_status", max_age_seconds=30)

        assert state is not None
        assert state["pending_imports"] == 4
        assert state["issue_count"] == 2

    def test_upsert_ui_snapshot_publishes_snapshot_update_when_committing_its_own_tx(self, pg_db):
        from crate.db.ui_snapshot_store import upsert_ui_snapshot

        with patch("crate.db.ui_snapshot_store.publish_snapshot_update") as publish_snapshot_update:
            saved = upsert_ui_snapshot(
                "ops",
                "dashboard",
                {"status": {"pending_imports": 5}},
                generation_ms=7,
                stale_after_seconds=30,
            )

        assert saved["version"] == 1
        publish_snapshot_update.assert_called_once_with("ops", "dashboard", 1)
