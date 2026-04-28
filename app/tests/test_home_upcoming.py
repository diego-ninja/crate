from crate.db.home_builder_upcoming_feed import _build_home_upcoming


def test_home_upcoming_trims_preview_items_but_keeps_full_summary(monkeypatch):
    releases = [
        {
            "id": 1,
            "artist_name": "Converge",
            "artist_id": 7,
            "artist_slug": "converge",
            "album_title": f"Release {index}",
            "release_type": "Album",
            "status": "detected",
            "release_date": f"2026-05-{index + 1:02d}",
            "detected_at": "2026-04-28T10:00:00+00:00",
        }
        for index in range(8)
    ]
    shows = [
        {
            "id": 100 + index,
            "artist_name": "Converge",
            "artist_id": 7,
            "artist_slug": "converge",
            "date": f"2026-06-{index + 1:02d}",
            "local_time": "20:00",
            "venue": f"Venue {index}",
            "city": "Madrid",
            "country": "Spain",
        }
        for index in range(7)
    ]

    monkeypatch.setattr(
        "crate.db.home_builder_upcoming_feed.get_followed_artists",
        lambda user_id: [{"artist_name": "Converge"}],
    )
    monkeypatch.setattr("crate.db.queries.user.get_upcoming_releases", lambda *args, **kwargs: releases)
    monkeypatch.setattr("crate.db.queries.user.get_upcoming_shows", lambda *args, **kwargs: shows)
    monkeypatch.setattr("crate.db.queries.shows.get_attending_show_ids", lambda user_id, ids: {100, 102})
    monkeypatch.setattr(
        "crate.db.repositories.auth.get_user_by_id",
        lambda user_id: {"latitude": None, "longitude": None, "show_radius_km": 60},
    )
    monkeypatch.setattr(
        "crate.db.home_builder_upcoming_feed._build_upcoming_insights_home",
        lambda user_id, shows, attending_show_ids: [{"type": "show_prep", "show_id": 100}],
    )

    payload = _build_home_upcoming(1, lookup_limit=120, item_limit=5)

    assert len(payload["items"]) == 5
    assert payload["summary"]["release_count"] == 8
    assert payload["summary"]["show_count"] == 7
    assert payload["summary"]["attending_count"] == 2
    assert payload["summary"]["insight_count"] == 1
    assert payload["insights"][0]["show_id"] == 100
