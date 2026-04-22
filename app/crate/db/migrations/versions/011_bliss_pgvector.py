"""Move bliss proximity onto pgvector embeddings.

Revision ID: 011
Revises: 010
"""

from alembic import op


revision = "011"
down_revision = "010"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("ALTER TABLE library_tracks ADD COLUMN IF NOT EXISTS bliss_embedding vector(20)")
    op.execute(
        """
        UPDATE library_tracks
        SET bliss_embedding = ('[' || array_to_string(bliss_vector, ',') || ']')::vector(20)
        WHERE bliss_vector IS NOT NULL
          AND array_length(bliss_vector, 1) = 20
          AND bliss_embedding IS NULL
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_tracks_bliss_embedding_hnsw
            ON library_tracks USING hnsw (bliss_embedding vector_l2_ops)
            WHERE bliss_embedding IS NOT NULL
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS idx_library_tracks_bliss_embedding_hnsw")
    op.execute("ALTER TABLE library_tracks DROP COLUMN IF EXISTS bliss_embedding")
