"""Keep complete artist-hero manifests for safe rollback."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "093"
down_revision = "092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("artist_hero_manifest_history"):
        return

    op.create_table(
        "artist_hero_manifest_history",
        sa.Column("manifest_id", sa.Text(), nullable=False),
        sa.Column(
            "artist_id",
            sa.BIGINT(),
            sa.ForeignKey("library_artists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("editorial_revision", sa.Text(), nullable=False),
        sa.Column("manifest", postgresql.JSONB(), nullable=False),
        sa.Column("previous_manifest", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint("manifest_id", name="pk_artist_hero_manifest_history"),
    )
    op.create_index(
        "idx_artist_hero_manifest_history_artist",
        "artist_hero_manifest_history",
        ["artist_id", "created_at"],
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("artist_hero_manifest_history"):
        op.drop_index(
            "idx_artist_hero_manifest_history_artist",
            table_name="artist_hero_manifest_history",
        )
        op.drop_table("artist_hero_manifest_history")
