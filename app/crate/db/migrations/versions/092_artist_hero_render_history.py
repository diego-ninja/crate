"""Keep durable metadata for immutable artist-hero render revisions."""

from alembic import op
import sqlalchemy as sa


revision = "092"
down_revision = "091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("artist_hero_render_revisions"):
        return

    op.create_table(
        "artist_hero_render_revisions",
        sa.Column(
            "artist_id",
            sa.BIGINT(),
            sa.ForeignKey("library_artists.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("composition", sa.Text(), nullable=False),
        sa.Column("render_revision", sa.Text(), nullable=False),
        sa.Column("editorial_revision", sa.Text(), nullable=False),
        sa.Column("renderer_version", sa.Text(), nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("recipe_hash", sa.Text(), nullable=False),
        sa.Column("relative_path", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.PrimaryKeyConstraint(
            "artist_id",
            "composition",
            "render_revision",
            name="pk_artist_hero_render_revisions",
        ),
        sa.CheckConstraint(
            "composition IN ('desktop', 'mobile')",
            name="ck_artist_hero_render_revisions_composition",
        ),
    )
    op.create_index(
        "idx_artist_hero_render_revisions_order",
        "artist_hero_render_revisions",
        ["artist_id", "composition", "created_at"],
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("artist_hero_render_revisions"):
        op.drop_index(
            "idx_artist_hero_render_revisions_order",
            table_name="artist_hero_render_revisions",
        )
        op.drop_table("artist_hero_render_revisions")
