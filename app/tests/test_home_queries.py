"""Tests for home query modules."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestHomeCatalog:
    def test_get_recent_global_artist_rows_empty(self, pg_db):
        from crate.db.queries.home_catalog import get_recent_global_artist_rows

        assert get_recent_global_artist_rows(limit=5) == []

    def test_get_recent_global_artist_rows_with_artists(self, pg_db):
        from crate.db.queries.home_catalog import get_recent_global_artist_rows

        pg_db.upsert_artist({"name": "Catalog Artist A"})
        pg_db.upsert_artist({"name": "Catalog Artist B"})

        rows = get_recent_global_artist_rows(limit=5)
        assert len(rows) >= 1
        assert "name" in rows[0]
        assert "slug" in rows[0]

    def test_get_recent_global_artist_rows_respects_limit(self, pg_db):
        from crate.db.queries.home_catalog import get_recent_global_artist_rows

        pg_db.upsert_artist({"name": "Limit Artist 1"})
        pg_db.upsert_artist({"name": "Limit Artist 2"})

        rows = get_recent_global_artist_rows(limit=1)
        assert len(rows) == 1

    def test_get_recent_global_artist_rows_uses_artist_first_album_not_metadata_update(
        self, pg_db
    ):
        from crate.db.queries.home_catalog import get_recent_global_artist_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Old Photo Update", "has_photo": 1})
        pg_db.upsert_album(
            {
                "artist": "Old Photo Update",
                "name": "Old Album",
                "path": "/music/old-photo-update/old-album",
                "dir_mtime": 100,
                "track_count": 1,
            }
        )
        pg_db.upsert_artist({"name": "Actually New Artist", "has_photo": 1})
        pg_db.upsert_album(
            {
                "artist": "Actually New Artist",
                "name": "First Album",
                "path": "/music/actually-new-artist/first-album",
                "dir_mtime": 900,
                "track_count": 1,
            }
        )
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET updated_at = NOW() + INTERVAL '1 day',
                        dir_mtime = NULL,
                        has_photo = 1
                    WHERE name = 'Old Photo Update'
                    """
                )
            )

        rows = get_recent_global_artist_rows(limit=2)

        assert [row["name"] for row in rows] == [
            "Actually New Artist",
            "Old Photo Update",
        ]

    def test_get_artist_genres_map_empty(self, pg_db):
        from crate.db.queries.home_catalog import get_artist_genres_map

        assert get_artist_genres_map([]) == {}

    def test_get_artist_genres_map_with_data(self, pg_db):
        from crate.db.queries.home_catalog import get_artist_genres_map

        pg_db.upsert_artist({"name": "Genre Map Artist"})
        pg_db.set_artist_genres("Genre Map Artist", [("post-punk", 0.9, "test")])

        genre_map = get_artist_genres_map(["Genre Map Artist"])
        assert "Genre Map Artist" in genre_map
        assert "post-punk" in genre_map["Genre Map Artist"]

    def test_get_artist_genre_profiles_map_with_data(self, pg_db):
        from crate.db.queries.home_catalog import get_artist_genre_profiles_map

        pg_db.upsert_artist({"name": "Genre Profile Artist"})
        pg_db.set_artist_genres(
            "Genre Profile Artist",
            [("hip-hop", 1.0, "test"), ("rap", 0.88, "test")],
        )

        profile_map = get_artist_genre_profiles_map(["Genre Profile Artist"])

        assert profile_map["Genre Profile Artist"][0]["name"] == "hip-hop"
        assert profile_map["Genre Profile Artist"][0]["percent"] == 100
        assert profile_map["Genre Profile Artist"][1]["percent"] == 88

    def test_get_library_artist_by_id_not_found(self, pg_db):
        from crate.db.queries.home_catalog import get_library_artist_by_id

        assert get_library_artist_by_id(99999) is None

    def test_get_library_artist_by_id_found(self, pg_db):
        from crate.db.queries.home_catalog import get_library_artist_by_id
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Lookup Artist"})
        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_artists WHERE name = 'Lookup Artist'")
                )
                .mappings()
                .first()
            )

        result = get_library_artist_by_id(row["id"])
        assert result is not None
        assert result["name"] == "Lookup Artist"

    def test_get_followed_artist_genre_names_empty(self, pg_db):
        from crate.db.queries.home_catalog import get_followed_artist_genre_names

        assert get_followed_artist_genre_names([], 5) == []

    def test_get_followed_artist_genre_names_no_data(self, pg_db):
        from crate.db.queries.home_catalog import get_followed_artist_genre_names

        assert get_followed_artist_genre_names(["nonexistent artist"], 5) == []

    def test_get_followed_artist_genre_names_with_data(self, pg_db):
        from crate.db.queries.home_catalog import get_followed_artist_genre_names

        pg_db.upsert_artist({"name": "FGAN Artist"})
        pg_db.set_artist_genres(
            "FGAN Artist", [("post-punk", 0.9, "test"), ("noise rock", 0.5, "test")]
        )

        names = get_followed_artist_genre_names(["fgan artist"], 5)
        assert "post-punk" in names
        assert "noise rock" in names

    def test_get_home_hero_rows_empty_params(self, pg_db):
        from crate.db.queries.home_catalog import get_home_hero_rows

        rows = get_home_hero_rows(
            followed_names_lower=["nonexistent"],
            similar_target_names_lower=[],
            top_genres_lower=["post-punk"],
        )
        assert rows == []

    def test_get_home_hero_rows_includes_user_taste_and_history_signals(self, pg_db):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        user = pg_db.create_user("hero-personalization-query@test.com")
        pg_db.upsert_artist({"name": "Followed Hero"})
        pg_db.upsert_artist({"name": "Listened Hero"})
        pg_db.set_artist_genres("Followed Hero", [("post-hardcore", 0.9, "test")])
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET has_photo = 1
                    WHERE name IN ('Followed Hero', 'Listened Hero')
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_follows (user_id, artist_name, created_at)
                    VALUES (:user_id, 'Followed Hero', NOW())
                    """
                ),
                {"user_id": user["id"]},
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_artist_stats (
                        user_id, stat_window, artist_name,
                        play_count, complete_play_count, minutes_listened,
                        first_played_at, last_played_at
                    )
                    VALUES (
                        :user_id, '90d', 'Listened Hero',
                        9, 7, 27.0, NOW() - INTERVAL '20 days', NOW()
                    )
                    """
                ),
                {"user_id": user["id"]},
            )
            session.execute(
                text(
                    """
                    INSERT INTO user_play_events (
                        user_id, artist, started_at, ended_at, created_at
                    )
                    VALUES (
                        :user_id, 'Listened Hero', NOW(), NOW(), NOW()
                    )
                    """
                ),
                {"user_id": user["id"]},
            )

        rows = get_home_hero_rows(
            user_id=user["id"],
            followed_names_lower=["followed hero"],
            similar_target_names_lower=["listened hero"],
            top_genres_lower=["post-hardcore"],
            limit=5,
        )

        followed = next(row for row in rows if row["name"] == "Followed Hero")
        listened = next(row for row in rows if row["name"] == "Listened Hero")
        assert followed["is_followed"] is True
        assert followed["genre_hits"] == 1
        assert listened["similar_hits"] == 1
        assert listened["user_play_count"] == 9
        assert listened["recent_exposure_count"] == 1

    def test_get_home_hero_rows_fallback_no_genre(self, pg_db):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Hero Artist"})
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_artists SET has_photo = 1, bio = 'A great artist' WHERE name = 'Hero Artist'"
                )
            )

        rows = get_home_hero_rows(
            followed_names_lower=[],
            similar_target_names_lower=[],
            top_genres_lower=["post-punk"],
        )
        assert len(rows) >= 1
        assert rows[0]["name"] == "Hero Artist"

    def test_get_home_hero_rows_accepts_approved_specific_artwork_without_photo(
        self, pg_db
    ):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.repositories.artist_hero_artwork import (
            upsert_artist_hero_artwork,
        )
        from crate.db.tx import read_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Hero Artwork Only"})
        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE name = 'Hero Artwork Only'")
            ).scalar_one()
        recipe = {
            "mode": "crop",
            "crop": {"x": 0, "y": 0, "width": 1800, "height": 1000},
            "position_x": 0.5,
            "position_y": 0.5,
            "scale": 1,
            "flip_horizontal": False,
            "blur": 32,
            "feather": 28,
            "gradient": 0.45,
        }
        upsert_artist_hero_artwork(
            artist_id=artist_id,
            provenance="manual",
            review_status="approved",
            source_width=1800,
            source_height=1000,
            desktop_recipe=recipe,
            mobile_recipe=recipe,
            revision="hero-only-revision",
        )

        rows = get_home_hero_rows(
            followed_names_lower=[],
            similar_target_names_lower=[],
            top_genres_lower=[],
        )

        hero = next(row for row in rows if row["name"] == "Hero Artwork Only")
        assert hero["artwork_provenance"] == "specific"

    def test_get_home_hero_rows_ignores_recommendation_feedback(self, pg_db):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.repositories.recommendations import record_recommendation_feedback
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        user = pg_db.create_user("hero-feedback-query@test.com")
        pg_db.upsert_artist({"name": "Dismissed Hero"})
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET has_photo = 1,
                        bio = 'A great artist',
                        listeners = 999999
                    WHERE name = 'Dismissed Hero'
                    """
                )
            )
        record_recommendation_feedback(
            user_id=user["id"],
            surface="home.hero",
            entity_type="artist",
            entity_key="artist:dismissed-hero",
            action="not_interested",
        )

        rows = get_home_hero_rows(
            user_id=user["id"],
            followed_names_lower=[],
            similar_target_names_lower=[],
            top_genres_lower=["post-punk"],
        )

        assert any(row["name"] == "Dismissed Hero" for row in rows)

    def test_get_home_hero_rows_orders_by_first_library_arrival(self, pg_db):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        for name, album, added_at in (
            ("Older Popular Hero", "Old Album", 100),
            ("Newest Quiet Hero", "New Album", 900),
        ):
            pg_db.upsert_artist({"name": name})
            pg_db.upsert_album(
                {
                    "artist": name,
                    "name": album,
                    "path": f"/music/{name.lower().replace(' ', '-')}/{album.lower().replace(' ', '-')}",
                    "dir_mtime": added_at,
                    "track_count": 1,
                }
            )
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET has_photo = 1,
                        bio = 'Eligible hero',
                        listeners = CASE
                            WHEN name = 'Older Popular Hero' THEN 9999999
                            ELSE 10
                        END
                    WHERE name IN ('Older Popular Hero', 'Newest Quiet Hero')
                    """
                )
            )

        rows = get_home_hero_rows(
            followed_names_lower=["newest quiet hero"],
            similar_target_names_lower=["older popular hero"],
            top_genres_lower=[],
            limit=2,
        )

        assert [row["name"] for row in rows] == [
            "Newest Quiet Hero",
            "Older Popular Hero",
        ]

    def test_get_home_hero_rows_weights_specific_artwork_inside_recent_window(
        self, pg_db
    ):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.repositories.artist_hero_artwork import (
            upsert_artist_hero_artwork,
        )
        from crate.db.tx import read_scope, transaction_scope
        from sqlalchemy import text

        for name, album, added_at in (
            ("Specific Older Hero", "Specific Album", 100),
            ("Fallback Newer Hero", "Fallback Album", 900),
        ):
            pg_db.upsert_artist({"name": name})
            pg_db.upsert_album(
                {
                    "artist": name,
                    "name": album,
                    "path": f"/music/{name}/{album}",
                    "dir_mtime": added_at,
                    "track_count": 1,
                }
            )
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET has_photo = 1
                    WHERE name IN ('Specific Older Hero', 'Fallback Newer Hero')
                    """
                )
            )
        with read_scope() as session:
            artist_id = session.execute(
                text(
                    """
                    SELECT id FROM library_artists
                    WHERE name = 'Specific Older Hero'
                    """
                )
            ).scalar_one()
        recipe = {
            "mode": "crop",
            "crop": {"x": 0, "y": 0, "width": 1800, "height": 1000},
            "position_x": 0.5,
            "position_y": 0.5,
            "scale": 1,
            "flip_horizontal": False,
            "blur": 32,
            "feather": 28,
            "gradient": 0.45,
        }
        upsert_artist_hero_artwork(
            artist_id=artist_id,
            provenance="manual",
            review_status="approved",
            source_width=1800,
            source_height=1000,
            desktop_recipe=recipe,
            mobile_recipe=recipe,
            revision="specific-priority",
        )

        rows = get_home_hero_rows(
            followed_names_lower=[],
            similar_target_names_lower=[],
            top_genres_lower=[],
            limit=2,
        )

        assert [row["name"] for row in rows] == [
            "Specific Older Hero",
            "Fallback Newer Hero",
        ]

    def test_get_home_hero_rows_prioritizes_specific_artwork_before_candidate_limit(
        self, pg_db
    ):
        from crate.db.queries.home_catalog import get_home_hero_rows
        from crate.db.repositories.artist_hero_artwork import (
            upsert_artist_hero_artwork,
        )
        from crate.db.tx import read_scope, transaction_scope
        from sqlalchemy import text

        artist_names = ["Specific Candidate Hero"]
        for index in range(15):
            name = f"Newer Fallback Hero {index:02d}"
            artist_names.append(name)
            pg_db.upsert_artist({"name": name})
            pg_db.upsert_album(
                {
                    "artist": name,
                    "name": f"Fallback Album {index:02d}",
                    "path": f"/music/{name}/album",
                    "dir_mtime": 200 + index,
                    "track_count": 1,
                }
            )

        pg_db.upsert_artist({"name": "Specific Candidate Hero"})
        pg_db.upsert_album(
            {
                "artist": "Specific Candidate Hero",
                "name": "Specific Candidate Album",
                "path": "/music/Specific Candidate Hero/album",
                "dir_mtime": 100,
                "track_count": 1,
            }
        )
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_artists
                    SET has_photo = 1
                    WHERE name = ANY(:artist_names)
                    """
                ),
                {"artist_names": artist_names},
            )
        with read_scope() as session:
            artist_id = session.execute(
                text(
                    """
                    SELECT id FROM library_artists
                    WHERE name = 'Specific Candidate Hero'
                    """
                )
            ).scalar_one()
        recipe = {
            "mode": "crop",
            "crop": {"x": 0, "y": 0, "width": 1800, "height": 1000},
            "position_x": 0.5,
            "position_y": 0.5,
            "scale": 1,
            "flip_horizontal": False,
            "blur": 32,
            "feather": 28,
            "gradient": 0.45,
        }
        upsert_artist_hero_artwork(
            artist_id=artist_id,
            provenance="manual",
            review_status="approved",
            source_width=1800,
            source_height=1000,
            desktop_recipe=recipe,
            mobile_recipe=recipe,
            revision="specific-candidate-priority",
        )

        rows = get_home_hero_rows(
            followed_names_lower=[],
            similar_target_names_lower=[],
            top_genres_lower=[],
            limit=5,
        )

        assert rows[0]["name"] == "Specific Candidate Hero"


class TestHomeTrackArtistCore:
    def _setup_artist_with_tracks(self, pg_db, artist_name, track_titles):
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": artist_name})
        album_id = pg_db.upsert_album(
            {
                "artist": artist_name,
                "name": f"{artist_name} Core Album",
                "path": f"/music/{artist_name}/{artist_name} Core Album",
                "track_count": len(track_titles),
                "total_size": 1000 * len(track_titles),
                "total_duration": 180.0 * len(track_titles),
                "formats": ["flac"],
            }
        )
        for i, title in enumerate(track_titles):
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist_name,
                    "album": f"{artist_name} Core Album",
                    "filename": f"{i + 1:02d}-{title.lower()}.flac",
                    "title": title,
                    "path": f"/music/{artist_name}/{artist_name} Core Album/{i + 1:02d}-{title.lower()}.flac",
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_artists WHERE name = :n"),
                    {"n": artist_name},
                )
                .mappings()
                .first()
            )
            return row["id"]

    def test_get_artist_core_track_rows_not_found(self, pg_db):
        from crate.db.queries.home_track_artist_core import get_artist_core_track_rows

        rows = get_artist_core_track_rows(
            artist_id=99999, artist_name="Nobody", limit=10
        )
        assert rows == []

    def test_get_artist_core_track_rows_returns_tracks(self, pg_db):
        from crate.db.queries.home_track_artist_core import get_artist_core_track_rows

        artist_id = self._setup_artist_with_tracks(
            pg_db, "Core Artist", ["Track A", "Track B", "Track C"]
        )

        rows = get_artist_core_track_rows(
            artist_id=artist_id, artist_name="Core Artist", limit=10
        )
        assert len(rows) == 3
        titles = {r["title"] for r in rows}
        assert titles == {"Track A", "Track B", "Track C"}

    def test_get_artists_core_track_rows_empty_ids(self, pg_db):
        from crate.db.queries.home_track_artist_core import get_artists_core_track_rows

        rows = get_artists_core_track_rows(artist_ids=[], per_artist_limit=5)
        assert rows == []

    def test_get_artists_core_track_rows_invalid_names(self, pg_db):
        from crate.db.queries.home_track_artist_core import get_artists_core_track_rows

        rows = get_artists_core_track_rows(artist_ids=[99999], per_artist_limit=5)
        assert rows == []

    def test_get_artists_core_track_rows_with_data(self, pg_db):
        from crate.db.queries.home_track_artist_core import get_artists_core_track_rows

        a1 = self._setup_artist_with_tracks(pg_db, "Multi Artist A", ["A1", "A2"])
        a2 = self._setup_artist_with_tracks(pg_db, "Multi Artist B", ["B1", "B2"])

        rows = get_artists_core_track_rows(artist_ids=[a1, a2], per_artist_limit=5)
        assert len(rows) == 4


class TestHomePlaylists:
    def test_get_recent_playlist_rows_with_artwork_empty(self, pg_db):
        from crate.db.queries.home_playlists import (
            get_recent_playlist_rows_with_artwork,
        )

        assert get_recent_playlist_rows_with_artwork(1, 5) == []

    def test_get_recent_playlist_rows_with_artwork(self, pg_db):
        from crate.db.queries.home_playlists import (
            get_recent_playlist_rows_with_artwork,
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text
        from datetime import datetime, timezone

        pg_db.upsert_artist({"name": "PL Artwork Artist"})
        album_id = pg_db.upsert_album(
            {
                "artist": "PL Artwork Artist",
                "name": "PL Artwork Album",
                "path": "/music/PL Artwork Artist/PL Artwork Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": "PL Artwork Artist",
                "album": "PL Artwork Album",
                "filename": "01-plaw.flac",
                "title": "PL Artwork Track",
                "path": "/music/PL Artwork Artist/PL Artwork Album/01-plaw.flac",
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            track_row = (
                session.execute(
                    text(
                        "SELECT id FROM library_tracks WHERE title = 'PL Artwork Track'"
                    )
                )
                .mappings()
                .first()
            )
            track_id = track_row["id"]

            session.execute(
                text(
                    "INSERT INTO playlists (name, description, scope, visibility, is_collaborative, track_count, total_duration, created_at, updated_at, is_active) VALUES ('Artwork PL', 'desc', 'user', 'public', false, 1, 180.0, NOW(), NOW(), true)"
                )
            )
            pl_row = (
                session.execute(
                    text("SELECT id FROM playlists WHERE name = 'Artwork PL'")
                )
                .mappings()
                .first()
            )
            pl_id = pl_row["id"]

            session.execute(
                text(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position, title, artist, album, duration, track_path, added_at) VALUES (:pid, :tid, 1, 'PL Artwork Track', 'PL Artwork Artist', 'PL Artwork Album', 180.0, '/music/PL Artwork Artist/PL Artwork Album/01-plaw.flac', NOW())"
                ),
                {"pid": pl_id, "tid": track_id},
            )
            session.execute(
                text(
                    "INSERT INTO user_play_events (user_id, context_playlist_id, track_id, started_at, ended_at, created_at) VALUES (:uid, :pid, :tid, :ts, :ts, :ts)"
                ),
                {
                    "uid": 1,
                    "pid": pl_id,
                    "tid": track_id,
                    "ts": datetime.now(timezone.utc),
                },
            )

        rows = get_recent_playlist_rows_with_artwork(1, 5)
        assert len(rows) >= 1
        assert rows[0]["type"] == "playlist"


class TestHomeTrackRows:
    def test_fetch_rows_with_valid_sql(self, pg_db):
        from crate.db.queries.home_track_rows import _fetch_rows

        rows = _fetch_rows("SELECT 1 AS value", {})
        assert rows == [{"value": 1}]
