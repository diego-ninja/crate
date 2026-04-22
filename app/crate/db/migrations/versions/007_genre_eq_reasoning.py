"""Add eq_reasoning to genre_taxonomy_nodes.

Revision ID: 007
Revises: 006
Create Date: 2026-04-22
"""

from typing import Sequence, Union

from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE genre_taxonomy_nodes ADD COLUMN IF NOT EXISTS eq_reasoning TEXT DEFAULT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE genre_taxonomy_nodes DROP COLUMN IF EXISTS eq_reasoning")
