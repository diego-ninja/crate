"""Typed models for genre-related data.

Covers the ``genres`` table and the enriched detail shape returned by
``get_genre_detail()`` / ``get_all_genres()`` in ``db/genres.py``.
"""


from typing import Any

from pydantic import BaseModel, ConfigDict


class GenreRow(BaseModel):
    """Canonical genre record from the ``genres`` table with aggregated counts.

    Matches the dict shape returned by ``get_all_genres()`` after annotation.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_uid: str | None = None
    name: str
    slug: str
    artist_count: int = 0
    album_count: int = 0

    # Taxonomy mapping (from genre_taxonomy_nodes via aliases)
    mapped: bool = False
    canonical_slug: str | None = None
    canonical_name: str | None = None
    canonical_description: str | None = None
    top_level_slug: str | None = None
    top_level_name: str | None = None
    top_level_description: str | None = None
    description: str | None = None
    external_description: str | None = None
    external_description_source: str | None = None
    musicbrainz_mbid: str | None = None
    wikidata_entity_id: str | None = None
    wikidata_url: str | None = None


class GenreDetail(BaseModel):
    """Full genre detail as returned by ``get_genre_detail()``.

    Extends ``GenreRow`` with lists of associated artists and albums.
    """
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_uid: str | None = None
    name: str
    slug: str
    artist_count: int = 0
    album_count: int = 0

    mapped: bool = False
    canonical_slug: str | None = None
    canonical_name: str | None = None
    canonical_description: str | None = None
    top_level_slug: str | None = None
    top_level_name: str | None = None
    top_level_description: str | None = None
    description: str | None = None
    external_description: str | None = None
    external_description_source: str | None = None
    musicbrainz_mbid: str | None = None
    wikidata_entity_id: str | None = None
    wikidata_url: str | None = None

    # EQ preset
    eq_gains: list[float] | None = None
    eq_preset_resolved: dict[str, Any] | None = None

    # Related entities
    artists: list[dict[str, Any]] = []
    albums: list[dict[str, Any]] = []
