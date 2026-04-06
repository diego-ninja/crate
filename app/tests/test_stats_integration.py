"""Integration tests for stats and play events — real DB, no mocks."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

TEST_USER_ID = 99999


def _make_event(track, *, started_at, ended_at, played_seconds, duration=94.0,
                was_skipped=False, was_completed=False, album_id=None):
    completion = round(played_seconds / duration, 3) if duration else 0
    return dict(
        track_id=track["id"],
        track_path=track["path"],
        title=track["title"],
        artist=track["artist"],
        album=track["album"],
        started_at=started_at,
        ended_at=ended_at,
        played_seconds=played_seconds,
        track_duration_seconds=duration,
        completion_ratio=completion,
        was_skipped=was_skipped,
        was_completed=was_completed,
        play_source_type="album",
        play_source_id=str(album_id or ""),
        play_source_name=track["album"],
        context_artist=track["artist"],
        context_album=track["album"],
        device_type="web",
        app_platform="listen-web",
    )


@pytest.fixture
def stats_db(pg_db):
    """Set up library data for stats tests, clean up afterward."""
    pg_db.upsert_artist({"name": "Converge"})
    pg_db.upsert_artist({"name": "Botch"})

    album_jd = pg_db.upsert_album({
        "artist": "Converge", "name": "Jane Doe",
        "path": "/music/Converge/Jane Doe",
    })
    album_petitioning = pg_db.upsert_album({
        "artist": "Converge", "name": "Petitioning the Empty Sky",
        "path": "/music/Converge/Petitioning the Empty Sky",
    })
    album_botch = pg_db.upsert_album({
        "artist": "Botch", "name": "We Are the Romans",
        "path": "/music/Botch/We Are the Romans",
    })

    pg_db.upsert_track({
        "album_id": album_jd, "artist": "Converge", "album": "Jane Doe",
        "filename": "01 - Concubine.flac", "title": "Concubine",
        "track_number": 1, "format": "flac", "genre": "Metalcore",
        "duration": 94.0, "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
    })
    pg_db.upsert_track({
        "album_id": album_jd, "artist": "Converge", "album": "Jane Doe",
        "filename": "02 - Fault and Fracture.flac", "title": "Fault and Fracture",
        "track_number": 2, "format": "flac", "genre": "Metalcore",
        "duration": 225.0, "path": "/music/Converge/Jane Doe/02 - Fault and Fracture.flac",
    })
    pg_db.upsert_track({
        "album_id": album_petitioning, "artist": "Converge", "album": "Petitioning the Empty Sky",
        "filename": "01 - Forsaken.flac", "title": "Forsaken",
        "track_number": 1, "format": "flac", "genre": "Hardcore",
        "duration": 180.0, "path": "/music/Converge/Petitioning the Empty Sky/01 - Forsaken.flac",
    })
    pg_db.upsert_track({
        "album_id": album_botch, "artist": "Botch", "album": "We Are the Romans",
        "filename": "01 - Hutton's Great Heat Engine.flac", "title": "Hutton's Great Heat Engine",
        "track_number": 1, "format": "flac", "genre": "Mathcore",
        "duration": 312.0, "path": "/music/Botch/We Are the Romans/01 - Hutton's Great Heat Engine.flac",
    })

    tracks_jd = pg_db.get_library_tracks(album_jd)
    tracks_pet = pg_db.get_library_tracks(album_petitioning)
    tracks_botch = pg_db.get_library_tracks(album_botch)

    data = {
        "concubine": next(t for t in tracks_jd if t["title"] == "Concubine"),
        "fault": next(t for t in tracks_jd if t["title"] == "Fault and Fracture"),
        "forsaken": tracks_pet[0],
        "hutton": tracks_botch[0],
        "album_jd": album_jd,
        "album_petitioning": album_petitioning,
        "album_botch": album_botch,
    }

    yield pg_db, data

    # Cleanup test user data
    with pg_db.get_db_ctx() as cur:
        for table in (
            "user_play_events", "user_daily_listening",
            "user_track_stats", "user_artist_stats",
            "user_album_stats", "user_genre_stats",
        ):
            cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (TEST_USER_ID,))


class TestRecordPlayEvent:
    def test_returns_event_id(self, stats_db):
        db, data = stats_db
        event_id = db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-01T10:00:00+00:00",
                          ended_at="2026-04-01T10:01:34+00:00",
                          played_seconds=94.0,
                          was_completed=True,
                          album_id=data["album_jd"]),
        )
        assert isinstance(event_id, int)
        assert event_id > 0

    def test_skipped_event_stored_correctly(self, stats_db):
        db, data = stats_db
        event_id = db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-01T10:00:00+00:00",
                          ended_at="2026-04-01T10:00:30+00:00",
                          played_seconds=30.0,
                          was_skipped=True,
                          album_id=data["album_jd"]),
        )
        with db.get_db_ctx() as cur:
            cur.execute("SELECT was_skipped, was_completed FROM user_play_events WHERE id = %s", (event_id,))
            row = cur.fetchone()
        assert row["was_skipped"] is True
        assert row["was_completed"] is False


class TestAggregatesAndOverview:
    def _seed_events(self, db, data):
        """Insert a realistic spread of play events across multiple days/artists."""
        events = [
            # Day 1 (2026-04-01): 3 plays of Converge, 1 Botch
            _make_event(data["concubine"], started_at="2026-04-01T10:00:00+00:00",
                        ended_at="2026-04-01T10:01:34+00:00", played_seconds=94.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["fault"], started_at="2026-04-01T10:02:00+00:00",
                        ended_at="2026-04-01T10:05:45+00:00", played_seconds=225.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["forsaken"], started_at="2026-04-01T10:06:00+00:00",
                        ended_at="2026-04-01T10:07:00+00:00", played_seconds=60.0,
                        was_skipped=True, album_id=data["album_petitioning"]),
            _make_event(data["hutton"], started_at="2026-04-01T10:08:00+00:00",
                        ended_at="2026-04-01T10:13:12+00:00", played_seconds=312.0,
                        was_completed=True, album_id=data["album_botch"]),
            # Day 2 (2026-04-02): 2 more plays of Concubine
            _make_event(data["concubine"], started_at="2026-04-02T09:00:00+00:00",
                        ended_at="2026-04-02T09:01:34+00:00", played_seconds=94.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["concubine"], started_at="2026-04-02T09:05:00+00:00",
                        ended_at="2026-04-02T09:05:20+00:00", played_seconds=20.0,
                        was_skipped=True, album_id=data["album_jd"]),
        ]
        for ev in events:
            db.record_play_event(TEST_USER_ID, **ev)
        db.recompute_user_listening_aggregates(TEST_USER_ID)

    def test_overview_all_time_totals(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        from crate.db.user_library import get_stats_overview
        overview = get_stats_overview(TEST_USER_ID, window="all_time")

        assert overview["window"] == "all_time"
        assert overview["play_count"] == 6
        assert overview["complete_play_count"] == 4
        assert overview["skip_count"] == 2
        assert overview["active_days"] == 2
        expected_minutes = (94.0 + 225.0 + 60.0 + 312.0 + 94.0 + 20.0) / 60.0
        assert abs(overview["minutes_listened"] - expected_minutes) < 0.01
        assert abs(overview["skip_rate"] - 2 / 6) < 0.001

    def test_overview_top_artist(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        from crate.db.user_library import get_stats_overview
        overview = get_stats_overview(TEST_USER_ID, window="all_time")

        assert overview["top_artist"] is not None
        # Converge has 5 plays vs Botch's 1
        assert overview["top_artist"]["artist_name"] == "Converge"
        assert overview["top_artist"]["play_count"] == 5

    def test_daily_aggregation(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        with db.get_db_ctx() as cur:
            cur.execute(
                "SELECT * FROM user_daily_listening WHERE user_id = %s ORDER BY day",
                (TEST_USER_ID,),
            )
            rows = cur.fetchall()

        assert len(rows) == 2

        day1 = dict(rows[0])
        assert day1["play_count"] == 4
        assert day1["skip_count"] == 1
        assert day1["complete_play_count"] == 3
        assert day1["unique_artists"] == 2  # Converge + Botch

        day2 = dict(rows[1])
        assert day2["play_count"] == 2
        assert day2["skip_count"] == 1
        assert day2["unique_artists"] == 1  # Only Converge


class TestTopTracksAndArtists:
    def _seed_events(self, db, data):
        events = [
            # Concubine: 3 completed plays
            _make_event(data["concubine"], started_at="2026-04-01T10:00:00+00:00",
                        ended_at="2026-04-01T10:01:34+00:00", played_seconds=94.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["concubine"], started_at="2026-04-02T10:00:00+00:00",
                        ended_at="2026-04-02T10:01:34+00:00", played_seconds=94.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["concubine"], started_at="2026-04-03T10:00:00+00:00",
                        ended_at="2026-04-03T10:01:34+00:00", played_seconds=94.0,
                        was_completed=True, album_id=data["album_jd"]),
            # Fault and Fracture: 2 plays
            _make_event(data["fault"], started_at="2026-04-01T11:00:00+00:00",
                        ended_at="2026-04-01T11:03:45+00:00", played_seconds=225.0,
                        was_completed=True, album_id=data["album_jd"]),
            _make_event(data["fault"], started_at="2026-04-02T11:00:00+00:00",
                        ended_at="2026-04-02T11:03:45+00:00", played_seconds=225.0,
                        was_completed=True, album_id=data["album_jd"]),
            # Hutton: 1 play
            _make_event(data["hutton"], started_at="2026-04-01T12:00:00+00:00",
                        ended_at="2026-04-01T12:05:12+00:00", played_seconds=312.0,
                        was_completed=True, album_id=data["album_botch"]),
        ]
        for ev in events:
            db.record_play_event(TEST_USER_ID, **ev)
        db.recompute_user_listening_aggregates(TEST_USER_ID)

    def test_top_tracks_ranking(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        from crate.db.user_library import get_top_tracks
        top = get_top_tracks(TEST_USER_ID, window="all_time", limit=10)

        assert len(top) == 3
        assert top[0]["title"] == "Concubine"
        assert top[0]["play_count"] == 3
        assert top[1]["title"] == "Fault and Fracture"
        assert top[1]["play_count"] == 2
        assert top[2]["title"] == "Hutton's Great Heat Engine"
        assert top[2]["play_count"] == 1

    def test_top_artists_ranking(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        from crate.db.user_library import get_top_artists
        top = get_top_artists(TEST_USER_ID, window="all_time", limit=10)

        assert len(top) == 2
        assert top[0]["artist_name"] == "Converge"
        assert top[0]["play_count"] == 5
        assert top[1]["artist_name"] == "Botch"
        assert top[1]["play_count"] == 1

    def test_top_tracks_respects_limit(self, stats_db):
        db, data = stats_db
        self._seed_events(db, data)

        from crate.db.user_library import get_top_tracks
        top = get_top_tracks(TEST_USER_ID, window="all_time", limit=1)
        assert len(top) == 1
        assert top[0]["title"] == "Concubine"


class TestWindowFiltering:
    def test_recent_window_excludes_old_events(self, stats_db):
        db, data = stats_db

        # Old event: 60 days ago
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["hutton"],
                          started_at="2026-02-01T10:00:00+00:00",
                          ended_at="2026-02-01T10:05:12+00:00",
                          played_seconds=312.0,
                          was_completed=True,
                          album_id=data["album_botch"]),
        )
        # Recent event: today-ish (within 7d of "now" at test time)
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-05T10:00:00+00:00",
                          ended_at="2026-04-05T10:01:34+00:00",
                          played_seconds=94.0,
                          was_completed=True,
                          album_id=data["album_jd"]),
        )
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_top_artists

        # all_time should have both
        all_time = get_top_artists(TEST_USER_ID, window="all_time")
        artist_names = {a["artist_name"] for a in all_time}
        assert "Converge" in artist_names
        assert "Botch" in artist_names

        # 7d window should only have Converge (Botch event is 60+ days old)
        recent = get_top_artists(TEST_USER_ID, window="7d")
        artist_names_7d = {a["artist_name"] for a in recent}
        assert "Converge" in artist_names_7d
        assert "Botch" not in artist_names_7d

    def test_overview_window_30d(self, stats_db):
        db, data = stats_db

        # Old event outside 30d
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["hutton"],
                          started_at="2026-01-01T10:00:00+00:00",
                          ended_at="2026-01-01T10:05:12+00:00",
                          played_seconds=312.0,
                          was_completed=True,
                          album_id=data["album_botch"]),
        )
        # Recent event
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-05T10:00:00+00:00",
                          ended_at="2026-04-05T10:01:34+00:00",
                          played_seconds=94.0,
                          was_completed=True,
                          album_id=data["album_jd"]),
        )
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview
        overview = get_stats_overview(TEST_USER_ID, window="30d")

        # Only the recent event's day should count
        assert overview["play_count"] == 1
        assert overview["active_days"] == 1


class TestEdgeCases:
    def test_zero_plays_overview(self, stats_db):
        db, _ = stats_db
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview
        overview = get_stats_overview(TEST_USER_ID, window="all_time")

        assert overview["play_count"] == 0
        assert overview["skip_count"] == 0
        assert overview["minutes_listened"] == 0
        assert overview["active_days"] == 0
        assert overview["skip_rate"] == 0
        assert overview["top_artist"] is None

    def test_zero_plays_top_tracks(self, stats_db):
        db, _ = stats_db
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_top_tracks
        assert get_top_tracks(TEST_USER_ID, window="all_time") == []

    def test_single_play(self, stats_db):
        db, data = stats_db
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-01T10:00:00+00:00",
                          ended_at="2026-04-01T10:01:34+00:00",
                          played_seconds=94.0,
                          was_completed=True,
                          album_id=data["album_jd"]),
        )
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview, get_top_tracks
        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["play_count"] == 1
        assert overview["complete_play_count"] == 1
        assert overview["skip_count"] == 0
        assert overview["skip_rate"] == 0

        top = get_top_tracks(TEST_USER_ID, window="all_time")
        assert len(top) == 1
        assert top[0]["title"] == "Concubine"

    def test_all_skipped(self, stats_db):
        db, data = stats_db
        for i in range(3):
            db.record_play_event(
                TEST_USER_ID,
                **_make_event(data["concubine"],
                              started_at=f"2026-04-01T1{i}:00:00+00:00",
                              ended_at=f"2026-04-01T1{i}:00:15+00:00",
                              played_seconds=15.0,
                              was_skipped=True,
                              album_id=data["album_jd"]),
            )
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        from crate.db.user_library import get_stats_overview
        overview = get_stats_overview(TEST_USER_ID, window="all_time")
        assert overview["play_count"] == 3
        assert overview["complete_play_count"] == 0
        assert overview["skip_count"] == 3
        assert overview["skip_rate"] == 1.0

    def test_get_play_stats_uses_aggregates(self, stats_db):
        db, data = stats_db
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["concubine"],
                          started_at="2026-04-01T10:00:00+00:00",
                          ended_at="2026-04-01T10:01:34+00:00",
                          played_seconds=94.0,
                          was_completed=True,
                          album_id=data["album_jd"]),
        )
        db.record_play_event(
            TEST_USER_ID,
            **_make_event(data["hutton"],
                          started_at="2026-04-01T11:00:00+00:00",
                          ended_at="2026-04-01T11:05:12+00:00",
                          played_seconds=312.0,
                          was_completed=True,
                          album_id=data["album_botch"]),
        )
        db.recompute_user_listening_aggregates(TEST_USER_ID)

        stats = db.get_play_stats(TEST_USER_ID)
        assert stats["total_plays"] == 2
        assert len(stats["top_artists"]) == 2
        # Both have 1 play each; order by play_count DESC, minutes DESC
        artist_names = {a["artist"] for a in stats["top_artists"]}
        assert artist_names == {"Converge", "Botch"}

    def test_invalid_window_raises(self, stats_db):
        from crate.db.user_library import get_stats_overview
        with pytest.raises(ValueError, match="Unsupported stats window"):
            get_stats_overview(TEST_USER_ID, window="banana")
