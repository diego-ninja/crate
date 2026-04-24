"""Baseline schema for Alembic-managed installs.

This revision now creates the full pre-Alembic baseline directly, so fresh
installs can be provisioned by Alembic alone. Later Alembic revisions
(``002+``) layer newer tables/columns on top.

Legacy in-app migrations are kept only as an optional compatibility bridge for
old private installs; they are no longer the normal runtime bootstrap path.

Revision ID: 001
Revises: None
Create Date: 2026-04-17
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from crate.db.schema_bootstrap import create_schema

    bind = op.get_bind()

    class _AlembicCursorAdapter:
        def __init__(self, connection):
            self._connection = connection

        def execute(self, statement: str) -> None:
            self._connection.execute(text(statement))

    create_schema(_AlembicCursorAdapter(bind))


def downgrade() -> None:
    # Downgrading past baseline is not supported — the entire schema
    # would need to be dropped, which is a manual operation.
    raise RuntimeError(
        "Cannot downgrade past the baseline migration. "
        "Drop and recreate the database manually if needed."
    )
