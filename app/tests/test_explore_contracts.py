"""Regression contracts for Listen Explore endpoints."""

from unittest.mock import MagicMock, patch
from contextlib import contextmanager


def _make_mock_session(fetchall_side_effects: list[list[dict]]):
    """Create a mock session that returns successive results for .execute().mappings().all()/.first()."""
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
            rows = fetchall_side_effects[idx] if idx < len(fetchall_side_effects) else []
            return MagicMock(mappings=lambda: MockMappings(rows))

    @contextmanager
    def mock_scope():
        yield MockSession()

    return mock_scope


class TestExploreFiltersContract:
    def test_browse_filters_exposes_genres_and_decades(self, test_app):
        mock_scope = _make_mock_session([
            [{"name": "Metalcore", "cnt": 4}, {"name": "Post-Hardcore", "cnt": 2}],
            [{"country": "US", "cnt": 3}],
            [{"formed": "1994-01-01"}, {"formed": "2005"}, {"formed": "2001-08-09"}],
            [{"format": "FLAC", "cnt": 12}],
        ])

        with patch("crate.db.queries.browse_artist.transaction_scope", mock_scope):
            resp = test_app.get("/api/browse/filters")
            assert resp.status_code == 200
            data = resp.json()
            assert [genre["name"] for genre in data["genres"]] == ["Metalcore", "Post-Hardcore"]
            assert data["decades"] == ["1990s", "2000s"]
            assert data["formats"][0]["name"] == "FLAC"


class TestExploreSearchContract:
    def test_search_short_query_still_returns_tracks_key(self, test_app):
        resp = test_app.get("/api/search?q=a")
        assert resp.status_code == 200
        assert resp.json() == {"artists": [], "albums": [], "tracks": []}

    def test_search_returns_full_payload_shape(self, test_app):
        mock_scope = _make_mock_session([
            [{"id": 1, "slug": "converge", "name": "Converge", "album_count": 10, "has_photo": 1}],
            [{"id": 5, "slug": "jane-doe", "artist": "Converge", "name": "Jane Doe", "year": "2001",
              "has_cover": 1, "artist_id": 1, "artist_slug": "converge"}],
            [{
                "id": 99,
                "storage_id": None,
                "slug": "concubine",
                "title": "Concubine",
                "artist": "Converge",
                "album_id": 5,
                "album_slug": "jane-doe",
                "album": "Jane Doe",
                "artist_id": 1,
                "artist_slug": "converge",
                "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
                "duration": 94.0,
            }],
        ])

        with patch("crate.api.browse_media.has_library_data", return_value=True), \
             patch("crate.db.queries.browse_media.transaction_scope", mock_scope):
            resp = test_app.get("/api/search?q=converge&limit=10")
            assert resp.status_code == 200
            data = resp.json()
            assert data["artists"][0]["name"] == "Converge"
            assert data["artists"][0]["album_count"] == 10
            assert data["artists"][0]["has_photo"] is True
            assert data["albums"][0]["name"] == "Jane Doe"
            assert data["albums"][0]["artist"] == "Converge"
            assert data["tracks"][0]["title"] == "Concubine"
