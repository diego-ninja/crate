"""Idempotent schema bootstrap for fresh installs and bridge upgrades."""

from crate.db.schema_sections import (
    create_acquisition_schema,
    create_activity_schema,
    create_auth_schema,
    create_core_schema,
    create_curation_schema,
    create_library_schema,
)


def create_schema(cur):
    """Define the final schema shape for every table.

    New installs get all columns from the start. Existing installs that already
    have the tables will get missing columns added via the legacy bridge
    migrations and then Alembic-managed revisions.
    """

    cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    cur.execute("CREATE SEQUENCE IF NOT EXISTS library_artists_id_seq")

    create_core_schema(cur)
    create_auth_schema(cur)
    create_library_schema(cur)
    create_acquisition_schema(cur)
    create_curation_schema(cur)
    create_activity_schema(cur)
