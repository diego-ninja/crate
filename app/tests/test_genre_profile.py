from crate.api.browse_shared import build_genre_profile


def test_build_genre_profile_percent_reflects_relative_strength_not_share() -> None:
    profile = build_genre_profile(
        [
            {"name": "hardcore", "weight": 1.0, "source": "enrichment"},
            {"name": "mathcore", "weight": 0.88, "source": "enrichment"},
            {"name": "metalcore", "weight": 0.76, "source": "enrichment"},
            {"name": "chaotic hardcore", "weight": 0.64, "source": "enrichment"},
            {"name": "noisecore", "weight": 0.52, "source": "enrichment"},
        ]
    )

    assert [item["name"] for item in profile] == [
        "hardcore",
        "mathcore",
        "metalcore",
        "chaotic hardcore",
        "noisecore",
    ]
    assert [item["percent"] for item in profile] == [100, 88, 76, 64, 52]
    assert round(sum(item["share"] for item in profile), 4) == 1.0


def test_build_genre_profile_keeps_equal_direct_tags_equal() -> None:
    profile = build_genre_profile(
        [
            {"name": "post-hardcore", "weight": 0.5, "source": "tags"},
            {"name": "screamo", "weight": 0.5, "source": "tags"},
        ]
    )

    assert [item["percent"] for item in profile] == [100, 100]
    assert [item["share"] for item in profile] == [0.5, 0.5]
