"""Add a nullable versioned render manifest to artist-hero profiles."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"] for column in inspector.get_columns("artist_hero_artwork")
    }
    if "render_manifest" not in existing:
        op.add_column(
            "artist_hero_artwork",
            sa.Column("render_manifest", postgresql.JSONB(), nullable=True),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {
        column["name"] for column in inspector.get_columns("artist_hero_artwork")
    }
    if "render_manifest" in existing:
        op.drop_column("artist_hero_artwork", "render_manifest")
