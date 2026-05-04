from unittest.mock import patch

from crate.genre_taxonomy import (
    _are_genres_distant,
    choose_mix_seed_genres,
    expand_genre_terms_with_aliases,
    get_genre_description,
    get_genre_display_name,
    get_related_genre_terms,
    get_top_level_slug,
    resolve_genre_eq_preset,
    summarize_taste_genres,
)
from crate.genre_taxonomy_inference import infer_canonical_genre


def test_summarize_taste_genres_normalizes_aliases() -> None:
    rows = [
        {"genre_name": "Trash Metal", "play_count": 8, "complete_play_count": 5, "minutes_listened": 220},
        {"genre_name": "thrash metal", "play_count": 4, "complete_play_count": 2, "minutes_listened": 90},
        {"genre_name": "Hardcore", "play_count": 6, "complete_play_count": 4, "minutes_listened": 150},
    ]

    genres = summarize_taste_genres(rows, limit=4)

    assert "thrash metal" in genres
    assert "hardcore punk" in genres
    assert "trash metal" not in genres


def test_choose_mix_seed_genres_prefers_one_seed_per_family_first() -> None:
    rows = [
        {"genre_name": "thrash metal", "play_count": 9, "complete_play_count": 7, "minutes_listened": 300},
        {"genre_name": "doom metal", "play_count": 8, "complete_play_count": 6, "minutes_listened": 260},
        {"genre_name": "hardcore punk", "play_count": 7, "complete_play_count": 5, "minutes_listened": 210},
        {"genre_name": "shoegaze", "play_count": 6, "complete_play_count": 4, "minutes_listened": 180},
    ]

    seeds = choose_mix_seed_genres(rows, limit=3)

    assert [seed["slug"] for seed in seeds] == ["thrash-metal", "hardcore-punk", "shoegaze"]
    assert [get_top_level_slug(seed["slug"]) for seed in seeds] == ["metal", "punk", "alternative"]


def test_related_genre_terms_expand_a_scene() -> None:
    terms = get_related_genre_terms("hardcore punk", limit=12, max_depth=2)

    assert "hardcore punk" in terms
    assert "beatdown hardcore" in terms
    assert "melodic hardcore" in terms
    assert "post-hardcore" in terms
    assert "crust punk" in terms


def test_display_names_and_descriptions_stay_lowercase() -> None:
    assert get_genre_display_name("Trash Metal") == "thrash metal"
    assert get_genre_display_name("alternative-rock") == "alternative"
    assert get_genre_display_name("Post-Hardcore") == "post-hardcore"
    assert get_top_level_slug("beatdown-hardcore") == "punk"
    assert get_genre_description("hardcore") == get_genre_description("hardcore punk")
    assert get_genre_description("thrash metal").islower()


def test_blues_and_jazz_are_separate_top_level_genres() -> None:
    assert get_top_level_slug("blues") == "blues"
    assert get_top_level_slug("jazz") == "jazz"
    assert get_genre_display_name("blues") == "blues"
    assert get_genre_display_name("jazz") == "jazz"


def test_country_and_folk_are_separate_top_level_genres() -> None:
    assert get_top_level_slug("country") == "country"
    assert get_top_level_slug("folk") == "folk"


def test_classical_is_not_alias_of_ambient() -> None:
    assert get_top_level_slug("classical") == "classical"
    assert get_top_level_slug("ambient") == "ambient"
    assert get_genre_display_name("classical") == "classical"


def test_funk_is_child_of_soul() -> None:
    assert get_top_level_slug("funk") == "soul"
    assert get_genre_display_name("funk") == "funk"


def test_choose_mix_seeds_allows_distant_siblings_from_same_family() -> None:
    rows = [
        {"genre_name": "thrash metal", "play_count": 10, "complete_play_count": 8, "minutes_listened": 350},
        {"genre_name": "doom metal", "play_count": 9, "complete_play_count": 7, "minutes_listened": 300},
        {"genre_name": "hardcore punk", "play_count": 7, "complete_play_count": 5, "minutes_listened": 210},
        {"genre_name": "shoegaze", "play_count": 5, "complete_play_count": 3, "minutes_listened": 150},
    ]

    seeds = choose_mix_seed_genres(rows, limit=4)
    slugs = [s["slug"] for s in seeds]

    # thrash and doom are both metal but distant — both should appear
    assert "thrash-metal" in slugs
    assert "doom-metal" in slugs
    assert "hardcore-punk" in slugs
    assert "shoegaze" in slugs


def test_genre_distance_check() -> None:
    # Thrash and doom are ≥2 hops apart (thrash→metal←doom, no direct edge)
    assert _are_genres_distant("thrash-metal", "doom-metal", min_hops=2)
    # Thrash and speed-metal are directly related (1 hop)
    assert not _are_genres_distant("thrash-metal", "speed-metal", min_hops=2)
    # Same genre is never distant
    assert not _are_genres_distant("thrash-metal", "thrash-metal")


def test_expand_genre_terms_includes_aliases() -> None:
    expanded = expand_genre_terms_with_aliases(["hardcore punk"])

    assert "hardcore punk" in expanded
    assert "hardcore" in expanded
    assert "hc" in expanded


def test_related_terms_depth_1_is_more_focused() -> None:
    terms_deep = get_related_genre_terms("hardcore punk", limit=20, max_depth=2)
    terms_shallow = get_related_genre_terms("hardcore punk", limit=20, max_depth=1)

    # Depth 1 should have fewer terms
    assert len(terms_shallow) <= len(terms_deep)
    # Depth 1 should still include direct neighbors
    assert "hardcore punk" in terms_shallow
    assert "metalcore" in terms_shallow or "crust punk" in terms_shallow


def test_infer_canonical_genre_prefers_specific_match_from_name() -> None:
    proposal = infer_canonical_genre(
        "Occult Doom Metal",
        cooccurring={"doom-metal": 6.0, "stoner-metal": 2.0},
        external={"doom-metal": 2.5},
        aggressive=True,
    )

    assert proposal is not None
    assert proposal["canonical_slug"] == "doom-metal"
    assert proposal["mode"] in {"specific", "direct"}


def test_infer_canonical_genre_falls_back_to_family_when_needed() -> None:
    proposal = infer_canonical_genre(
        "Warehouse Tech",
        cooccurring={"techno": 3.5, "house": 2.0, "electronic": 1.5},
        external={"techno": 1.4},
        aggressive=True,
    )

    assert proposal is not None
    assert proposal["canonical_slug"] in {"techno", "house", "electronic"}


def test_infer_canonical_genre_prefers_specific_runtime_child_over_generic_family() -> None:
    import crate.genre_taxonomy as genre_taxonomy

    genre_taxonomy.invalidate_runtime_taxonomy_cache()
    with patch(
        "crate.db.queries.genre_taxonomy.get_runtime_taxonomy_rows",
        return_value=(
            [
                {
                    "slug": "instrumental-rock",
                    "name": "instrumental rock",
                    "description": "instrumental rock variant",
                    "is_top_level": False,
                    "eq_gains": None,
                }
            ],
            [
                {
                    "alias_slug": "instrumental-rock",
                    "alias_name": "instrumental rock",
                    "canonical_slug": "instrumental-rock",
                }
            ],
            [
                {
                    "source_slug": "instrumental-rock",
                    "target_slug": "rock",
                    "relation_type": "parent",
                }
            ],
        ),
    ):
        proposal = infer_canonical_genre(
            "instrumental",
            cooccurring={"rock": 5.0},
            aggressive=True,
        )

    assert proposal is not None
    assert proposal["canonical_slug"] == "instrumental-rock"
    assert proposal["mode"] == "specific"

    genre_taxonomy.invalidate_runtime_taxonomy_cache()


# ── resolve_genre_eq_preset ─────────────────────────────────────────


def test_resolve_eq_preset_direct_hit() -> None:
    preset = resolve_genre_eq_preset("black-metal")
    assert preset is not None
    assert preset["source"] == "direct"
    assert preset["slug"] == "black-metal"
    assert preset["gains"] == [-1.0, 3.0, 4.0, 1.0, -3.0, -2.0, 3.0, 6.0, 6.0, 4.0]


def test_resolve_eq_preset_inherits_from_parent_when_null() -> None:
    # crossover-thrash has no direct preset → parent is "metal" (_EQ_THRASH)
    preset = resolve_genre_eq_preset("crossover-thrash")
    assert preset is not None
    assert preset["source"] == "inherited"
    assert preset["slug"] == "metal"
    assert preset["gains"] == [3.0, 5.0, 4.0, 0.0, -4.0, -3.0, 2.0, 5.0, 6.0, 5.0]


def test_resolve_eq_preset_inherits_multi_level() -> None:
    # beatdown-hardcore has no preset; parent hardcore-punk DOES have one.
    preset = resolve_genre_eq_preset("beatdown-hardcore")
    assert preset is not None
    assert preset["source"] == "inherited"
    assert preset["slug"] == "hardcore-punk"


def test_resolve_eq_preset_inherits_through_alternative() -> None:
    # gothic-rock → parent alternative (has _EQ_ROCK)
    preset = resolve_genre_eq_preset("gothic-rock")
    assert preset is not None
    assert preset["source"] == "inherited"
    assert preset["slug"] == "alternative"


def test_resolve_eq_preset_accepts_raw_tag() -> None:
    # Alias resolution should work through resolve_genre_slug.
    preset = resolve_genre_eq_preset("Black Metal")
    assert preset is not None
    assert preset["slug"] == "black-metal"


def test_resolve_eq_preset_returns_none_for_unknown_genre() -> None:
    assert resolve_genre_eq_preset("experimental vaporbreakcore") is None


def test_resolve_eq_preset_returns_none_for_empty_value() -> None:
    assert resolve_genre_eq_preset("") is None
    assert resolve_genre_eq_preset("   ") is None


def test_runtime_taxonomy_overlay_uses_db_query_helper() -> None:
    import crate.genre_taxonomy as genre_taxonomy

    genre_taxonomy.invalidate_runtime_taxonomy_cache()
    with patch(
        "crate.db.queries.genre_taxonomy.get_runtime_taxonomy_rows",
        return_value=(
            [
                {
                    "slug": "warehouse-techno",
                    "name": "warehouse techno",
                    "description": "raw warehouse variant",
                    "is_top_level": False,
                    "eq_gains": None,
                }
            ],
            [
                {
                    "alias_slug": "warehouse-tech",
                    "alias_name": "warehouse tech",
                    "canonical_slug": "warehouse-techno",
                }
            ],
            [
                {
                    "source_slug": "warehouse-techno",
                    "target_slug": "techno",
                    "relation_type": "parent",
                }
            ],
        ),
    ):
        assert genre_taxonomy.resolve_genre_slug("warehouse tech") == "warehouse-techno"
        assert genre_taxonomy.get_top_level_slug("warehouse tech") == "electronic"

    genre_taxonomy.invalidate_runtime_taxonomy_cache()
