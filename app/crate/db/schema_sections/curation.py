"""Curation and collaborative surfaces schema bootstrap section."""

from crate.db.schema_sections.curation_favorites import create_favorites_schema
from crate.db.schema_sections.curation_playlists import create_playlist_schema
from crate.db.schema_sections.curation_social import create_curation_social_schema


def create_curation_schema(cur) -> None:
    create_playlist_schema(cur)
    create_curation_social_schema(cur)
    create_favorites_schema(cur)
