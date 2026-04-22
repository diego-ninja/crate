"""Move bliss proximity onto pgvector embeddings.

Revision ID: 011
Revises: 010
"""

import os

import psycopg2
from alembic import op
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


revision = "011"
down_revision = "010"


def _ensure_vector_extension() -> None:
    bind = op.get_bind()
    exists = bind.execute(text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")).scalar()
    if exists:
        return

    su_user = os.environ.get("POSTGRES_SUPERUSER_USER") or os.environ.get("MUSICDOCK_POSTGRES_USER")
    su_pass = os.environ.get("POSTGRES_SUPERUSER_PASSWORD") or os.environ.get("MUSICDOCK_POSTGRES_PASSWORD")
    host = os.environ.get("CRATE_POSTGRES_HOST", "crate-postgres")
    port = os.environ.get("CRATE_POSTGRES_PORT", "5432")
    dbname = os.environ.get("CRATE_POSTGRES_DB", "crate")
    su_db = os.environ.get("POSTGRES_SUPERUSER_DB") or os.environ.get("MUSICDOCK_POSTGRES_DB") or dbname

    if su_user:
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=su_user,
            password=su_pass,
            dbname=su_db,
        )
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        finally:
            conn.close()
        return

    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    except DBAPIError as exc:
        raise RuntimeError(
            "pgvector extension is required for migration 011. "
            "Set POSTGRES_SUPERUSER_* env vars for the app/worker or pre-create "
            "the extension in the target database as a superuser."
        ) from exc


def upgrade() -> None:
    _ensure_vector_extension()
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
