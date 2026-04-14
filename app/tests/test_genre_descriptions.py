from crate.genre_descriptions import (
    _extract_wikidata_entity_id,
    _genre_lookup_key,
    _is_low_value_description,
    _map_musicbrainz_relationships,
    _normalize_musicbrainz_relation_name,
    _parse_musicbrainz_genre_catalog,
    _parse_musicbrainz_genre_relationships,
    _pick_wikidata_description,
)


def test_extract_wikidata_entity_id_from_url() -> None:
    assert _extract_wikidata_entity_id("https://www.wikidata.org/wiki/Q1640319") == "Q1640319"
    assert _extract_wikidata_entity_id("wikidata:Q123") == "Q123"


def test_genre_lookup_key_collapses_hyphens_and_spacing() -> None:
    assert _genre_lookup_key("post-hardcore") == "post hardcore"
    assert _genre_lookup_key("post hardcore") == "post hardcore"
    assert _genre_lookup_key("Alternative/Rock") == "alternative rock"


def test_parse_musicbrainz_genre_catalog_supports_expected_shape() -> None:
    payload = {
        "genre-count": 2,
        "genres": [
            {"id": "a", "name": "hardcore punk"},
            {"id": "b", "name": "beatdown hardcore"},
        ],
    }

    parsed = _parse_musicbrainz_genre_catalog(payload)

    assert parsed == [
        {"mbid": "a", "name": "hardcore punk"},
        {"mbid": "b", "name": "beatdown hardcore"},
    ]


def test_pick_wikidata_description_prefers_requested_language_order() -> None:
    payload = {
        "entities": {
            "Q1": {
                "descriptions": {
                    "es": {"value": "subgénero del hardcore punk"},
                    "en": {"value": "subgenre of hardcore punk"},
                }
            }
        }
    }

    picked = _pick_wikidata_description(payload, ("en", "es"))

    assert picked == {"description": "subgenre of hardcore punk", "language": "en"}


def test_generic_wikidata_descriptions_are_filtered() -> None:
    assert _is_low_value_description("genre of music")
    assert not _is_low_value_description("subgenre of hardcore punk")


def test_parse_musicbrainz_genre_relationships_reads_multiple_sections() -> None:
    lines = [
        "Relationships",
        "subgenre of: punk",
        "subgenres: deathrock",
        "hardcore punk",
        "influenced by: garage rock",
        "rock and roll",
        "influenced genres: post-punk",
        "new wave",
        "has fusion genres: ska punk",
        "External links",
    ]

    relationships = _parse_musicbrainz_genre_relationships(lines)

    assert relationships == {
        "subgenre of": ["punk"],
        "subgenres": ["deathrock", "hardcore punk"],
        "influenced by": ["garage rock", "rock and roll"],
        "influenced genres": ["post-punk", "new wave"],
        "has fusion genres": ["ska punk"],
    }


def test_map_musicbrainz_relationships_uses_direction_expected_by_local_model() -> None:
    relationships = {
        "subgenre of": ["punk"],
        "subgenres": ["hardcore punk"],
        "influenced by": ["garage rock"],
        "influenced genres": ["post-punk"],
        "fusion of": ["ska", "punk"],
        "has fusion genres": ["ska punk"],
    }

    edges = _map_musicbrainz_relationships("punk rock", relationships)

    assert {"source_name": "punk rock", "target_name": "punk", "relation_type": "parent"} in edges
    assert {"source_name": "hardcore punk", "target_name": "punk rock", "relation_type": "parent"} in edges
    assert {"source_name": "punk rock", "target_name": "garage rock", "relation_type": "influenced_by"} in edges
    assert {"source_name": "post-punk", "target_name": "punk rock", "relation_type": "influenced_by"} in edges
    assert {"source_name": "punk rock", "target_name": "ska", "relation_type": "fusion_of"} in edges
    assert {"source_name": "ska punk", "target_name": "punk rock", "relation_type": "fusion_of"} in edges


def test_normalize_musicbrainz_relation_name_strips_parenthetical_notes() -> None:
    assert _normalize_musicbrainz_relation_name("beat rock (Japanese 1980s genre)") == "beat rock"
