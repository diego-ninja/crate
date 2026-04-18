"""Baseline — establish Alembic tracking on existing databases.

This migration is intentionally a no-op. It exists so that:

  - Existing installs get stamped as "at head" without Alembic trying
    to create tables that already exist (those were created by the
    legacy ``_create_schema()`` + ``_run_migrations()`` flow in
    ``crate.db.core``).
  - New installs first run ``_create_schema()`` to create all tables
    in their final shape, then get stamped at this revision, so
    subsequent migrations apply cleanly.

All 29 legacy migrations from ``_MIGRATIONS`` in ``core.py`` are
subsumed by this baseline. The schema they produced is the starting
point for Alembic-tracked changes going forward.

Revision ID: 001
Revises: None
Create Date: 2026-04-17
"""
from typing import Sequence, Union

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No-op. The schema already exists via _create_schema() + legacy
    # migrations. This revision just establishes the Alembic baseline.
    pass


def downgrade() -> None:
    # Downgrading past baseline is not supported — the entire schema
    # would need to be dropped, which is a manual operation.
    raise RuntimeError(
        "Cannot downgrade past the baseline migration. "
        "Drop and recreate the database manually if needed."
    )
