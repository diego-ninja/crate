"""Integration tests for listening aggregate tables."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestUserListeningAggregates:
    def test_recompute_user_listening_aggregates_populates_daily_and_entity_stats(self, pg_db):
        pg_db.upsert_artist({"name": "Converge"})
        album_id = pg_db.upsert_album({
            "artist": "Converge",
            "name": "Jane Doe",
            "path": "/music/Converge/Jane Doe",
        })
        pg_db.upsert_track({
            "album_id": album_id,
            "artist": "Converge",
            "album": "Jane Doe",
            "filename": "01 - Concubine.flac",
            "title": "Concubine",
            "track_number": 1,
            "format": "flac",
            "genre": "Metalcore",
            "duration": 94.0,
            "path": "/music/Converge/Jane Doe/01 - Concubine.flac",
        })

        track = pg_db.get_library_tracks(album_id)[0]

        event_id = pg_db.record_play_event(
            1,
            track_id=track["id"],
            track_path=track["path"],
            title=track["title"],
            artist=track["artist"],
            album=track["album"],
            started_at="2026-04-01T10:00:00+00:00",
            ended_at="2026-04-01T10:01:10+00:00",
            played_seconds=70.0,
            track_duration_seconds=94.0,
            completion_ratio=0.74,
            was_skipped=True,
            was_completed=False,
            play_source_type="album",
            play_source_id=str(album_id),
            play_source_name="Jane Doe",
            context_artist="Converge",
            context_album="Jane Doe",
            device_type="web",
            app_platform="listen-web",
        )

        assert event_id is not None
        pg_db.recompute_user_listening_aggregates(1)

        with pg_db.get_db_ctx() as cur:
            cur.execute(
                "SELECT * FROM user_daily_listening WHERE user_id = %s AND day = %s",
                (1, "2026-04-01"),
            )
            daily = cur.fetchone()
            assert daily["play_count"] == 1
            assert daily["skip_count"] == 1
            assert daily["complete_play_count"] == 0
            assert round(daily["minutes_listened"], 2) == round(70.0 / 60.0, 2)
            assert daily["unique_tracks"] == 1
            assert daily["unique_artists"] == 1
            assert daily["unique_albums"] == 1

            cur.execute(
                """
                SELECT artist_name, play_count, minutes_listened
                FROM user_artist_stats
                WHERE user_id = %s AND stat_window = 'all_time'
                """,
                (1,),
            )
            artist_stats = cur.fetchone()
            assert artist_stats["artist_name"] == "Converge"
            assert artist_stats["play_count"] == 1

            cur.execute(
                """
                SELECT genre_name, play_count
                FROM user_genre_stats
                WHERE user_id = %s AND stat_window = 'all_time'
                """,
                (1,),
            )
            genre_stats = cur.fetchone()
            assert genre_stats["genre_name"] == "Metalcore"
            assert genre_stats["play_count"] == 1
