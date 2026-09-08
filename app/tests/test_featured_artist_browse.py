from __future__ import annotations


def test_browse_artists_defaults_to_recent_and_filters_featured(monkeypatch, test_app):
    from crate.api import browse_artist
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION

    captured: dict[str, object] = {}

    monkeypatch.setattr(browse_artist, "has_library_data", lambda: True)
    monkeypatch.setattr(
        browse_artist,
        "get_artists_count",
        lambda joins, where_sql, params: (
            captured.update(
                {"count_joins": joins, "where_sql": where_sql, "params": params}
            )
            or 1
        ),
    )

    def fake_get_artists_page(
        select_cols, joins, where_sql, order_sql, params, per_page, offset
    ):
        captured.update(
            {
                "select_cols": select_cols,
                "joins": joins,
                "page_where_sql": where_sql,
                "order_sql": order_sql,
                "page_params": params,
                "per_page": per_page,
                "offset": offset,
            }
        )
        return [
            {
                "id": 7,
                "entity_uid": "artist:7",
                "slug": "converge",
                "name": "Converge",
                "album_count": 8,
                "track_count": 40,
                "total_size": 1024 * 1024,
                "formats_json": ["flac"],
                "primary_format": "flac",
                "has_photo": True,
                "listeners": 10,
                "popularity": 5,
                "popularity_score": 0.5,
                "popularity_confidence": 1.0,
                "is_featured": True,
                "first_seen_at": "2026-08-01T00:00:00+00:00",
                "_hero_provenance": "manual",
                "_hero_review_status": "approved",
                "_hero_revision": f"{ARTIST_HERO_RENDER_VERSION}:abc",
                "_hero_source_width": 2000,
                "_hero_source_height": 1000,
                "_hero_desktop_source_width": 2000,
                "_hero_desktop_source_height": 1000,
                "_hero_mobile_source_width": 1200,
                "_hero_mobile_source_height": 1500,
                "_hero_desktop_recipe": {"mode": "crop"},
                "_hero_mobile_recipe": {"mode": "crop"},
            }
        ]

    monkeypatch.setattr(browse_artist, "get_artists_page", fake_get_artists_page)
    monkeypatch.setattr(browse_artist, "get_all_artist_issue_counts", lambda: {})
    monkeypatch.setattr(browse_artist, "get_artist_list_genres_map", lambda _: {})

    response = test_app.get("/api/artists?featured=true&per_page=1")

    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "id": 7,
            "entity_uid": "artist:7",
            "slug": "converge",
            "name": "Converge",
            "albums": 8,
            "tracks": 40,
            "total_size_mb": 1,
            "formats": ["flac"],
            "primary_format": "flac",
            "has_photo": True,
            "has_issues": False,
            "popularity": 5,
            "popularity_score": 0.5,
            "popularity_confidence": 1.0,
            "is_featured": True,
            "featured_devices": ["desktop", "mobile"],
        }
    ]
    assert captured["order_sql"] == "la.first_seen_at DESC, la.id DESC"
    assert "la.is_featured = TRUE" in str(captured["where_sql"])
    assert "la.first_seen_at" in str(captured["select_cols"])
    assert "hero" in str(captured["joins"])


def test_browse_artists_featured_false_returns_empty_featured_metadata(
    monkeypatch, test_app
):
    from crate.api import browse_artist

    monkeypatch.setattr(browse_artist, "has_library_data", lambda: True)
    monkeypatch.setattr(browse_artist, "get_artists_count", lambda *_: 1)
    monkeypatch.setattr(
        browse_artist,
        "get_artists_page",
        lambda *_: [
            {
                "id": 8,
                "entity_uid": "artist:8",
                "slug": "rival-schools",
                "name": "Rival Schools",
                "album_count": 2,
                "track_count": 10,
                "total_size": 0,
                "formats_json": [],
                "primary_format": None,
                "has_photo": False,
                "listeners": None,
                "popularity": None,
                "popularity_score": None,
                "popularity_confidence": None,
                "is_featured": False,
                "first_seen_at": "2026-08-02T00:00:00+00:00",
                "_hero_provenance": None,
                "_hero_review_status": None,
                "_hero_revision": None,
                "_hero_source_width": None,
                "_hero_source_height": None,
                "_hero_desktop_source_width": None,
                "_hero_desktop_source_height": None,
                "_hero_mobile_source_width": None,
                "_hero_mobile_source_height": None,
                "_hero_desktop_recipe": None,
                "_hero_mobile_recipe": None,
            }
        ],
    )
    monkeypatch.setattr(browse_artist, "get_all_artist_issue_counts", lambda: {})

    response = test_app.get("/api/artists?featured=false")

    assert response.status_code == 200
    assert response.json()["items"][0]["is_featured"] is False
    assert response.json()["items"][0]["featured_devices"] == []
