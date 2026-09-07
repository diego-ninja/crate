from __future__ import annotations

from datetime import date, timedelta

import pytest

from crate.db.home_debug import collect_home_debug


def _hero_row(
    name: str,
    *,
    listeners: int,
    genre_hits: int = 0,
    similar_hits: int = 0,
    recent_exposure_count: int = 0,
) -> dict:
    slug = name.lower().replace(" ", "-")
    return {
        "id": abs(hash(name)) % 10000,
        "slug": slug,
        "name": name,
        "is_featured": True,
        "listeners": listeners,
        "scrobbles": listeners * 10,
        "album_count": 3,
        "track_count": 24,
        "bio": f"{name} biography",
        "genre_hits": genre_hits,
        "similar_hits": similar_hits,
        "recent_exposure_count": recent_exposure_count,
    }


def test_home_hero_scorer_prioritizes_taste_over_global_popularity():
    from crate.db.home_hero_scoring import HOME_HERO_SCORE_VERSION, score_home_hero_rows

    rows = [
        _hero_row("Global Popular", listeners=10_000_000, genre_hits=0, similar_hits=0),
        _hero_row("Taste Match", listeners=80_000, genre_hits=2, similar_hits=1),
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Taste Match"
    assert scored[0]["score_version"] == HOME_HERO_SCORE_VERSION
    assert scored[0]["score_contributions"][0]["reason"] in {
        "similar_artist_match",
        "genre_overlap",
    }


def test_home_hero_scorer_penalizes_recent_exposure():
    from crate.db.home_hero_scoring import score_home_hero_rows

    rows = [
        _hero_row(
            "Repeated Artist",
            listeners=90_000,
            genre_hits=2,
            similar_hits=1,
            recent_exposure_count=3,
        ),
        _hero_row("Fresh Artist", listeners=90_000, genre_hits=2, similar_hits=1),
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Fresh Artist"
    assert any(
        contribution["reason"] == "recent_exposure_penalty"
        for contribution in scored[1]["score_contributions"]
    )


def test_home_hero_scorer_uses_user_taste_signals():
    from crate.db.home_hero_scoring import score_home_hero_rows

    rows = [
        _hero_row("Global Popular", listeners=10_000_000),
        {
            **_hero_row("Followed Match", listeners=10_000),
            "is_followed": True,
            "user_play_count": 12,
            "genre_hits": 2,
        },
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Followed Match"
    reasons = {
        contribution["reason"] for contribution in scored[0]["score_contributions"]
    }
    assert {"followed_artist", "user_listening", "genre_overlap"} <= reasons


def test_home_hero_rotation_is_stable_per_day_but_varies_over_time():
    from crate.db.home_hero_scoring import rotate_home_hero_rows

    rows = [{"id": index, "name": f"Artist {index}"} for index in range(5)]
    first_day = date(2026, 8, 2)

    same_day = rotate_home_hero_rows(rows, user_id=7, day=first_day)
    repeated_same_day = rotate_home_hero_rows(rows, user_id=7, day=first_day)
    across_days = {
        rotate_home_hero_rows(
            rows,
            user_id=7,
            day=first_day + timedelta(days=offset),
        )[0]["name"]
        for offset in range(31)
    }

    assert same_day == repeated_same_day
    assert len(across_days) >= 2


def test_home_hero_selection_rotates_the_full_candidate_pool():
    from crate.db.home_hero_scoring import select_home_hero_rows

    rows = [{"id": index, "name": f"Artist {index}"} for index in range(24)]
    first_day = date(2026, 8, 2)

    same_day = select_home_hero_rows(rows, user_id=7, day=first_day, limit=8)
    repeated_same_day = select_home_hero_rows(rows, user_id=7, day=first_day, limit=8)
    across_days = {
        tuple(
            row["id"]
            for row in select_home_hero_rows(
                rows,
                user_id=7,
                day=first_day + timedelta(days=offset),
                limit=8,
            )
        )
        for offset in range(31)
    }

    assert same_day == repeated_same_day
    assert len(same_day) == 8
    assert len({row["id"] for row in same_day}) == 8
    assert len(across_days) >= 2


def test_home_hero_builder_preserves_recent_arrival_order(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [
            _hero_row("Newest Arrival", listeners=9_000, genre_hits=0),
            _hero_row("Older Popular Artist", listeners=9_000_000, genre_hits=0),
        ],
    )
    monkeypatch.setattr(
        queries,
        "get_artist_genre_profiles_map",
        lambda names, **_: {
            name: [{"name": "hardcore"}, {"name": "mathcore"}] for name in names
        },
    )

    with collect_home_debug() as diagnostics:
        heroes = queries.get_home_hero(
            7,
            followed_names_lower=[],
            similar_target_names_lower=["converge"],
            top_genres_lower=["hardcore"],
        )

    assert heroes is not None
    assert [hero["name"] for hero in heroes] == [
        "Newest Arrival",
        "Older Popular Artist",
    ]
    assert all("score" not in hero for hero in heroes)
    assert all(hero["artwork_provenance"] == "fallback" for hero in heroes)
    assert diagnostics["hero"]["selection_version"] == "home_just_landed_v2"
    assert diagnostics["hero"]["candidate_pool_size"] == 2
    assert diagnostics["hero"]["selected_count"] == 2
    assert diagnostics["hero"]["candidates"][0]["name"] == "Newest Arrival"
    assert "top_contributions" not in diagnostics["hero"]["candidates"][0]


def test_home_hero_builder_personalizes_a_larger_candidate_pool(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    captured: dict = {}

    def get_rows(**kwargs):
        captured.update(kwargs)
        return [
            _hero_row("Global Popular", listeners=10_000_000),
            {
                **_hero_row("Followed Match", listeners=10_000),
                "is_followed": True,
                "user_play_count": 12,
                "genre_hits": 2,
            },
        ]

    monkeypatch.setattr(queries, "get_home_hero_rows", get_rows)
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    heroes = queries.get_home_hero(7, ["followed match"], [], ["hardcore"])

    assert captured["limit"] == 32
    assert heroes is not None
    assert heroes[0]["name"] == "Followed Match"
    assert len(heroes) == 2


def test_home_hero_builder_deduplicates_visible_artist_names(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    first_dredg = _hero_row("Dredg", listeners=1_000)
    second_dredg = {
        **_hero_row("Dredg", listeners=900),
        "id": first_dredg["id"] + 1,
        "slug": "dredg-duplicate-record",
    }
    other = _hero_row("Other Artist", listeners=800)

    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [first_dredg, second_dredg, other],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert [hero["name"] for hero in heroes] == ["Dredg", "Other Artist"]


def test_home_hero_builder_preserves_artwork_provenance(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    specific = _hero_row("Editorial Hero", listeners=1_000)
    specific["artwork_provenance"] = "specific"
    monkeypatch.setattr(queries, "get_home_hero_rows", lambda **_: [specific])
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert heroes[0]["artwork_provenance"] == "specific"


def test_home_hero_builder_exposes_fill_bounds_without_internal_recipe(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    specific = _hero_row("Editorial Hero", listeners=1_000)
    specific.update(
        {
            "artwork_provenance": "specific",
            "_hero_source_width": 700,
            "_hero_source_height": 1000,
            "_hero_desktop_source_width": None,
            "_hero_desktop_source_height": None,
            "_hero_mobile_source_width": None,
            "_hero_mobile_source_height": None,
            "_hero_desktop_recipe": {
                "mode": "extend",
                "position_x": 0.5,
                "position_y": 0.5,
                "scale": 1.0,
                "rotation": 0,
            },
            "_hero_mobile_recipe": {
                "mode": "crop",
                "rotation": 0,
            },
        }
    )
    monkeypatch.setattr(queries, "get_home_hero_rows", lambda **_: [specific])
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert heroes[0]["desktop_artwork_bounds"] == pytest.approx(
        {"left": 0.0, "top": -1.262, "right": 1.0, "bottom": 2.262},
        abs=0.001,
    )
    assert heroes[0]["mobile_artwork_bounds"] == {
        "left": 0.0,
        "top": 0.0,
        "right": 1.0,
        "bottom": 1.0,
    }
    assert not any(key.startswith("_hero_") for key in heroes[0])


def _prepared_hero_row(
    name: str,
    *,
    desktop: bool = True,
    mobile: bool = True,
    review_status: str = "approved",
    provenance: str = "manual",
) -> dict:
    row = _hero_row(name, listeners=1_000)
    row.update(
        {
            "_hero_provenance": provenance,
            "_hero_review_status": review_status,
            "artwork_provenance": "specific" if provenance == "manual" else "derived",
            "artwork_revision": "cover-fit-v4:prepared",
            "_hero_source_width": 1480,
            "_hero_source_height": 600,
        }
    )
    if desktop:
        row["_hero_desktop_recipe"] = {
            "mode": "extend",
            "position_x": 0.5,
            "position_y": 0.5,
            "scale": 1.0,
            "rotation": 0,
        }
    if mobile:
        row["_hero_mobile_recipe"] = {
            "mode": "crop",
            "rotation": 0,
        }
    return row


def test_home_hero_bundle_selects_ready_artists_per_surface(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    desktop_only = _prepared_hero_row("Desktop Ready", mobile=False)
    mobile_only = _prepared_hero_row("Mobile Ready", desktop=False)
    unavailable = _hero_row("Unavailable Candidate", listeners=900)
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [desktop_only, mobile_only, unavailable],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert bundle["hero_surfaces"]["desktop"]["mode"] == "canonical"
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["desktop"]["artists"]
    ] == ["Desktop Ready"]
    assert bundle["hero_surfaces"]["mobile"]["mode"] == "canonical"
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["mobile"]["artists"]
    ] == ["Mobile Ready"]


def test_home_hero_bundle_selects_up_to_eight_desktop_artists(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    desktop_ready = [
        _prepared_hero_row(f"Desktop Ready {index}", mobile=False) for index in range(8)
    ]
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: desktop_ready,
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["desktop"]["artists"]
    ] == [f"Desktop Ready {index}" for index in range(8)]


def test_home_hero_bundle_does_not_lose_ready_desktop_artists_to_fallbacks(
    monkeypatch,
):
    from crate.db import home_builder_discovery_queries as queries

    fallback_candidates = [
        {
            **_hero_row(f"Fallback {index}", listeners=100),
            "is_followed": True,
            "user_play_count": 20,
        }
        for index in range(2)
    ]
    desktop_ready = [
        _prepared_hero_row(f"Desktop Ready {index}", mobile=False) for index in range(6)
    ]
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: fallback_candidates + desktop_ready,
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["desktop"]["artists"]
    ] == [f"Desktop Ready {index}" for index in range(6)]


def test_home_hero_bundle_skips_artist_without_mobile_source(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    desktop_only = _prepared_hero_row("Birds In Row")
    desktop_only.update(
        {
            "_hero_desktop_source_width": 1400,
            "_hero_desktop_source_height": 700,
            "_hero_mobile_source_width": None,
            "_hero_mobile_source_height": None,
        }
    )
    mobile_ready = _prepared_hero_row("Mobile Ready")
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [desktop_only, mobile_ready],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["mobile"]["artists"]
    ] == ["Mobile Ready"]


def test_home_hero_bundle_hides_surfaces_without_manual_approved_artwork(
    monkeypatch,
):
    from crate.db import home_builder_discovery_queries as queries

    derived = _prepared_hero_row("Derived Candidate", provenance="derived_background")
    pending = _prepared_hero_row("Pending Candidate", review_status="pending")
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [derived, pending],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert bundle["hero_surfaces"]["desktop"]["mode"] == "legacy"
    assert bundle["hero_surfaces"]["desktop"]["artists"] == bundle["hero"]
    assert bundle["hero_surfaces"]["mobile"]["mode"] == "legacy"
    assert bundle["hero_surfaces"]["mobile"]["artists"] == bundle["hero"]


def test_home_hero_bundle_falls_back_to_legacy_without_featured_candidates(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    legacy = {
        **_hero_row("Legacy Artist", listeners=100),
        "is_featured": False,
    }
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [legacy],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert bundle["hero_surfaces"]["desktop"] == {
        "mode": "legacy",
        "artists": [bundle["hero"][0]],
    }
    assert bundle["hero_surfaces"]["mobile"]["mode"] == "legacy"


def test_home_hero_bundle_keeps_non_featured_artists_out_of_canonical_surfaces(
    monkeypatch,
):
    from crate.db import home_builder_discovery_queries as queries

    featured = _prepared_hero_row("Featured Artist", mobile=False)
    legacy = {
        **_prepared_hero_row("Legacy Artist", mobile=False),
        "is_featured": False,
    }
    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [legacy, featured],
    )
    monkeypatch.setattr(
        queries, "get_artist_genre_profiles_map", lambda _names, **_: {}
    )

    bundle = queries.get_home_hero_bundle(7, [], [], [])

    assert bundle is not None
    assert bundle["hero_surfaces"]["desktop"]["mode"] == "canonical"
    assert [
        artist["name"] for artist in bundle["hero_surfaces"]["desktop"]["artists"]
    ] == ["Featured Artist"]
    assert bundle["hero_surfaces"]["mobile"]["mode"] == "legacy"


def test_home_hero_surface_rotation_keeps_surface_modes(monkeypatch):
    from crate.db import home_discovery_surface as surface

    payload = {
        "hero": [{"id": 1, "name": "Unavailable"}],
        "hero_surfaces": {
            "desktop": {
                "mode": "canonical",
                "artists": [
                    {"id": 1, "name": "One"},
                    {"id": 2, "name": "Two"},
                ],
            },
            "mobile": {
                "mode": "canonical",
                "artists": [{"id": 3, "name": "Three"}],
            },
        },
    }

    monkeypatch.setattr(
        surface,
        "rotate_home_hero_rows",
        lambda rows, **_: list(reversed(rows)),
    )

    rotated = surface._rotate_home_hero_payload(7, payload)

    assert rotated["hero_surfaces"]["desktop"]["mode"] == "canonical"
    assert [
        artist["name"] for artist in rotated["hero_surfaces"]["desktop"]["artists"]
    ] == ["Two", "One"]
    assert rotated["hero_surfaces"]["mobile"]["mode"] == "canonical"
