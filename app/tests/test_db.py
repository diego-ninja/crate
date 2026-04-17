"""Tests for crate.db — CRUD operations on PostgreSQL."""

import json
import os
import time
from datetime import datetime, timezone
from unittest.mock import patch

import psycopg2
import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE, TEST_DB_NAME

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestBootstrapBridge:
    def test_init_db_stamps_alembic_baseline(self, pg_db):
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            row = session.execute(text("SELECT version_num FROM alembic_version")).mappings().first()

        assert row is not None
        assert row["version_num"] == "001"

    def test_init_db_marks_legacy_bridge_versions_applied(self, pg_db):
        import crate.db.core as db_core
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            row = session.execute(text("SELECT COUNT(*) AS cnt FROM schema_versions")).mappings().first()

        assert row is not None
        assert row["cnt"] == len(db_core._MIGRATIONS)

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
        assert _count("crate") == 0


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


class TestGenreTaxonomyCleanup:
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
            edge_count = session.execute(
                text("SELECT COUNT(*)::INTEGER AS cnt FROM genre_taxonomy_edges")
            ).mappings().first()["cnt"]

        assert alias_count == 0
        assert edge_count == 0


class TestTaskCRUD:
    def test_create_task(self, pg_db):
        task_id = pg_db.create_task("scan", {"only": "naming"})
        assert task_id is not None
        assert len(task_id) == 12

    def test_create_task_with_shared_session_dispatches_after_commit(self, pg_db):
        from crate.db.tx import transaction_scope

        with patch("crate.db.tasks._dispatch_task") as mock_dispatch:
            with transaction_scope() as session:
                task_id = pg_db.create_task("scan", session=session)
                assert mock_dispatch.call_count == 0
                assert pg_db.get_task(task_id) is None

            mock_dispatch.assert_called_once_with("scan", task_id)
            assert pg_db.get_task(task_id) is not None

    def test_create_task_with_shared_session_does_not_dispatch_on_rollback(self, pg_db):
        from crate.db.tx import transaction_scope

        task_id = None
        with patch("crate.db.tasks._dispatch_task") as mock_dispatch:
            with pytest.raises(RuntimeError, match="boom"):
                with transaction_scope() as session:
                    task_id = pg_db.create_task("scan", session=session)
                    raise RuntimeError("boom")

        assert task_id is not None
        assert mock_dispatch.call_count == 0
        assert pg_db.get_task(task_id) is None

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
        with patch("crate.db.cache._get_redis", return_value=None):
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

    def test_upsert_artist_update(self, pg_db):
        pg_db.upsert_artist({"name": "Artist A", "album_count": 1, "track_count": 5})
        pg_db.upsert_artist({"name": "Artist A", "album_count": 2, "track_count": 15})
        artist = pg_db.get_library_artist("Artist A")
        assert artist["album_count"] == 2
        assert artist["track_count"] == 15

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

    def test_upsert_track(self, pg_db):
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
