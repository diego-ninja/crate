"""Library and catalog schema bootstrap section."""

from crate.db.schema_sections.library_catalog import create_library_catalog_schema
from crate.db.schema_sections.library_genres import create_library_genres_schema
from crate.db.schema_sections.library_identity import create_library_identity_schema
from crate.db.schema_sections.library_similarity import create_library_similarity_schema


def create_library_schema(cur) -> None:
    create_library_catalog_schema(cur)
    create_library_genres_schema(cur)
    create_library_identity_schema(cur)
    create_library_similarity_schema(cur)


__all__ = ["create_library_schema"]
