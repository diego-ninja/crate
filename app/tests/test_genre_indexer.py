from crate.genre_indexer import derive_album_genres


def _to_map(genres: list[tuple[str, float, str]]) -> dict[str, tuple[float, str]]:
    return {name: (weight, source) for name, weight, source in genres}


def test_derive_album_genres_weights_album_and_track_signals() -> None:
    genres = derive_album_genres(
        "post-hardcore, screamo",
        [
            "post-hardcore",
            "post-hardcore, hardcore",
            "hardcore",
        ],
    )

    as_map = _to_map(genres)

    assert list(as_map)[:3] == ["post-hardcore", "hardcore", "screamo"]
    assert as_map["post-hardcore"][1] == "tags"
    assert as_map["hardcore"][1] == "tags"
    assert as_map["screamo"][1] == "tags"
    assert round(sum(weight for weight, _source in as_map.values()), 4) == 1.0
    assert as_map["post-hardcore"][0] > as_map["hardcore"][0]
    assert as_map["hardcore"][0] == as_map["screamo"][0]


def test_derive_album_genres_uses_artist_profile_as_fallback() -> None:
    genres = derive_album_genres(
        None,
        [],
        artist_profile=[
            {"name": "metalcore", "weight": 1.0},
            {"name": "hardcore", "weight": 0.6},
            {"name": "screamo", "weight": 0.4},
        ],
    )

    as_map = _to_map(genres)

    assert list(as_map)[:3] == ["metalcore", "hardcore", "screamo"]
    assert all(source == "artist_fallback" for _weight, source in as_map.values())
    assert round(sum(weight for weight, _source in as_map.values()), 4) == 1.0
    assert as_map["metalcore"][0] > as_map["hardcore"][0] > as_map["screamo"][0]


def test_derive_album_genres_supports_semicolon_separated_tags() -> None:
    genres = derive_album_genres(
        "post-hardcore; screamo",
        ["post-hardcore; metalcore"],
    )

    as_map = _to_map(genres)
    assert list(as_map)[:3] == ["post-hardcore", "screamo", "metalcore"]
    assert as_map["post-hardcore"][0] > as_map["screamo"][0] > as_map["metalcore"][0]
