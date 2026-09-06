"""Tests for shows query modules."""

from datetime import date, timedelta

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestShowsShared:
    def test_show_dedupe_key(self):
        from crate.db.queries.shows_shared import show_dedupe_key

        show1 = {
            "artist_name": "Test Artist",
            "date": "2025-06-01",
            "local_time": "20:00",
            "venue": "Test Venue",
            "city": "Berlin",
            "country_code": "DE",
        }
        show2 = {
            "artist_name": "  test artist  ",
            "date": "2025-06-01",
            "local_time": "20:00",
            "venue": "test venue",
            "city": "berlin",
            "country_code": "de",
        }

        assert show_dedupe_key(show1) == show_dedupe_key(show2)

    def test_show_dedupe_key_different(self):
        from crate.db.queries.shows_shared import show_dedupe_key

        show1 = {
            "artist_name": "A",
            "date": "2025-06-01",
            "city": "X",
            "country_code": "US",
        }
        show2 = {
            "artist_name": "B",
            "date": "2025-06-01",
            "city": "X",
            "country_code": "US",
        }

        assert show_dedupe_key(show1) != show_dedupe_key(show2)

    def test_dedupe_show_rows_merges_complementary(self):
        from crate.db.queries.shows_shared import dedupe_show_rows

        shows = [
            {
                "artist_name": "Test Artist",
                "date": date(2025, 6, 1),
                "local_time": "20:00",
                "venue": "Venue",
                "city": "Berlin",
                "country_code": "DE",
                "source": "lastfm",
                "lastfm_attendance": None,
                "lineup": [],
            },
            {
                "artist_name": "Test Artist",
                "date": date(2025, 6, 1),
                "local_time": "20:00",
                "venue": "Venue",
                "city": "Berlin",
                "country_code": "de",
                "source": "ticketmaster",
                "lastfm_attendance": 500,
                "lineup": ["Support Act"],
            },
        ]

        result = dedupe_show_rows(shows)
        assert len(result) == 1
        assert result[0]["source"] == "both"
        assert result[0]["lastfm_attendance"] == 500
        assert "Support Act" in result[0]["lineup"]

    def test_dedupe_show_rows_merges_setlist_without_time_with_ticketmaster(self):
        from crate.db.queries.shows_shared import dedupe_show_rows

        shows = [
            {
                "external_id": "tm-1",
                "artist_name": "Test Artist",
                "date": date(2026, 8, 23),
                "local_time": "20:00",
                "venue": "Venue",
                "city": "Madrid",
                "country_code": "ES",
                "source": "ticketmaster",
                "url": "https://ticketmaster.test/event",
                "lineup": ["Test Artist"],
            },
            {
                "external_id": "setlistfm:event-1",
                "artist_name": "Test Artist",
                "date": date(2026, 8, 23),
                "local_time": None,
                "venue": "Venue",
                "city": "Madrid",
                "country_code": "ES",
                "source": "setlistfm",
                "url": "https://www.setlist.fm/setlist/event-1",
                "lineup": ["Test Artist"],
            },
        ]

        result = dedupe_show_rows(shows)

        assert len(result) == 1
        assert result[0]["source"] == "both"
        assert result[0]["local_time"] == "20:00"
        assert result[0]["url"] == "https://ticketmaster.test/event"

    def test_dedupe_show_rows_keeps_two_known_times_separate(self):
        from crate.db.queries.shows_shared import dedupe_show_rows

        base = {
            "artist_name": "Test Artist",
            "date": date(2026, 8, 23),
            "venue": "Venue",
            "city": "Madrid",
            "country_code": "ES",
            "source": "setlistfm",
        }

        result = dedupe_show_rows(
            [
                {**base, "local_time": "18:00"},
                {**base, "local_time": "21:00"},
            ]
        )

        assert len(result) == 2

    def test_dedupe_show_rows_empty(self):
        from crate.db.queries.shows_shared import dedupe_show_rows

        assert dedupe_show_rows([]) == []


class TestShowsLocationQueries:
    def test_get_unique_user_cities_empty(self, pg_db):
        from crate.db.queries.shows_location_queries import get_unique_user_cities

        assert get_unique_user_cities() == []

    def test_get_unique_user_cities_returns_distinct(self, pg_db):
        from crate.db.queries.shows_location_queries import get_unique_user_cities
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE users SET city = 'Berlin', country = 'Germany', country_code = 'DE',
                    latitude = 52.52, longitude = 13.405
                    WHERE id = 1
                    """
                )
            )

        cities = get_unique_user_cities()
        assert len(cities) == 1
        assert cities[0]["city"] == "Berlin"
        assert cities[0]["latitude"] == pytest.approx(52.52, rel=0.01)

    def test_get_unique_user_cities_excludes_null_lat(self, pg_db):
        from crate.db.queries.shows_location_queries import get_unique_user_cities

        cities = get_unique_user_cities()
        assert cities == []

    def test_get_show_cities_empty(self, pg_db):
        from crate.db.queries.shows_location_queries import get_show_cities

        assert get_show_cities() == []

    def test_get_show_cities_upcoming(self, pg_db):
        from crate.db.queries.shows_location_queries import get_show_cities
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country, status, source, created_at, updated_at) VALUES ('Artist A', CURRENT_DATE + INTERVAL '7 days', 'Berlin', 'Germany', 'upcoming', 'lastfm', NOW(), NOW())"
                )
            )

        cities = get_show_cities()
        assert "Berlin" in cities

    def test_get_show_cities_excludes_past(self, pg_db):
        from crate.db.queries.shows_location_queries import get_show_cities
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country, status, source, created_at, updated_at) VALUES ('Old Show', '2020-01-01', 'Paris', 'France', 'completed', 'lastfm', NOW(), NOW())"
                )
            )

        assert get_show_cities() == []

    def test_get_show_countries_upcoming(self, pg_db):
        from crate.db.queries.shows_location_queries import get_show_countries
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country, status, source, created_at, updated_at) VALUES ('Artist B', CURRENT_DATE + INTERVAL '14 days', 'London', 'United Kingdom', 'upcoming', 'lastfm', NOW(), NOW())"
                )
            )

        countries = get_show_countries()
        assert "United Kingdom" in countries


class TestShowsUpcomingQueries:
    @staticmethod
    def _future_date(days: int = 30) -> date:
        return date.today() + timedelta(days=days)

    def _insert_show(self, session, overrides=None):
        from sqlalchemy import text

        data = {
            "artist_name": "Test Artist",
            "venue": "Test Venue",
            "city": "Berlin",
            "country": "Germany",
            "country_code": "DE",
            "latitude": 52.52,
            "longitude": 13.405,
            "date": self._future_date(),
            "status": "upcoming",
            "source": "lastfm",
        }
        if overrides:
            data.update(overrides)
        session.execute(
            text(
                """
                INSERT INTO shows (artist_name, venue, city, country, country_code, latitude, longitude, date, status, source, created_at, updated_at)
                VALUES (:artist_name, :venue, :city, :country, :country_code, :latitude, :longitude, :date, :status, :source, NOW(), NOW())
                """
            ),
            data,
        )

    def test_get_upcoming_shows_empty(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows

        assert get_upcoming_shows() == []

    def test_get_upcoming_shows_returns_future(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session)

        shows = get_upcoming_shows()
        assert len(shows) == 1
        assert shows[0]["artist_name"] == "Test Artist"

    def test_get_upcoming_shows_excludes_cancelled(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"status": "cancelled"})

        assert get_upcoming_shows() == []

    def test_get_upcoming_shows_filter_by_artist(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"artist_name": "Band X"})
            self._insert_show(session, {"artist_name": "Band Y"})

        shows = get_upcoming_shows(artist_name="Band X")
        assert len(shows) == 1
        assert shows[0]["artist_name"] == "Band X"

    def test_get_upcoming_shows_filter_by_city(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"city": "London"})
            self._insert_show(session, {"city": "Berlin"})

        shows = get_upcoming_shows(city="London")
        assert len(shows) == 1
        assert shows[0]["city"] == "London"

    def test_get_upcoming_shows_near(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows_near
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"latitude": 52.520, "longitude": 13.405})

        shows = get_upcoming_shows_near(52.52, 13.405, radius_km=10)
        assert len(shows) == 1

    def test_get_upcoming_shows_near_far(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows_near
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"latitude": 52.520, "longitude": 13.405})

        shows = get_upcoming_shows_near(48.8566, 2.3522, radius_km=10)
        assert shows == []

    def test_get_upcoming_shows_near_excludes_null_coordinates(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_shows_near
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session, {"latitude": None, "longitude": None})

        shows = get_upcoming_shows_near(52.52, 13.405, radius_km=10)
        assert shows == []

    def test_get_all_shows_empty(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_all_shows

        assert get_all_shows() == []

    def test_get_all_shows_returns_recent(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_all_shows
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(session)

        shows = get_all_shows(limit=10)
        assert len(shows) == 1

    def test_get_upcoming_show_counts(self, pg_db):
        from crate.db.queries.shows_upcoming_queries import get_upcoming_show_counts
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            self._insert_show(
                session, {"date": self._future_date(30), "source": "lastfm"}
            )
            self._insert_show(
                session, {"date": self._future_date(60), "source": "ticketmaster"}
            )

        counts = get_upcoming_show_counts()
        assert counts["show_count"] == 2
        assert counts["lastfm_count"] == 1


class TestShowsUserQueries:
    def test_get_attending_show_ids_empty(self, pg_db):
        from crate.db.queries.shows_user_queries import get_attending_show_ids

        assert get_attending_show_ids(1, []) == set()

    def test_get_attending_show_ids_no_attendance(self, pg_db):
        from crate.db.queries.shows_user_queries import get_attending_show_ids

        assert get_attending_show_ids(1, [1, 2, 3]) == set()

    def test_get_attending_show_ids_returns_attended(self, pg_db):
        from crate.db.queries.shows_user_queries import get_attending_show_ids
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country, status, source, created_at, updated_at) VALUES ('Artist', CURRENT_DATE + INTERVAL '7 days', 'X', 'Y', 'upcoming', 'lastfm', NOW(), NOW())"
                )
            )
            row = (
                session.execute(text("SELECT id FROM shows LIMIT 1")).mappings().first()
            )
            show_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO user_show_attendance (user_id, show_id, created_at) VALUES (:uid, :sid, NOW())"
                ),
                {"uid": 1, "sid": show_id},
            )

        show_ids = get_attending_show_ids(1, [show_id])
        assert show_ids == {show_id}

    def test_get_show_reminders_empty(self, pg_db):
        from crate.db.queries.shows_user_queries import get_show_reminders

        assert get_show_reminders(1) == []

    def test_get_show_reminders_by_ids(self, pg_db):
        from crate.db.queries.shows_user_queries import get_show_reminders
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO shows (artist_name, date, city, country, status, source, created_at, updated_at) VALUES ('Artist C', CURRENT_DATE + INTERVAL '7 days', 'X', 'Y', 'upcoming', 'lastfm', NOW(), NOW())"
                )
            )
            row = (
                session.execute(text("SELECT id FROM shows LIMIT 1")).mappings().first()
            )
            show_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO user_show_reminders (user_id, show_id, reminder_type, created_at) VALUES (:uid, :sid, 'email', NOW())"
                ),
                {"uid": 1, "sid": show_id},
            )

        reminders = get_show_reminders(1, [show_id])
        assert len(reminders) == 1
        assert reminders[0]["show_id"] == show_id
        assert reminders[0]["reminder_type"] == "email"
