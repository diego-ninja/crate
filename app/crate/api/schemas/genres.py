"""Schema models for genre endpoints."""

from typing import Any

from pydantic import BaseModel, ConfigDict


class GenreArtistRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist_name: str
    artist_id: int | None = None
    artist_slug: str | None = None
    weight: float | None = None
    source: str | None = None
    album_count: int | None = None
    track_count: int | None = None
    has_photo: bool | int | None = None
    spotify_popularity: int | None = None
    listeners: int | None = None


class GenreAlbumRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    album_id: int
    album_slug: str | None = None
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    name: str
    year: str | None = None
    track_count: int | None = None
    has_cover: bool | int | None = None
    weight: float | None = None


class GenreSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
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
    eq_gains: list[float] | None = None
    eq_preset_resolved: dict[str, Any] | None = None


class GenreDetailResponse(GenreSummaryResponse):
    artists: list[GenreArtistRef] = []
    albums: list[GenreAlbumRef] = []


class GenreGraphNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    slug: str
    label: str
    kind: str
    mapped: bool
    artist_count: int = 0
    album_count: int = 0
    description: str | None = None
    page_slug: str | None = None
    is_center: bool = False
    is_top_level: bool = False
    canonical_slug: str | None = None


class GenreGraphLink(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    target: str
    relation_type: str
    weight: float | int | None = None


class GenreGraphResponse(BaseModel):
    nodes: list[GenreGraphNode]
    links: list[GenreGraphLink]
    mapping: GenreSummaryResponse


class EqPresetUpdateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    slug: str
    eq_gains: list[float] | None = None
    eq_preset_resolved: dict[str, Any] | None = None
