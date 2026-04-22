"""music_paths table for acoustic route planning

Revision ID: 008
Revises: 007
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "008"
down_revision = "007"


def upgrade() -> None:
    op.create_table(
        "music_paths",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("origin_type", sa.Text, nullable=False),
        sa.Column("origin_value", sa.Text, nullable=False),
        sa.Column("origin_label", sa.Text),
        sa.Column("dest_type", sa.Text, nullable=False),
        sa.Column("dest_value", sa.Text, nullable=False),
        sa.Column("dest_label", sa.Text),
        sa.Column("waypoints", JSONB, server_default="[]"),
        sa.Column("step_count", sa.Integer, server_default="20"),
        sa.Column("tracks", JSONB, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_music_paths_user_id", "music_paths", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_music_paths_user_id")
    op.drop_table("music_paths")
