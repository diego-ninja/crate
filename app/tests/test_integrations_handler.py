import pytest

from crate.worker_handlers.integrations import (
    INTEGRATION_TASK_HANDLERS,
    _handle_sync_shows,
    _handle_backfill_similarities,
)


def _mock_emit_silence(monkeypatch):
    for name in ("emit_task_event", "emit_progress"):
        monkeypatch.setattr(
            f"crate.worker_handlers.integrations.{name}",
            lambda *args, **kwargs: None,
        )


class TestHandlerRegistration:
    def test_integration_task_handlers_registers_both_handlers(self):
        expected = {"sync_shows", "backfill_similarities"}
        assert set(INTEGRATION_TASK_HANDLERS.keys()) == expected

    def test_handlers_are_callable(self):
        for name in INTEGRATION_TASK_HANDLERS:
            assert callable(INTEGRATION_TASK_HANDLERS[name]), f"{name} not callable"


# ── _handle_sync_shows ────────────────────────────────────────────


class TestHandleSyncShows:
    @pytest.fixture(autouse=True)
    def _without_sync_locations(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_show_sync_locations",
            lambda: [],
        )

    def test_not_configured_returns_error(self, monkeypatch):
        # is_configured is lazily imported from crate.ticketmaster
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: False,
        )
        result = _handle_sync_shows("task-1", {}, {})
        assert result == {"error": "Ticketmaster not configured"}

    def test_empty_artist_list(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: ([], None),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )
        _mock_emit_silence(monkeypatch)

        result = _handle_sync_shows("task-1", {}, {})
        assert result["artists_checked"] == 0
        assert result["shows_found"] == 0

    def test_syncs_setlistfm_events_as_secondary_source(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.setlistfm.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.setlistfm.is_shows_sync_enabled",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: (
                [{"name": "Band A", "mbid": "artist-mbid"}],
                None,
            ),
        )
        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            lambda artist, limit=20: [],
        )
        monkeypatch.setattr(
            "crate.setlistfm.get_upcoming_shows",
            lambda mbid, limit=20: [
                {
                    "external_id": "setlistfm:event-1",
                    "artist_name": "Band A",
                    "date": "2099-12-31",
                    "local_time": None,
                    "venue": "The Venue",
                    "address_line1": None,
                    "city": "Madrid",
                    "region": "Madrid",
                    "postal_code": None,
                    "country": "Spain",
                    "country_code": "ES",
                    "latitude": None,
                    "longitude": None,
                    "url": "https://www.setlist.fm/setlist/event-1",
                    "image_url": None,
                    "lineup": ["Band A"],
                    "price_range": None,
                    "tickets_url": None,
                    "status": "scheduled",
                    "source": "setlistfm",
                }
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )
        upserted: list[dict] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted.append(kwargs),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})

        assert result["shows_found"] == 1
        assert upserted == [
            {
                "external_id": "setlistfm:event-1",
                "artist_name": "Band A",
                "date": "2099-12-31",
                "local_time": None,
                "venue": "The Venue",
                "address_line1": None,
                "city": "Madrid",
                "region": "Madrid",
                "postal_code": None,
                "country": "Spain",
                "country_code": "ES",
                "latitude": None,
                "longitude": None,
                "url": "https://www.setlist.fm/setlist/event-1",
                "image_url": None,
                "lineup": ["Band A"],
                "price_range": None,
                "tickets_url": None,
                "status": "scheduled",
                "source": "setlistfm",
            }
        ]

    def test_setlistfm_can_sync_when_ticketmaster_is_unconfigured(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: False,
        )
        monkeypatch.setattr(
            "crate.setlistfm.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.setlistfm.is_shows_sync_enabled",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: ([{"name": "Band A", "mbid": "artist-mbid"}], None),
        )
        monkeypatch.setattr(
            "crate.setlistfm.get_upcoming_shows",
            lambda mbid, limit=20: [
                {
                    "external_id": "setlistfm:event-1",
                    "artist_name": "Band A",
                    "date": "2099-12-31",
                    "venue": "The Venue",
                    "source": "setlistfm",
                }
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )
        upserted: list[dict] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted.append(kwargs),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})

        assert result["shows_found"] == 1
        assert upserted[0]["source"] == "setlistfm"

    def test_syncs_shows_for_each_artist(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: (
                [{"name": "Band A"}, {"name": "Band B"}],
                None,
            ),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 5,
        )

        upserted_shows: list[dict] = []

        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted_shows.append(kwargs),
        )

        # tm_get_shows is lazily imported from crate.ticketmaster as get_upcoming_shows
        def fake_shows(artist, limit=20):
            if artist == "Band A":
                return [
                    {
                        "id": "tm-1",
                        "local_date": "2026-06-15",
                        "local_time": "20:00",
                        "venue": "Venue 1",
                        "city": "City A",
                        "country": "US",
                        "country_code": "US",
                        "latitude": "40.7128",
                        "longitude": "-74.0060",
                        "url": "https://ticketmaster.com/1",
                        "image": "https://example.com/img1.jpg",
                        "lineup": ["Band A"],
                        "price_range": "20-50",
                        "status": "onsale",
                    },
                    {
                        "id": "tm-2",
                        "local_date": "2026-07-01",
                        "venue": "Venue 2",
                        "city": "City B",
                        "country": "US",
                        "country_code": "US",
                    },
                ]
            elif artist == "Band B":
                return []
            return []

        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            fake_shows,
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})
        assert result["artists_checked"] == 2
        assert result["shows_found"] == 2
        assert result["old_deleted"] == 5
        assert len(upserted_shows) == 2
        assert upserted_shows[0]["external_id"] == "tm-1"
        assert upserted_shows[0]["artist_name"] == "Band A"
        assert upserted_shows[0]["date"] == "2026-06-15"
        assert upserted_shows[0]["latitude"] == 40.7128
        assert upserted_shows[0]["longitude"] == -74.0060

    def test_skips_shows_without_external_id(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: ([{"name": "Band"}], None),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )

        upserted: list[dict] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted.append(kwargs),
        )
        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            lambda artist, limit=20: [
                {"id": None, "venue": "No ID Venue"},
                {"id": "", "venue": "Empty ID Venue"},
                {"id": "valid-id", "venue": "Valid Venue"},
            ],
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})
        assert result["shows_found"] == 1
        assert len(upserted) == 1
        assert upserted[0]["external_id"] == "valid-id"

    def test_survives_exception_for_individual_artist(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: (
                [{"name": "Crash Band"}, {"name": "Good Band"}],
                None,
            ),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )

        upserted: list[dict] = []

        def fake_shows(artist, limit=20):
            if artist == "Crash Band":
                raise RuntimeError("API timeout")
            return [
                {
                    "id": "tm-ok",
                    "local_date": "2026-08-01",
                    "venue": "OK Venue",
                    "city": "OKC",
                    "country": "US",
                    "country_code": "US",
                }
            ]

        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            fake_shows,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted.append(kwargs),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})
        assert result["artists_checked"] == 1
        assert result["shows_found"] == 1
        assert upserted[0]["artist_name"] == "Good Band"

    def test_handles_missing_optional_fields(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: ([{"name": "Minimal Band"}], None),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )

        upserted: list[dict] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: upserted.append(kwargs),
        )
        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            lambda artist, limit=20: [
                {
                    "id": "minimal-1",
                    "date": "2026-09-01T19:00:00Z",
                }
            ],
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_sync_shows("task-1", {}, {})
        assert result["shows_found"] == 1
        assert upserted[0]["external_id"] == "minimal-1"
        assert upserted[0]["date"] == "2026-09-01"
        assert upserted[0]["local_time"] is None
        assert upserted[0]["venue"] is None
        assert upserted[0]["latitude"] is None
        assert upserted[0]["price_range"] is None

    def test_respects_cancellation(self, monkeypatch):
        monkeypatch.setattr(
            "crate.ticketmaster.is_configured",
            lambda: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_library_artists",
            lambda per_page=10000: (
                [{"name": f"Band {i}"} for i in range(10)],
                None,
            ),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.delete_past_shows",
            lambda days_old=30: 0,
        )

        checked: list[str] = []
        monkeypatch.setattr(
            "crate.ticketmaster.get_upcoming_shows",
            lambda artist, limit=20: [],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.upsert_show",
            lambda **kwargs: None,
        )
        _mock_emit_silence(monkeypatch)

        def fake_cancelled(task_id):
            checked.append(task_id)
            return len(checked) > 3

        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            fake_cancelled,
        )

        result = _handle_sync_shows("task-1", {}, {})
        assert result["artists_checked"] <= 4


# ── _handle_backfill_similarities ─────────────────────────────────


class TestHandleBackfillSimilarities:
    def test_empty_rows(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )
        _mock_emit_silence(monkeypatch)

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["artists_processed"] == 0
        assert result["rows_upserted"] == 0

    def test_skips_rows_without_similar_json(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {"name": "Band A", "similar_json": None},
                {"name": "Band B", "similar_json": ""},
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )

        upserted: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda artist_name, similar: upserted.append((artist_name, similar)),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["artists_processed"] == 2
        assert result["rows_upserted"] == 0
        assert upserted == []

    def test_upserts_similarities_from_json_string(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {
                    "name": "Band A",
                    "similar_json": '[{"name": "Similar 1", "score": 0.8}]',
                },
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 1,
        )

        upserted: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda artist_name, similar: upserted.append((artist_name, similar)),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["artists_processed"] == 1
        assert result["rows_upserted"] == 1
        assert upserted == [("Band A", [{"name": "Similar 1", "score": 0.8}])]

    def test_upserts_similarities_from_list(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {
                    "name": "Band B",
                    "similar_json": [
                        {"name": "Sim A", "score": 0.9},
                        {"name": "Sim B", "score": 0.7},
                    ],
                },
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )

        upserted: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda artist_name, similar: upserted.append((artist_name, similar)),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["rows_upserted"] == 2

    def test_skips_invalid_json(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {"name": "Band", "similar_json": "{invalid json!!}"},
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )

        upserted: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda artist_name, similar: upserted.append((artist_name, similar)),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["rows_upserted"] == 0

    def test_skips_non_list_similar(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {"name": "Band", "similar_json": '{"not": "a-list"}'},
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )

        upserted: list[tuple] = []
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda artist_name, similar: upserted.append((artist_name, similar)),
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["rows_upserted"] == 0

    def test_survives_individual_row_failure(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {
                    "name": "Crash Artist",
                    "similar_json": '[{"name": "Sim", "score": 0.5}]',
                },
                {
                    "name": "Good Artist",
                    "similar_json": '[{"name": "Sim 2", "score": 0.6}]',
                },
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )

        upserted: list[tuple] = []

        def fake_upsert(artist_name, similar):
            if artist_name == "Crash Artist":
                raise RuntimeError("DB connection lost")
            upserted.append((artist_name, similar))

        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            fake_upsert,
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["artists_processed"] == 2
        assert result["rows_upserted"] == 1
        assert upserted == [("Good Artist", [{"name": "Sim 2", "score": 0.6}])]

    def test_respects_cancellation(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [
                {"name": f"Artist {i}", "similar_json": '[{"name": "S", "score": 0.5}]'}
                for i in range(20)
            ],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: 0,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda *a, **kw: None,
        )

        checked: list[str] = []

        def fake_cancelled(task_id):
            checked.append(task_id)
            return len(checked) > 5

        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            fake_cancelled,
        )
        _mock_emit_silence(monkeypatch)

        result = _handle_backfill_similarities("task-1", {}, {})
        # artists_processed = total = 20 (initial total), rows_upserted <= 6
        assert result["artists_processed"] == 20
        assert result["rows_upserted"] <= 6

    def test_survives_mark_library_status_failure(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.get_artists_with_similar_json",
            lambda: [{"name": "Band", "similar_json": '[{"name": "S", "score": 0.5}]'}],
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.mark_library_status",
            lambda: (_ for _ in ()).throw(RuntimeError("fail")),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.bulk_upsert_similarities",
            lambda *a, **kw: None,
        )
        _mock_emit_silence(monkeypatch)
        monkeypatch.setattr(
            "crate.worker_handlers.integrations.is_cancelled",
            lambda task_id: False,
        )

        result = _handle_backfill_similarities("task-1", {}, {})
        assert result["artists_processed"] == 1
