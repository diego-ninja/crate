from crate.genre_taxonomy import (
    _are_genres_distant,
    choose_mix_seed_genres,
    expand_genre_terms_with_aliases,
    get_genre_description,
    get_genre_display_name,
    get_related_genre_terms,
    get_top_level_slug,
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
