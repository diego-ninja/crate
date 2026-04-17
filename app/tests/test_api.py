"""Tests for the FastAPI API endpoints with mocked DB layer."""

from unittest.mock import patch, MagicMock
from contextlib import contextmanager


def _make_mock_session(fetchone_returns=None, fetchall_returns=None, fetchall_side_effects=None):
    """Create a mock transaction_scope that simulates session.execute().mappings().first()/.all()."""
    fetchone_queue = list(fetchone_returns or [])
    fetchall_queue = list(fetchall_side_effects or fetchall_returns or [])
    call_index = [0]

    class MockMappings:
        def __init__(self, rows):
            self._rows = rows

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    class MockSession:
        def execute(self, *args, **kwargs):
            idx = call_index[0]
            call_index[0] += 1
            if fetchall_side_effects:
                rows = fetchall_side_effects[idx] if idx < len(fetchall_side_effects) else []
            elif fetchone_returns and idx < len(fetchone_returns):
                rows = [fetchone_returns[idx]] if fetchone_returns[idx] is not None else []
            elif fetchall_returns:
                rows = fetchall_returns[idx] if idx < len(fetchall_returns) else []
            else:
                rows = []
            return MagicMock(mappings=lambda: MockMappings(rows))

    @contextmanager
    def mock_scope():
        yield MockSession()

    return mock_scope


class TestArtistsAPI:
    def test_get_artists_from_db(self, test_app):
        mock_row = {
            "name": "Radiohead",
            "album_count": 9,
            "track_count": 100,
            "total_size": 1024**3,
            "formats_json": ["flac"],
            "primary_format": "flac",
            "has_photo": 1,
        }
        # get_artists_count calls session.execute().mappings().first() -> {"cnt": 1}
        # get_artists_page calls session.execute().mappings().all() -> [mock_row]
        mock_scope = _make_mock_session(fetchall_side_effects=[
            [{"cnt": 1}],   # first() returns first element
            [mock_row],      # all() returns list
        ])

        with patch("crate.api.browse_artist.has_library_data", return_value=True), \
             patch("crate.api.browse_artist.get_all_artist_issue_counts", return_value={}), \
             patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):
            resp = test_app.get("/api/artists")
            assert resp.status_code == 200
            data = resp.json()
            assert "items" in data
            assert data["total"] == 1
            assert data["items"][0]["name"] == "Radiohead"

    def test_get_artists_pagination(self, test_app):
        rows = [{"name": f"Artist {i}", "album_count": 1, "track_count": 10,
                 "total_size": 1000, "formats_json": [], "primary_format": None, "has_photo": 0}
                for i in range(3)]
        mock_scope = _make_mock_session(fetchall_side_effects=[
            [{"cnt": 5}],
            rows,
        ])

        with patch("crate.api.browse_artist.has_library_data", return_value=True), \
             patch("crate.api.browse_artist.get_all_artist_issue_counts", return_value={}), \
             patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):
            resp = test_app.get("/api/artists?page=1&per_page=3")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["items"]) == 3
            assert data["total"] == 5

    def test_get_artists_with_query(self, test_app):
        mock_scope = _make_mock_session(fetchall_side_effects=[
            [{"cnt": 0}],
            [],
        ])

        with patch("crate.api.browse_artist.has_library_data", return_value=True), \
             patch("crate.api.browse_artist.get_all_artist_issue_counts", return_value={}), \
             patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):
            resp = test_app.get("/api/artists?q=radio&sort=name")
            assert resp.status_code == 200
            data = resp.json()
            assert data["total"] == 0


class TestArtistDetailAPI:
    def test_get_artist_found(self, test_app):
        mock_artist = {
            "name": "Tool",
            "track_count": 50,
            "total_size": 1024**3,
            "primary_format": "flac",
            "has_photo": 0,
        }
        mock_albums = [
            {"id": 1, "slug": "lateralus", "name": "Lateralus", "track_count": 13, "total_size": 500000000,
             "formats": ["flac"], "year": "2001", "has_cover": 1},
        ]
        mock_scope = _make_mock_session(fetchall_side_effects=[
            [{"name": "Progressive Metal"}],
        ])

        with patch("crate.api.browse_artist.has_library_data", return_value=True), \
             patch("crate.db.get_library_artist_by_id", return_value={"id": 7, "name": "Tool", "slug": "tool"}), \
             patch("crate.api.browse_artist.get_library_artist", return_value=mock_artist), \
             patch("crate.api.browse_artist.get_library_albums", return_value=mock_albums), \
             patch("crate.api.browse_artist.get_artist_issue_count", return_value=0), \
             patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):

            resp = test_app.get("/api/artists/7")
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "Tool"
            assert len(data["albums"]) == 1

    def test_get_artist_not_found(self, test_app):
        with patch("crate.db.get_library_artist_by_id", return_value=None):
            resp = test_app.get("/api/artists/999")
            assert resp.status_code == 404


class TestStatsAPI:
    def test_get_stats_db(self, test_app):
        mock_stats = {
            "artists": 100,
            "albums": 500,
            "tracks": 5000,
            "total_size": 1024**4,
            "formats": {"flac": 4000, "mp3": 1000},
        }
        with patch("crate.api.browse_shared.get_library_track_count", return_value=5000), \
             patch("crate.db.get_library_stats", return_value=mock_stats):
            pass


class TestSearchAPI:
    def test_search_short_query(self, test_app):
        resp = test_app.get("/api/search?q=a")
        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == []
        assert data["albums"] == []

    def test_search_from_db(self, test_app):
        mock_scope = _make_mock_session(fetchall_side_effects=[
            [{"id": 1, "slug": "radiohead", "name": "Radiohead", "album_count": 9, "has_photo": 1}],
            [{"id": 5, "slug": "ok-computer", "artist": "Radiohead", "name": "OK Computer",
              "year": "1997", "has_cover": 1, "artist_id": 1, "artist_slug": "radiohead"}],
            [],  # track results
        ])

        with patch("crate.api.browse_media.has_library_data", return_value=True), \
             patch("crate.db.queries.browse_media.transaction_scope", mock_scope):
            resp = test_app.get("/api/search?q=radio")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["artists"]) == 1
            assert data["artists"][0]["name"] == "Radiohead"


class TestScanAPI:
    def test_start_scan(self, test_app):
        with patch("crate.api.scanner.list_tasks", return_value=[]), \
             patch("crate.api.scanner.create_task", return_value="abc123"):
            resp = test_app.post("/api/scan", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "started"
            assert data["task_id"] == "abc123"

    def test_start_scan_already_running(self, test_app):
        with patch("crate.api.scanner.list_tasks", return_value=[{"id": "x"}]):
            resp = test_app.post("/api/scan", json={})
            assert resp.status_code == 409

    def test_start_scan_with_only(self, test_app):
        with patch("crate.api.scanner.list_tasks", return_value=[]), \
             patch("crate.api.scanner.create_task", return_value="def456") as mock_create:
            resp = test_app.post("/api/scan", json={"only": "naming"})
            assert resp.status_code == 200
            mock_create.assert_called_once_with("scan", {"only": "naming"})


class TestGenresAPI:
    def test_get_invalid_taxonomy_nodes_summary(self, test_app):
        rows = [
            {"id": 1, "slug": "wikidata", "name": "wikidata", "alias_count": 2, "edge_count": 3, "reason": "external-section-marker"},
            {"id": 2, "slug": "q123", "name": "Q123", "alias_count": 0, "edge_count": 1, "reason": "wikidata-entity-id"},
        ]
        with patch("crate.api.genres.list_invalid_genre_taxonomy_nodes", return_value=rows):
            resp = test_app.get("/api/genres/taxonomy/invalid?limit=1")
            assert resp.status_code == 200
            data = resp.json()
            assert data["invalid_count"] == 2
            assert data["alias_count"] == 2
            assert data["edge_count"] == 4
            assert len(data["items"]) == 1
            assert data["items"][0]["slug"] == "wikidata"

    def test_cleanup_invalid_taxonomy_nodes_starts_task(self, test_app):
        with patch("crate.api.genres.list_tasks", side_effect=[[], []]), \
             patch("crate.api.genres.create_task", return_value="cleanup123") as mock_create:
            resp = test_app.post("/api/genres/taxonomy/cleanup-invalid")
            assert resp.status_code == 200
            data = resp.json()
            assert data["task_id"] == "cleanup123"
            assert data["status"] == "queued"
            assert data["deduplicated"] is False
            mock_create.assert_called_once_with("cleanup_invalid_genre_taxonomy", {})

    def test_cleanup_invalid_taxonomy_nodes_deduplicates_running_task(self, test_app):
        with patch("crate.api.genres.list_tasks", side_effect=[[{"id": "running123", "status": "running"}]]), \
             patch("crate.api.genres.create_task") as mock_create:
            resp = test_app.post("/api/genres/taxonomy/cleanup-invalid")
            assert resp.status_code == 200
            data = resp.json()
            assert data["task_id"] == "running123"
            assert data["status"] == "running"
            assert data["deduplicated"] is True
            mock_create.assert_not_called()


class TestSyncLibraryAPI:
    def test_sync_library(self, test_app):
        with patch("crate.api.tasks.list_tasks", return_value=[]), \
             patch("crate.api.tasks.create_task", return_value="sync123"):
            resp = test_app.post("/api/tasks/sync-library")
            assert resp.status_code == 200
            data = resp.json()
            assert data["task_id"] == "sync123"

    def test_sync_library_already_running(self, test_app):
        with patch("crate.api.tasks.list_tasks", side_effect=[[{"id": "x"}], []]):
            resp = test_app.post("/api/tasks/sync-library")
            assert resp.status_code == 409


class TestWorkerAPI:
    def test_worker_status(self, test_app):
        with patch("crate.api.tasks.list_tasks", side_effect=[
            [{"id": "r1", "type": "scan"}],
            [{"id": "p1", "type": "library_sync"}],
        ]), \
             patch("crate.db.get_cache", return_value=None):
            resp = test_app.get("/api/worker/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["running"] == 1
            assert data["pending"] == 1

    def test_worker_schedules(self, test_app):
        mock_schedules = {
            "library_sync": 1800,
            "enrich_artists": 86400,
        }
        with patch("crate.api.tasks.get_schedules", return_value=mock_schedules), \
             patch("crate.api.tasks.get_setting", return_value=None):
            resp = test_app.get("/api/worker/schedules")
            assert resp.status_code == 200
            data = resp.json()
            assert "library_sync" in data
            assert data["library_sync"]["interval_seconds"] == 1800
            assert data["library_sync"]["enabled"] is True


class TestTasksAPI:
    def test_list_tasks(self, test_app):
        mock_tasks = [
            {"id": "t1", "type": "scan", "status": "completed", "progress": "",
             "error": None, "result": {"issues": 5}, "params": {},
             "created_at": "2024-01-01T00:00:00", "updated_at": "2024-01-01T00:01:00"},
        ]
        with patch("crate.api.tasks.list_tasks", return_value=mock_tasks):
            resp = test_app.get("/api/tasks")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "t1"

    def test_get_task_detail(self, test_app):
        mock_task = {
            "id": "t1", "type": "scan", "status": "running",
            "progress": '{"scanner": "naming"}',
            "error": None, "result": None, "params": {},
            "created_at": "2024-01-01T00:00:00", "updated_at": "2024-01-01T00:01:00",
        }
        with patch("crate.api.tasks.get_task", return_value=mock_task):
            resp = test_app.get("/api/tasks/t1")
            assert resp.status_code == 200
            data = resp.json()
            assert data["id"] == "t1"
            assert data["progress"]["scanner"] == "naming"

    def test_get_task_not_found(self, test_app):
        with patch("crate.api.tasks.get_task", return_value=None):
            resp = test_app.get("/api/tasks/nonexistent")
            assert resp.status_code == 404

    def test_cancel_task(self, test_app):
        mock_task = {
            "id": "t1", "type": "scan", "status": "pending",
            "progress": "", "error": None, "result": None, "params": {},
            "created_at": "2024-01-01", "updated_at": "2024-01-01",
        }
        with patch("crate.api.tasks.get_task", return_value=mock_task), \
             patch("crate.api.tasks.update_task") as mock_update:
            resp = test_app.post("/api/tasks/t1/cancel")
            assert resp.status_code == 200
            mock_update.assert_called_once_with("t1", status="cancelled")
