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

    def test_get_artists_popularity_sort_uses_consolidated_signal(self, test_app):
        captured: dict[str, str] = {}

        def fake_get_artists_page(select_cols, joins, where_sql, order_sql, params, per_page, offset):
            captured["order_sql"] = order_sql
            return []

        with patch("crate.api.browse_artist.has_library_data", return_value=True), \
             patch("crate.api.browse_artist.get_all_artist_issue_counts", return_value={}), \
             patch("crate.api.browse_artist.get_artists_count", return_value=0), \
             patch("crate.api.browse_artist.get_artists_page", side_effect=fake_get_artists_page):
            resp = test_app.get("/api/artists?sort=popularity")
            assert resp.status_code == 200

        order_sql = captured["order_sql"]
        assert "COALESCE(la.popularity_score, -1) DESC" in order_sql
        assert "COALESCE(la.popularity, 0) DESC" in order_sql
        assert "la.listeners DESC NULLS LAST" in order_sql
        assert order_sql.endswith("la.name ASC")


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
             patch("crate.api.browse_artist.artist_name_from_id", return_value="Tool"), \
             patch("crate.api.browse_artist.get_library_artist", return_value=mock_artist), \
             patch("crate.api.browse_artist.get_library_albums", return_value=mock_albums), \
             patch("crate.api.browse_artist.get_album_quality_map", return_value={1: {"format": "flac", "bit_depth": 16, "sample_rate": 44100}}), \
             patch("crate.api.browse_artist.get_artist_issue_count", return_value=0), \
             patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):

            resp = test_app.get("/api/artists/7")
            assert resp.status_code == 200
            data = resp.json()
            assert data["name"] == "Tool"
            assert len(data["albums"]) == 1

    def test_get_artist_not_found(self, test_app):
        with patch("crate.api.browse_artist.artist_name_from_id", return_value=None):
            resp = test_app.get("/api/artists/999")
            assert resp.status_code == 404


class TestStatsAPI:
    def test_get_stats_reads_from_ops_snapshot(self, test_app):
        snapshot_payload = {
            "snapshot": {"scope": "ops", "subject_key": "dashboard", "version": 3, "stale": False, "generation_ms": 12},
            "stats": {
            "artists": 100,
            "albums": 500,
            "tracks": 5000,
            "formats": {"flac": 4000, "mp3": 1000},
            "total_size_gb": 1024,
            "last_scan": None,
            "pending_imports": 7,
            "pending_tasks": 2,
            "total_duration_hours": 320.4,
            "avg_bitrate": 914,
            "top_genres": [{"name": "post-hardcore", "count": 42}],
            "recent_albums": [],
            "analyzed_tracks": 4900,
            "avg_album_duration_min": 41.2,
            "avg_tracks_per_album": 10.0,
            },
        }
        with patch("crate.api.analytics._has_library_data", return_value=True), \
             patch("crate.api.analytics.get_cached_ops_snapshot", return_value=snapshot_payload):
            resp = test_app.get("/api/stats")
            assert resp.status_code == 200
            assert resp.json()["pending_imports"] == 7

    def test_get_stats_returns_empty_snapshot_shape_without_filesystem_scan(self, test_app):
        with patch("crate.api.analytics.get_cached_ops_snapshot", return_value={}), \
             patch("crate.api.analytics.count_import_queue_items", return_value=0), \
             patch("crate.api.analytics.list_tasks", return_value=[]), \
             patch("crate.api.analytics.library_path", side_effect=AssertionError("filesystem scan should not run")):
            resp = test_app.get("/api/stats")

        assert resp.status_code == 200
        data = resp.json()
        assert data["artists"] == 0
        assert data["albums"] == 0
        assert data["tracks"] == 0
        assert data["top_genres"] == []
        assert data["recent_albums"] == []
        assert data["pending_tasks"] == 0


class TestTimelineAPI:
    def test_timeline_returns_empty_without_filesystem_scan(self, test_app):
        with patch("crate.api.analytics._has_library_data", return_value=False), \
             patch("crate.api.analytics.library_path", side_effect=AssertionError("filesystem scan should not run")):
            resp = test_app.get("/api/timeline")

        assert resp.status_code == 200
        assert resp.json() == {}


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

    def test_status_prefers_runtime_snapshot(self, test_app):
        with patch(
            "crate.api.scanner.get_public_status_snapshot",
            return_value={
                "scanning": False,
                "last_scan": None,
                "issue_count": 4,
                "progress": {},
                "pending_imports": 9,
                "running_tasks": 2,
            },
        ):
            resp = test_app.get("/api/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["pending_imports"] == 9
            assert data["issue_count"] == 4
            assert data["running_tasks"] == 2

    def test_status_falls_back_when_runtime_snapshot_missing(self, test_app):
        with patch("crate.api.scanner.get_public_status_snapshot", return_value=None), \
             patch("crate.api.scanner.list_tasks", return_value=[]), \
             patch("crate.api.scanner.get_latest_scan", return_value=None), \
             patch("crate.api.scanner.count_import_queue_items", return_value=9):
            resp = test_app.get("/api/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["pending_imports"] == 9
            assert data["issue_count"] == 0
            assert data["running_tasks"] == 0

    def test_status_exposes_persisted_pending_imports(self, test_app):
        with patch("crate.api.scanner.list_tasks", return_value=[]), \
             patch("crate.api.scanner.get_latest_scan", return_value=None), \
             patch("crate.api.scanner.count_import_queue_items", return_value=9), \
             patch("crate.api.scanner.get_public_status_snapshot", return_value=None):
            resp = test_app.get("/api/status")
            assert resp.status_code == 200
            data = resp.json()
            assert data["pending_imports"] == 9
            assert data["issue_count"] == 0


class TestImportsAPI:
    def test_imports_pending_reads_persisted_queue(self, test_app):
        pending = [
            {
                "source": "tidal",
                "source_path": "/music/.imports/tidal/A/B",
                "artist": "A",
                "album": "B",
                "track_count": 8,
                "formats": ["flac"],
                "total_size_mb": 320,
                "dest_path": "/music/A/B",
                "dest_exists": False,
                "status": "pending",
            }
        ]
        with patch("crate.api.imports.list_import_queue_items", return_value=pending):
            resp = test_app.get("/api/imports/pending")
            assert resp.status_code == 200
            assert resp.json() == pending

    def test_imports_import_queues_worker_task(self, test_app):
        with patch("crate.api.imports.create_task", return_value="task-import-1") as mock_create:
            resp = test_app.post(
                "/api/imports/import",
                json={"source_path": "/music/.imports/tidal/A/B", "artist": "A", "album": "B"},
            )
            assert resp.status_code == 200
            assert resp.json()["task_id"] == "task-import-1"
            assert resp.json()["status"] == "queued"
            mock_create.assert_called_once_with(
                "import_queue_item",
                {"source_path": "/music/.imports/tidal/A/B", "artist": "A", "album": "B"},
            )

    def test_imports_import_all_queues_worker_task(self, test_app):
        with patch("crate.api.imports.create_task", return_value="task-import-all") as mock_create:
            resp = test_app.post("/api/imports/import-all")
            assert resp.status_code == 200
            assert resp.json()["task_id"] == "task-import-all"
            assert resp.json()["status"] == "queued"
            mock_create.assert_called_once_with("import_queue_all", {})

    def test_imports_remove_queues_worker_task(self, test_app):
        with patch("crate.api.imports.create_task", return_value="task-remove-1") as mock_create:
            resp = test_app.post(
                "/api/imports/remove",
                json={"source_path": "/music/.imports/tidal/A/B"},
            )
            assert resp.status_code == 200
            assert resp.json()["task_id"] == "task-remove-1"
            assert resp.json()["status"] == "queued"
            mock_create.assert_called_once_with(
                "import_queue_remove",
                {"source_path": "/music/.imports/tidal/A/B"},
            )


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


class TestOfflineAPI:
    def test_get_track_manifest_by_storage(self, test_app):
        track = {
            "id": 24,
            "storage_id": "track-storage-24",
            "title": "Distant Populations",
            "artist": "Quicksand",
            "album": "Distant Populations",
            "album_id": 14,
            "duration": 221,
            "format": "flac",
            "bitrate": 950,
            "sample_rate": 44100,
            "bit_depth": 16,
            "size": 12_345_678,
            "updated_at": "2026-04-18T10:00:00",
        }
        album = {"id": 14, "slug": "quicksand-distant-populations"}

        with patch("crate.api.offline.get_library_track_by_storage_id", return_value=track), \
             patch("crate.api.offline.get_library_album_by_id", return_value=album), \
             patch("crate.api.offline.get_library_artist", return_value={"id": 7, "slug": "quicksand"}):
            resp = test_app.get("/api/offline/tracks/by-storage/track-storage-24/manifest")
            assert resp.status_code == 200
            data = resp.json()
            assert data["kind"] == "track"
            assert data["id"] == "track-storage-24"
            assert data["tracks"][0]["stream_url"] == "/api/tracks/by-storage/track-storage-24/stream"
            assert data["tracks"][0]["download_url"] == "/api/tracks/by-storage/track-storage-24/download"

    def test_get_track_manifest_by_path(self, test_app):
        track = {
            "id": 24,
            "storage_id": "track-storage-24",
            "title": "Omission",
            "artist": "Quicksand",
            "album": "Distant Populations",
            "album_id": 14,
            "size": 4_096,
        }

        with patch("crate.api.offline.get_library_track_by_path", return_value=track), \
             patch("crate.api.offline.get_library_album_by_id", return_value={"id": 14, "slug": "quicksand-distant-populations"}), \
             patch("crate.api.offline.get_library_artist", return_value={"id": 7, "slug": "quicksand"}):
            resp = test_app.get("/api/offline/tracks/by-path/music/Quicksand/Distant Populations/01 Omission.flac/manifest")
            assert resp.status_code == 200
            assert resp.json()["tracks"][0]["storage_id"] == "track-storage-24"

    def test_get_album_manifest(self, test_app):
        album = {
            "id": 14,
            "slug": "quicksand-distant-populations",
            "name": "Distant Populations",
            "artist": "Quicksand",
            "year": "2021",
            "updated_at": "2026-04-18T10:00:00",
        }
        tracks = [
            {
                "id": 24,
                "storage_id": "track-storage-24",
                "title": "Inversion",
                "artist": "Quicksand",
                "album": "Distant Populations",
                "album_id": 14,
                "size": 100,
                "updated_at": "2026-04-18T10:00:00",
            },
            {
                "id": 25,
                "storage_id": "track-storage-25",
                "title": "Missile Command",
                "artist": "Quicksand",
                "album": "Distant Populations",
                "album_id": 14,
                "size": 200,
                "updated_at": "2026-04-18T11:00:00",
            },
        ]

        with patch("crate.api.offline.get_library_album_by_id", return_value=album), \
             patch("crate.api.offline.get_library_tracks", return_value=tracks), \
             patch("crate.api.offline.get_library_artist", return_value={"id": 7, "slug": "quicksand"}):
            resp = test_app.get("/api/offline/albums/14/manifest")
            assert resp.status_code == 200
            data = resp.json()
            assert data["kind"] == "album"
            assert data["track_count"] == 2
            assert data["total_bytes"] == 300
            assert data["artwork"]["cover_url"] == "/api/albums/14/cover"

    def test_get_playlist_manifest_rejects_smart_playlists(self, test_app):
        playlist = {
            "id": 44,
            "name": "Daily mix",
            "generation_mode": "smart",
            "is_smart": True,
        }

        with patch("crate.api.offline.get_playlist", return_value=playlist):
            resp = test_app.get("/api/offline/playlists/44/manifest")
            assert resp.status_code == 409
            assert "static playlists" in resp.json()["detail"].lower()

    def test_get_playlist_manifest(self, test_app):
        playlist = {
            "id": 52,
            "name": "Post-hardcore forever",
            "generation_mode": "static",
            "visibility": "private",
            "updated_at": "2026-04-18T10:00:00",
        }
        tracks = [
            {
                "position": 1,
                "track_storage_id": "track-storage-24",
                "artist_id": 7,
                "artist_slug": "quicksand",
                "album_id": 14,
                "album_slug": "quicksand-distant-populations",
                "duration": 221,
            },
            {
                "position": 2,
                "track_storage_id": "track-storage-25",
                "artist_id": 7,
                "artist_slug": "quicksand",
                "album_id": 14,
                "album_slug": "quicksand-distant-populations",
                "duration": 247,
            },
        ]
        library_tracks = {
            "track-storage-24": {
                "id": 24,
                "storage_id": "track-storage-24",
                "title": "Dine Alone",
                "artist": "Quicksand",
                "album": "Distant Populations",
                "album_id": 14,
                "size": 12_000,
                "updated_at": "2026-04-18T10:00:00",
            },
            "track-storage-25": {
                "id": 25,
                "storage_id": "track-storage-25",
                "title": "Colossus",
                "artist": "Quicksand",
                "album": "Distant Populations",
                "album_id": 14,
                "size": 13_000,
                "updated_at": "2026-04-18T11:00:00",
            },
        }

        with patch("crate.api.offline.get_playlist", return_value=playlist), \
             patch("crate.api.offline.can_view_playlist", return_value=True), \
             patch("crate.api.offline.get_playlist_tracks", return_value=tracks), \
             patch("crate.api.offline.get_library_tracks_by_storage_ids", return_value=library_tracks) as mock_batch, \
             patch("crate.api.offline.get_library_artist", return_value={"id": 7, "slug": "quicksand"}):
            resp = test_app.get("/api/offline/playlists/52/manifest")
            assert resp.status_code == 200
            data = resp.json()
            assert data["kind"] == "playlist"
            assert data["track_count"] == 2
            assert data["total_bytes"] == 25_000
            mock_batch.assert_called_once_with(["track-storage-24", "track-storage-25"])


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
    def test_worker_status_prefers_ops_snapshot(self, test_app):
        with patch(
            "crate.db.ops_snapshot.get_cached_ops_snapshot",
            return_value={
                "live": {
                    "engine": "dramatiq",
                    "running_tasks": [{"id": "r1", "type": "scan", "pool": "default"}],
                    "pending_tasks": [{"id": "p1", "type": "library_sync", "pool": "default"}],
                }
            },
        ):
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
        snapshot = {
            "history": [
                {"id": "t1", "type": "scan", "status": "completed", "progress": "",
                 "error": None, "result": {"issues": 5}, "params": {},
                 "created_at": "2024-01-01T00:00:00", "updated_at": "2024-01-01T00:01:00"},
            ]
        }
        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/tasks")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["id"] == "t1"

    def test_admin_tasks_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:tasks", "subject_key": "surface:100", "version": 2, "stale": False, "generation_ms": 8},
            "live": {
                "engine": "dramatiq",
                "running_tasks": [],
                "pending_tasks": [],
                "recent_tasks": [],
                "worker_slots": {"max": 3, "active": 0},
                "systems": {"postgres": True, "watcher": True},
            },
            "history": [],
        }

        with patch("crate.api.tasks.get_cached_tasks_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/tasks-snapshot")

        assert resp.status_code == 200
        assert resp.json()["snapshot"]["scope"] == "ops:tasks"

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


class TestPlaylistCurationAPI:
    def test_curated_playlists_reuse_preloaded_engagement(self, test_app):
        playlist = {
            "id": 11,
            "name": "Metalcore Essentials",
            "description": "Test",
            "scope": "system",
            "generation_mode": "smart",
            "is_curated": True,
            "is_active": True,
            "artwork_tracks": [],
            "follower_count": 7,
            "is_followed": True,
        }

        with patch("crate.api.curation.list_system_playlists", return_value=[playlist]), \
             patch("crate.api.curation.get_playlist_followers_count", side_effect=AssertionError("unexpected follower count lookup")), \
             patch("crate.api.curation.is_playlist_followed", side_effect=AssertionError("unexpected follow lookup")):
            resp = test_app.get("/api/curation/playlists")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["follower_count"] == 7
        assert data[0]["is_followed"] is True

    def test_my_followed_playlists_reuse_preloaded_follower_count(self, test_app):
        playlist = {
            "id": 19,
            "name": "Post-Hardcore Radar",
            "description": "Test",
            "scope": "system",
            "generation_mode": "smart",
            "is_curated": True,
            "is_active": True,
            "artwork_tracks": [],
            "follower_count": 5,
        }

        with patch("crate.api.me.get_followed_system_playlists", return_value=[playlist]):
            resp = test_app.get("/api/me/followed-playlists")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["follower_count"] == 5
        assert data[0]["is_followed"] is True

    def test_admin_system_playlists_reuse_preloaded_follower_count(self, test_app):
        playlist = {
            "id": 23,
            "name": "Curated Mix",
            "description": "Test",
            "scope": "system",
            "generation_mode": "static",
            "is_curated": True,
            "is_active": True,
            "artwork_tracks": [],
            "follower_count": 9,
        }

        with patch("crate.api.system_playlists.list_system_playlists", return_value=[playlist]), \
             patch("crate.api.system_playlists.get_playlist_followers_count", side_effect=AssertionError("unexpected follower count lookup")):
            resp = test_app.get("/api/admin/system-playlists")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["follower_count"] == 9

    def test_admin_system_playlist_editor_snapshot_collapses_detail_and_history(self, test_app):
        playlist = {
            "id": 23,
            "name": "Curated Mix",
            "description": "Test",
            "scope": "system",
            "generation_mode": "smart",
            "is_curated": True,
            "is_active": True,
            "auto_refresh_enabled": True,
            "featured_rank": 2,
            "category": "editorial",
            "track_count": 9,
            "total_duration": 1800,
            "follower_count": 9,
            "artwork_tracks": [],
            "generation_status": "running",
            "generation_error": None,
            "last_generated_at": None,
            "smart_rules": {"match": "all", "rules": [], "limit": 50, "sort": "random"},
        }
        tracks = [{"title": "Locust Reign", "artist": "Converge", "album": "Jane Doe", "duration": 424}]
        history = [{
            "id": 3,
            "started_at": "2026-04-23T10:00:00+00:00",
            "completed_at": None,
            "status": "running",
            "track_count": None,
            "duration_sec": None,
            "error": None,
            "triggered_by": "manual",
            "rule_snapshot": {"match": "all"},
        }]

        with patch("crate.api.system_playlists.get_playlist", return_value=playlist), \
             patch("crate.api.system_playlists.get_playlist_tracks", return_value=tracks), \
             patch("crate.api.system_playlists.get_generation_history", return_value=history), \
             patch("crate.api.system_playlists.get_playlist_followers_count", side_effect=AssertionError("unexpected follower count lookup")):
            resp = test_app.get("/api/admin/system-playlists/23/editor-snapshot")

        assert resp.status_code == 200
        data = resp.json()
        assert data["playlist"]["id"] == 23
        assert data["playlist"]["generation_status"] == "running"
        assert data["playlist"]["tracks"][0]["title"] == "Locust Reign"
        assert data["history"][0]["triggered_by"] == "manual"


class TestAcquisitionAPI:
    def test_acquisition_snapshot_collapses_tidal_and_soulseek_state(self, test_app):
        tidal_queue = [{
            "id": 7,
            "tidal_url": "https://tidal.com/album/7",
            "tidal_id": "7",
            "content_type": "album",
            "title": "Jane Doe",
            "artist": "Converge",
            "status": "queued",
            "source": "search",
            "quality": "max",
            "cover_url": None,
            "created_at": "2026-04-23T10:00:00+00:00",
        }]
        slsk_downloads = [{
            "directory": "music/C/Converge - Jane Doe",
            "filename": "01 - Concubine.flac",
            "fullPath": "music/C/Converge - Jane Doe/01 - Concubine.flac",
            "state": "downloading",
            "percentComplete": 42,
            "username": "peer42",
            "averageSpeed": 2048,
        }]

        with patch("crate.api.acquisition.tidal.is_authenticated", return_value=True), \
             patch("crate.api.acquisition.get_tidal_downloads", return_value=tidal_queue), \
             patch("crate.api.acquisition.soulseek.get_downloads", return_value=slsk_downloads):
            resp = test_app.get("/api/acquisition/snapshot")

        assert resp.status_code == 200
        data = resp.json()
        assert data["tidal_authenticated"] is True
        assert data["tidal_queue"][0]["title"] == "Jane Doe"
        assert data["soulseek_queue"][0]["album"] == "Converge - Jane Doe"
        assert data["soulseek_queue"][0]["progress"] == 42

    def test_new_releases_snapshot_collapses_release_radar_state(self, test_app):
        releases = [{
            "id": 11,
            "artist_name": "Converge",
            "album_title": "Axe to Fall",
            "status": "detected",
            "tidal_id": "11",
            "tidal_url": "https://tidal.com/album/11",
            "cover_url": "https://cdn.example/11.jpg",
            "year": "2009",
            "tracks": 13,
            "quality": "max",
            "release_date": "2026-04-25",
            "release_type": "album",
            "artist_id": 7,
            "artist_slug": "converge",
            "album_id": 19,
            "album_slug": "axe-to-fall",
        }]

        with patch("crate.api.acquisition.get_new_releases", return_value=releases):
            resp = test_app.get("/api/acquisition/new-releases/snapshot")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["releases"]) == 1
        assert data["releases"][0]["album_title"] == "Axe to Fall"
        assert data["releases"][0]["status"] == "detected"


class TestHomeEndpointCaching:
    def test_home_hero_reads_from_discovery_snapshot(self, test_app):
        payload = {"hero": {"artist": "Converge", "reason": "Top artist"}}

        with patch("crate.api.me._get_home_discovery_payload", return_value=payload):
            resp = test_app.get("/api/me/home/hero")

        assert resp.status_code == 200
        data = resp.json()
        assert data["artist"] == "Converge"

    def test_home_recently_played_reads_from_discovery_snapshot(self, test_app):
        payload = {"recently_played": [{"track_id": 12, "title": "Locust Reign"}]}

        with patch("crate.api.me._get_home_discovery_payload", return_value=payload):
            resp = test_app.get("/api/me/home/recently-played")

        assert resp.status_code == 200
        data = resp.json()
        assert data["items"][0]["track_id"] == 12

    def test_home_mix_detail_uses_cache(self, test_app):
        cached_mix = {
            "id": "daily-discovery",
            "name": "Daily Discovery",
            "description": "Cached",
            "badge": "Mix",
            "kind": "mix",
            "track_count": 3,
            "artwork_tracks": [],
            "artwork_artists": [],
            "tracks": [],
        }

        with patch("crate.api.me.get_cache", return_value=cached_mix), \
             patch("crate.api.me.get_home_playlist", side_effect=AssertionError("unexpected playlist rebuild")):
            resp = test_app.get("/api/me/home/mixes/daily-discovery")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "daily-discovery"
        assert data["name"] == "Daily Discovery"

    def test_home_section_detail_uses_cache(self, test_app):
        cached_section = {
            "id": "custom-mixes",
            "title": "Custom mixes",
            "subtitle": "Cached",
            "items": [],
        }

        with patch("crate.api.me.get_cache", return_value=cached_section), \
             patch("crate.api.me.get_home_section", side_effect=AssertionError("unexpected section rebuild")):
            resp = test_app.get("/api/me/home/sections/custom-mixes")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "custom-mixes"
        assert data["title"] == "Custom mixes"


class TestShowsAPI:
    def test_cached_shows_coerces_numeric_ids(self, test_app):
        shows = [
            {
                "id": 62,
                "show_id": 62,
                "artist_name": "Converge",
                "date": "2026-05-10",
                "venue": "Sala X",
                "city": "Sevilla",
                "country": "Spain",
                "country_code": "ES",
                "lineup": ["Converge"],
            }
        ]
        refs = {"converge": {"id": 7, "slug": "converge"}}

        with patch("crate.api.browse_artist.db_get_shows", return_value=shows), \
             patch("crate.api.browse_artist.get_all_artist_genre_map", return_value={"Converge": ["metalcore"]}), \
             patch("crate.api.browse_artist._lookup_artist_refs", return_value=refs), \
             patch("crate.api.browse_artist._show_lineup_artists", return_value=[{"name": "Converge", "id": 7, "slug": "converge"}]):
            resp = test_app.get("/api/shows/cached?limit=5")

        assert resp.status_code == 200
        data = resp.json()
        assert data["events"][0]["id"] == "62"
        assert data["events"][0]["artist_slug"] == "converge"


class TestAdminLogsAPI:
    def test_admin_logs_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:logs", "subject_key": "surface:100", "version": 1, "stale": False, "generation_ms": 4},
            "logs": [
                {
                    "id": 1,
                    "worker_id": "worker-1",
                    "task_id": None,
                    "level": "info",
                    "category": "analysis",
                    "message": "Track analyzed",
                    "metadata": {"track_id": 7},
                    "created_at": "2026-04-23T12:00:00Z",
                }
            ],
            "workers": [
                {
                    "worker_id": "worker-1",
                    "last_seen": "2026-04-23T12:00:00Z",
                    "log_count": 14,
                }
            ],
        }

        with patch("crate.api.admin_metrics.get_cached_logs_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/logs-snapshot")

        assert resp.status_code == 200
        data = resp.json()
        assert data["logs"][0]["message"] == "Track analyzed"
        assert data["workers"][0]["worker_id"] == "worker-1"


class TestAdminMetricsAPI:
    def test_metrics_dashboard_uses_clean_http_metric_series(self, test_app):
        summary_calls: list[str] = []
        recent_calls: list[str] = []

        def fake_query_summary(name: str, minutes: int = 5):
            summary_calls.append(name)
            return {"count": 1, "avg": 42, "min": 42, "max": 42, "sum": 42}

        def fake_query_recent(name: str, minutes: int = 60):
            recent_calls.append(name)
            return []

        with patch("crate.metrics.query_summary", side_effect=fake_query_summary), \
             patch("crate.metrics.query_recent", side_effect=fake_query_recent), \
             patch("crate.db.cache.get_cache", return_value=None), \
             patch("crate.db.cache.set_cache"), \
             patch("crate.api.admin_metrics._build_metrics_system", return_value={}), \
             patch("crate.api.admin_metrics._list_running_tasks", return_value=[]):
            resp = test_app.get("/api/admin/metrics/dashboard?period=minute&minutes=5")

        assert resp.status_code == 200
        assert "api.request.latency" in summary_calls
        assert "api.request.count" in summary_calls
        assert "api.request.errors" in summary_calls
        assert "api.request.slow" in summary_calls
        assert "api.latency" not in summary_calls
        assert "api.request.latency" in recent_calls
        assert "api.request.count" in recent_calls
        assert "api.request.errors" in recent_calls
        assert "api.request.slow" in recent_calls
        assert "api.latency" not in recent_calls
        assert "api.latency" in resp.json()["timeseries"]

    def test_metrics_timeseries_maps_legacy_http_name(self, test_app):
        calls: list[str] = []

        def fake_query_recent(name: str, minutes: int = 60):
            calls.append(name)
            return []

        with patch("crate.metrics.query_recent", side_effect=fake_query_recent):
            resp = test_app.get("/api/admin/metrics/timeseries?name=api.latency&period=minute&minutes=5")

        assert resp.status_code == 200
        assert calls == ["api.request.latency"]
        assert resp.json()["name"] == "api.latency"


class TestHealthAPI:
    def test_health_issues_reads_from_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:health", "subject_key": "surface:all:500", "version": 1, "stale": False, "generation_ms": 5},
            "issues": [
                {
                    "id": 7,
                    "check_type": "duplicate_albums",
                    "severity": "high",
                    "description": "Duplicate album",
                    "details_json": {"artist": "Converge"},
                    "auto_fixable": False,
                    "status": "open",
                    "created_at": "2026-04-23T12:00:00Z",
                }
            ],
            "counts": {"duplicate_albums": 1},
            "total": 1,
            "filter": None,
        }

        with patch("crate.api.management.get_cached_health_surface", return_value=snapshot):
            resp = test_app.get("/api/manage/health-issues")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["issues"][0]["check_type"] == "duplicate_albums"

    def test_admin_health_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:health", "subject_key": "surface:all:500", "version": 2, "stale": False, "generation_ms": 9},
            "issues": [],
            "counts": {},
            "total": 0,
            "filter": None,
        }

        with patch("crate.api.management.get_cached_health_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/health-snapshot")

        assert resp.status_code == 200
        assert resp.json()["snapshot"]["scope"] == "ops:health"


class TestStackAPI:
    def test_stack_status_reads_from_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:stack", "subject_key": "global", "version": 3, "stale": False, "generation_ms": 11},
            "stack": {
                "available": True,
                "total": 2,
                "running": 1,
                "containers": [
                    {
                        "id": "abc123",
                        "name": "crate-api",
                        "image": "crate/api:latest",
                        "state": "running",
                        "status": "Up 5 minutes",
                        "ports": ["8585:8585"],
                    }
                ],
            },
        }

        with patch("crate.api.stack.get_cached_stack_surface", return_value=snapshot):
            resp = test_app.get("/api/stack/status")

        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] == 1
        assert data["containers"][0]["name"] == "crate-api"

    def test_admin_stack_snapshot(self, test_app):
        snapshot = {
            "snapshot": {"scope": "ops:stack", "subject_key": "global", "version": 4, "stale": False, "generation_ms": 7},
            "stack": {
                "available": True,
                "total": 1,
                "running": 1,
                "containers": [],
            },
        }

        with patch("crate.api.stack.get_cached_stack_surface", return_value=snapshot):
            resp = test_app.get("/api/admin/stack-snapshot")

        assert resp.status_code == 200
        assert resp.json()["snapshot"]["scope"] == "ops:stack"
