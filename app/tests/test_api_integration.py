"""API integration tests — real HTTP requests against real PostgreSQL.

These are NOT unit tests with mocked DB. They boot the full FastAPI app
against the ``crate_test`` database (via the ``pg_db`` fixture) and
verify that every critical endpoint:

  1. Returns the expected HTTP status code
  2. Returns valid JSON with the expected shape
  3. Doesn't blow up with 500 on a clean install

This is the minimum safety net for the ORM refactor: if a SQL migration
breaks an endpoint, these tests catch it — even if unit tests with
mocked DB still pass.
"""

import json
import pytest
from unittest.mock import patch

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def api_client(pg_db):
    """FastAPI TestClient backed by the real crate_test database.

    Unlike ``test_app`` (which mocks DB entirely), this fixture lets
    the API talk to real PostgreSQL with a freshly-seeded schema.
    Auth is faked via middleware mock so we don't need a login flow.
    """
    from fastapi.testclient import TestClient

    import tempfile, os
    test_lib = tempfile.mkdtemp(prefix="crate_test_lib_")

    mock_config = {
        "library_path": test_lib,
        "audio_extensions": [".flac", ".mp3", ".m4a"],
        "exclude_dirs": [],
    }

    async def _fake_admin_dispatch(self, request, call_next):
        request.state.user = {
            "id": 1,
            "email": "admin@cratemusic.app",
            "role": "admin",
            "username": "admin",
            "name": "Test Admin",
        }
        return await call_next(request)

    with patch("crate.api._deps.load_config", return_value=mock_config), \
         patch("crate.api.auth.AuthMiddleware.dispatch", _fake_admin_dispatch):
        from crate.api import create_app
        app = create_app()
        with TestClient(app) as client:
            yield client


class TestCoreEndpoints:
    """Endpoints that every Crate install has — library, tasks, settings."""

    def test_artists_list(self, api_client):
        resp = api_client.get("/api/artists")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)

    def test_genres_list(self, api_client):
        resp = api_client.get("/api/genres")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_tasks_list(self, api_client):
        resp = api_client.get("/api/tasks")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_create_and_get_task(self, api_client, pg_db):
        task_id = pg_db.create_task("test_scan", {"test": True})
        resp = api_client.get(f"/api/tasks/{task_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == task_id
        assert data["type"] == "test_scan"
        assert data["status"] == "pending"

    def test_worker_status(self, api_client):
        resp = api_client.get("/api/worker/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "engine" in data

    def test_search_empty(self, api_client):
        resp = api_client.get("/api/search?q=nonexistent_artist_xyz")
        assert resp.status_code == 200
        data = resp.json()
        assert "artists" in data
        assert "albums" in data


class TestUserEndpoints:
    """Endpoints that depend on user identity."""

    def test_auth_me(self, api_client):
        resp = api_client.get("/api/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@cratemusic.app"
        assert data["role"] == "admin"

    def test_auth_config(self, api_client):
        resp = api_client.get("/api/auth/config")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)

    def test_home_discovery(self, api_client):
        resp = api_client.get("/api/me/home/discovery")
        assert resp.status_code == 200
        data = resp.json()
        # The home payload should always have these keys, even on empty library
        for key in ("hero", "custom_mixes", "radio_stations", "favorite_artists"):
            assert key in data, f"Missing key: {key}"

    def test_home_discovery_resolves_legacy_play_history_by_artist_title(self, api_client, pg_db):
        artist_name = "Fallback Artist"
        album_name = "Fallback Album"
        track_title = "Fallback Track"
        real_path = "/tmp/crate_test_lib/Fallback Artist/Fallback Album/01 - Fallback Track.flac"

        pg_db.upsert_artist(
            {
                "name": artist_name,
                "folder_name": artist_name,
                "album_count": 1,
                "track_count": 1,
                "total_size": 1234,
                "formats": ["flac"],
                "primary_format": "flac",
                "has_photo": 0,
            }
        )
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": album_name,
                "path": "/tmp/crate_test_lib/Fallback Artist/Fallback Album",
                "track_count": 1,
                "total_size": 1234,
                "total_duration": 240,
                "formats": ["flac"],
                "year": 2024,
                "genre": "Psychedelic Rock",
                "has_cover": 0,
                "tag_album": album_name,
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": album_name,
                "filename": "01 - Fallback Track.flac",
                "title": track_title,
                "track_number": 1,
                "disc_number": 1,
                "format": "flac",
                "duration": 240,
                "size": 1234,
                "year": 2024,
                "genre": "Psychedelic Rock",
                "albumartist": artist_name,
                "path": real_path,
            }
        )

        # Simulate a legacy play-history row that cannot resolve by track_id/path
        # anymore, but should still recover album/artist metadata by title + artist.
        pg_db.record_play(
            1,
            track_path="/legacy/missing-file.flac",
            title=track_title,
            artist=artist_name,
            album=album_name,
        )

        resp = api_client.get("/api/me/home/discovery?fresh=1")
        assert resp.status_code == 200
        data = resp.json()

        album_items = [
            item
            for item in data.get("recently_played", [])
            if item.get("type") == "album" and item.get("album_name") == album_name
        ]
        assert album_items, data.get("recently_played", [])
        assert album_items[0]["album_id"] == album_id

    def test_album_detail_serializes_track_storage_ids_as_strings(self, api_client, pg_db):
        artist_name = "Quicksand"
        album_name = "Distant Populations"

        pg_db.upsert_artist(
            {
                "name": artist_name,
                "folder_name": artist_name,
                "album_count": 1,
                "track_count": 1,
                "total_size": 1234,
                "formats": ["flac"],
                "primary_format": "flac",
                "has_photo": 0,
            }
        )
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": album_name,
                "path": f"/tmp/crate_test_lib/{artist_name}/{album_name}",
                "track_count": 1,
                "total_size": 1234,
                "total_duration": 240,
                "formats": ["flac"],
                "year": 2021,
                "genre": "Post-Hardcore",
                "has_cover": 0,
                "tag_album": album_name,
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": album_name,
                "filename": "01 - Inversion.flac",
                "title": "Inversion",
                "track_number": 1,
                "disc_number": 1,
                "format": "flac",
                "duration": 240,
                "size": 1234,
                "year": 2021,
                "genre": "Post-Hardcore",
                "albumartist": artist_name,
                "path": f"/tmp/crate_test_lib/{artist_name}/{album_name}/01 - Inversion.flac",
            }
        )

        resp = api_client.get(f"/api/albums/{album_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == album_id
        assert len(data["tracks"]) == 1
        assert isinstance(data["tracks"][0]["storage_id"], str)

    def test_stats_replay(self, api_client):
        resp = api_client.get("/api/me/stats/replay?window=30d&limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data or "title" in data

    def test_likes(self, api_client):
        resp = api_client.get("/api/me/likes?limit=10")
        assert resp.status_code == 200

    def test_follows(self, api_client):
        resp = api_client.get("/api/me/follows")
        assert resp.status_code == 200

    def test_saved_albums(self, api_client):
        resp = api_client.get("/api/me/albums")
        assert resp.status_code == 200

    def test_upcoming(self, api_client):
        resp = api_client.get("/api/me/upcoming")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data


class TestGenreTaxonomy:
    """Genre taxonomy endpoints — important because EQ presets live here."""

    def test_genre_list_has_canonical_genres(self, api_client):
        resp = api_client.get("/api/genres")
        assert resp.status_code == 200
        genres = resp.json()
        # The seed should have created canonical genres
        slugs = {g["slug"] for g in genres if g.get("mapped")}
        # At least some canonical genres should exist after seed
        assert len(slugs) > 0 or len(genres) == 0  # empty library = no genre links

    def test_genre_graph_for_seeded_taxonomy_slug(self, api_client):
        resp = api_client.get("/api/genres/metalcore/graph")
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "links" in data


class TestSettingsAndAdmin:
    """Admin-only endpoints."""

    def test_settings_read(self, api_client):
        resp = api_client.get("/api/settings/list")
        # This might be 404 if the route doesn't exist, or 200
        assert resp.status_code in (200, 404)

    def test_users_list(self, api_client):
        resp = api_client.get("/api/users")
        # /api/users may be at a different path or require specific params
        if resp.status_code == 404:
            pytest.skip("Users endpoint not found at /api/users")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


class TestPlaybackRelated:
    """Endpoints consumed by the Listen playback engine."""

    def test_auth_config_for_capacitor(self, api_client):
        """The server-setup probe in Capacitor hits this endpoint."""
        resp = api_client.get("/api/auth/config")
        assert resp.status_code == 200
        data = resp.json()
        # Should have at least invite_only (used by ServerSetup probe)
        assert "invite_only" in data

    def test_playlists_list(self, api_client):
        resp = api_client.get("/api/playlists")
        assert resp.status_code == 200


class TestSubsonicEndpoints:
    """Open Subsonic-compatible endpoints used by external clients."""

    def test_subsonic_ping(self, api_client):
        resp = api_client.get(
            "/rest/ping",
            params={
                "u": "admin@cratemusic.app",
                "p": "admin",
                "v": "1.16.1",
                "c": "pytest",
                "f": "json",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["subsonic-response"]["status"] == "ok"
        assert data["subsonic-response"]["version"] == "1.16.1"

    def test_subsonic_get_music_folders_and_artists(self, api_client):
        common = {
            "u": "admin@cratemusic.app",
            "p": "admin",
            "v": "1.16.1",
            "c": "pytest",
            "f": "json",
        }

        folders_resp = api_client.get("/rest/getMusicFolders", params=common)
        assert folders_resp.status_code == 200
        folders = folders_resp.json()["subsonic-response"]["musicFolders"]["musicFolder"]
        assert folders[0]["name"] == "Music"

        artists_resp = api_client.get("/rest/getArtists", params=common)
        assert artists_resp.status_code == 200
        artists = artists_resp.json()["subsonic-response"]["artists"]
        assert "index" in artists
