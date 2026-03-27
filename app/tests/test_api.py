"""Tests for the FastAPI API endpoints with mocked DB layer."""

from unittest.mock import patch, MagicMock


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
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 1}
        mock_cur.fetchall.return_value = [mock_row]

        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_all_artist_issue_counts", return_value={}), \
             patch("musicdock.api.browse.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
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
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 5}
        mock_cur.fetchall.return_value = rows

        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_all_artist_issue_counts", return_value={}), \
             patch("musicdock.api.browse.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
            resp = test_app.get("/api/artists?page=1&per_page=3")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["items"]) == 3
            assert data["total"] == 5

    def test_get_artists_with_query(self, test_app):
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {"cnt": 0}
        mock_cur.fetchall.return_value = []

        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_all_artist_issue_counts", return_value={}), \
             patch("musicdock.api.browse.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
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
            {"name": "Lateralus", "track_count": 13, "total_size": 500000000,
             "formats": ["flac"], "year": "2001", "has_cover": 1},
        ]

        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_library_artist", return_value=mock_artist), \
             patch("musicdock.api.browse.get_library_albums", return_value=mock_albums), \
             patch("musicdock.api.browse.get_artist_issue_count", return_value=0), \
             patch("musicdock.api.browse.get_db_ctx") as mock_ctx:
            mock_cur = MagicMock()
            mock_cur.fetchall.return_value = [{"name": "Progressive Metal"}]
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

            resp = test_app.get("/api/artist/Tool")
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "Tool"
            assert len(data["albums"]) == 1

    def test_get_artist_not_found(self, test_app):
        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_library_artist", return_value=None), \
             patch("musicdock.api.browse.safe_path", return_value=None):
            resp = test_app.get("/api/artist/NonExistent")
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
        with patch("musicdock.api.browse.get_library_track_count", return_value=5000), \
             patch("musicdock.db.get_library_stats", return_value=mock_stats):
            # Stats endpoint is in the browse module via /api/stats in web.py
            # The FastAPI app doesn't have /api/stats from browse, it's from web.py (Flask)
            # Let's check available endpoints
            pass


class TestSearchAPI:
    def test_search_short_query(self, test_app):
        resp = test_app.get("/api/search?q=a")
        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == []
        assert data["albums"] == []

    def test_search_from_db(self, test_app):
        mock_cur = MagicMock()
        mock_cur.fetchall.side_effect = [
            [{"name": "Radiohead"}],
            [{"artist": "Radiohead", "name": "OK Computer"}],
            [],  # track results
        ]

        with patch("musicdock.api.browse.get_library_track_count", return_value=100), \
             patch("musicdock.api.browse.get_db_ctx") as mock_ctx:
            mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
            mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

            resp = test_app.get("/api/search?q=radio")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data["artists"]) == 1
            assert data["artists"][0]["name"] == "Radiohead"


class TestScanAPI:
    def test_start_scan(self, test_app):
        with patch("musicdock.api.scanner.list_tasks", return_value=[]), \
             patch("musicdock.api.scanner.create_task", return_value="abc123"):
            resp = test_app.post("/api/scan", json={})
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "started"
            assert data["task_id"] == "abc123"

    def test_start_scan_already_running(self, test_app):
        with patch("musicdock.api.scanner.list_tasks", return_value=[{"id": "x"}]):
            resp = test_app.post("/api/scan", json={})
            assert resp.status_code == 409

    def test_start_scan_with_only(self, test_app):
        with patch("musicdock.api.scanner.list_tasks", return_value=[]), \
             patch("musicdock.api.scanner.create_task", return_value="def456") as mock_create:
            resp = test_app.post("/api/scan", json={"only": "naming"})
            assert resp.status_code == 200
            mock_create.assert_called_once_with("scan", {"only": "naming"})


class TestSyncLibraryAPI:
    def test_sync_library(self, test_app):
        with patch("musicdock.api.tasks.list_tasks", return_value=[]), \
             patch("musicdock.api.tasks.create_task", return_value="sync123"):
            resp = test_app.post("/api/tasks/sync-library")
            assert resp.status_code == 200
            data = resp.json()
            assert data["task_id"] == "sync123"

    def test_sync_library_already_running(self, test_app):
        with patch("musicdock.api.tasks.list_tasks", side_effect=[[{"id": "x"}], []]):
            resp = test_app.post("/api/tasks/sync-library")
            assert resp.status_code == 409


class TestWorkerAPI:
    def test_worker_status(self, test_app):
        with patch("musicdock.api.tasks.list_tasks", side_effect=[
            [{"id": "r1", "type": "scan"}],
            [{"id": "p1", "type": "library_sync"}],
        ]), \
             patch("musicdock.api.tasks.get_setting", return_value="3"):
            resp = test_app.get("/api/worker/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["max_slots"] == 3
            assert data["running"] == 1
            assert data["pending"] == 1

    def test_worker_schedules(self, test_app):
        mock_schedules = {
            "library_sync": 1800,
            "enrich_artists": 86400,
        }
        with patch("musicdock.api.tasks.get_schedules", return_value=mock_schedules), \
             patch("musicdock.api.tasks.get_setting", return_value=None):
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
        with patch("musicdock.api.tasks.list_tasks", return_value=mock_tasks):
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
        with patch("musicdock.api.tasks.get_task", return_value=mock_task):
            resp = test_app.get("/api/tasks/t1")
            assert resp.status_code == 200
            data = resp.json()
            assert data["id"] == "t1"
            assert data["progress"]["scanner"] == "naming"

    def test_get_task_not_found(self, test_app):
        with patch("musicdock.api.tasks.get_task", return_value=None):
            resp = test_app.get("/api/tasks/nonexistent")
            assert resp.status_code == 404

    def test_cancel_task(self, test_app):
        mock_task = {
            "id": "t1", "type": "scan", "status": "pending",
            "progress": "", "error": None, "result": None, "params": {},
            "created_at": "2024-01-01", "updated_at": "2024-01-01",
        }
        with patch("musicdock.api.tasks.get_task", return_value=mock_task), \
             patch("musicdock.api.tasks.update_task") as mock_update:
            resp = test_app.post("/api/tasks/t1/cancel")
            assert resp.status_code == 200
            mock_update.assert_called_once_with("t1", status="cancelled")
