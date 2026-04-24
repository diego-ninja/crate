"""Composable schema bootstrap sections."""

from crate.db.schema_sections.acquisition import create_acquisition_schema
from crate.db.schema_sections.activity import create_activity_schema
from crate.db.schema_sections.auth import create_auth_schema
from crate.db.schema_sections.core import create_core_schema
from crate.db.schema_sections.curation import create_curation_schema
from crate.db.schema_sections.library import create_library_schema

__all__ = [
    "create_acquisition_schema",
    "create_activity_schema",
    "create_auth_schema",
    "create_core_schema",
    "create_curation_schema",
    "create_library_schema",
]
