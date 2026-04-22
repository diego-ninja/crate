"""Add playlist generation metadata and history.

Revision ID: 003
Revises: 002
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Generation metadata on playlists
    for col, typedef in [
        ("last_generated_at", "TIMESTAMPTZ"),
        ("generation_status", "TEXT NOT NULL DEFAULT 'idle'"),
        ("generation_error", "TEXT"),
        ("auto_refresh_enabled", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ]:
        op.execute(f"""
            DO $$ BEGIN
                ALTER TABLE playlists ADD COLUMN {col} {typedef};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        """)

    # Generation history log
    op.execute("""
        CREATE TABLE IF NOT EXISTS playlist_generation_log (
            id SERIAL PRIMARY KEY,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ,
            status TEXT NOT NULL DEFAULT 'running',
            rule_snapshot_json JSONB,
            track_count INTEGER,
            duration_sec INTEGER,
            error TEXT,
            triggered_by TEXT DEFAULT 'manual'
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_playlist_gen_log
        ON playlist_generation_log(playlist_id, started_at DESC)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS playlist_generation_log")
    for col in ["auto_refresh_enabled", "generation_error", "generation_status", "last_generated_at"]:
        op.execute(f"ALTER TABLE playlists DROP COLUMN IF EXISTS {col}")
