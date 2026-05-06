from unittest.mock import patch


def _home_context(top_artists=None):
    return {
        "top_artists": top_artists or [],
        "top_albums": [],
        "top_genres_lower": [],
        "mix_seed_genres": [],
        "interest_artists_lower": [],
        "followed_names_lower": [],
        "top_artist_names_lower": [],
        "saved_album_ids": [],
    }


def test_home_essentials_builds_seven_core_track_cards():
    from crate.db.home_personalized_collections import get_home_essentials

    context = _home_context(top_artists=[{"artist_id": index, "artist_name": f"Artist {index}"} for index in range(10)])

    with patch("crate.db.home_personalized_collections.get_cached_home_context", return_value=context), \
         patch("crate.db.home_personalized_collections.merged_artists_from_context", return_value=context["top_artists"]), \
         patch("crate.db.home_personalized_collections._build_core_playlists", return_value=[]) as build_core:
        get_home_essentials(1)

    build_core.assert_called_once_with(1, context["top_artists"], 7)


def test_home_core_tracks_section_caps_at_seven_cards():
    from crate.db.home_personalized_discovery import get_home_section

    context = _home_context(top_artists=[{"artist_id": index, "artist_name": f"Artist {index}"} for index in range(10)])

    with patch("crate.db.home_personalized_discovery.get_cached_home_context", return_value=context), \
         patch("crate.db.home_personalized_discovery.recent_releases_from_context", return_value=[]), \
         patch("crate.db.home_personalized_discovery._build_core_playlists", return_value=[]) as build_core:
        section = get_home_section(1, "core-tracks", limit=42)

    assert section is not None
    build_core.assert_called_once_with(1, context["top_artists"], 7)


def test_album_candidate_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_album_candidates

    captured = {}

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_album_candidates, "_fetch_rows", fake_fetch_rows)

    home_track_album_candidates.get_track_candidates_for_album_ids(
        user_id=9,
        album_ids=list(range(40)),
        limit=20,
    )

    assert captured["params"]["user_id"] == 9
    assert captured["params"]["album_ids"] == list(range(30))
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]
    assert "user_track_stats" in captured["sql"]
    assert "user_liked_tracks" in captured["sql"]


def test_discovery_track_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_discovery

    captured = {}

    class FakeMappings:
        def all(self):
            return [{"artist_name": "Converge"}]

    class FakeResult:
        def mappings(self):
            return FakeMappings()

    class FakeSession:
        def execute(self, statement, params=None):
            if params and "genres" in params:
                captured["artist_params"] = params
            return FakeResult()

    class FakeReadScope:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_discovery, "read_scope", lambda: FakeReadScope())
    monkeypatch.setattr(home_track_discovery, "_fetch_rows", fake_fetch_rows)

    home_track_discovery.get_discovery_track_rows(
        user_id=9,
        genres=["punk"],
        excluded_artist_names=["converge"],
        limit=20,
    )

    assert captured["artist_params"]["genres"] == ["punk"]
    assert captured["params"]["user_id"] == 9
    assert captured["params"]["artists"] == ["Converge"]
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]


def test_recent_interest_rows_include_user_feedback_signals(monkeypatch):
    from crate.db.queries import home_track_recent_interest

    captured = {}

    def fake_fetch_rows(sql, params):
        captured["sql"] = sql
        captured["params"] = params
        return []

    monkeypatch.setattr(home_track_recent_interest, "_fetch_rows", fake_fetch_rows)

    home_track_recent_interest.get_recent_interest_track_rows(
        user_id=9,
        interest_artists_lower=["converge"],
        limit=20,
    )

    assert captured["params"]["user_id"] == 9
    assert captured["params"]["artists"] == ["converge"]
    assert "AS user_play_count" in captured["sql"]
    assert "AS is_liked" in captured["sql"]


def test_daily_discovery_rotates_candidates_before_selection(monkeypatch):
    from crate.db import home_builder_mix_generation

    rows = [
        {
            "track_id": index,
            "track_path": f"/music/artist-{index}/track.flac",
            "title": f"Track {index}",
            "artist": f"Artist {index}",
            "album": f"Album {index}",
            "user_play_count": 0,
            "is_liked": False,
        }
        for index in range(5)
    ]

    monkeypatch.setattr(home_builder_mix_generation, "_query_discovery_tracks", lambda *args, **kwargs: rows)
    monkeypatch.setattr(home_builder_mix_generation, "_daily_rotation_index", lambda pool_size, user_id: 2)

    _, _, selected = home_builder_mix_generation._build_mix_rows(
        1,
        interest_artists_lower=[],
        top_genres_lower=["punk"],
        mix_id="daily-discovery",
        limit=3,
    )

    assert [row["title"] for row in selected] == ["Track 2", "Track 3", "Track 4"]
