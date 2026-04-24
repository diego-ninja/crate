"""Add read-model tables and snapshot infrastructure.

Revision ID: 013
Revises: 012
"""

from typing import Sequence, Union

from alembic import op


revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ui_snapshots (
            scope TEXT NOT NULL,
            subject_key TEXT NOT NULL DEFAULT 'global',
            version BIGINT NOT NULL DEFAULT 1,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            source_seq BIGINT,
            generation_ms INTEGER NOT NULL DEFAULT 0,
            stale_after TIMESTAMPTZ,
            PRIMARY KEY (scope, subject_key)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ui_snapshots_scope_built_at
        ON ui_snapshots (scope, built_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ui_snapshots_stale_after
        ON ui_snapshots (stale_after)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS domain_events (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            scope TEXT,
            subject_key TEXT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            processed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_domain_events_unprocessed
        ON domain_events (processed_at, id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_domain_events_scope
        ON domain_events (scope, subject_key, id DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ops_runtime_state (
            key TEXT PRIMARY KEY,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS import_queue_items (
            id BIGSERIAL PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'filesystem',
            path TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (source, path)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_import_queue_items_status_updated
        ON import_queue_items (status, updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_import_queue_items_source_status
        ON import_queue_items (source, status, updated_at DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS track_processing_state (
            track_id INTEGER NOT NULL REFERENCES library_tracks(id) ON DELETE CASCADE,
            pipeline TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending',
            claimed_by TEXT,
            claimed_at TIMESTAMPTZ,
            attempts INTEGER NOT NULL DEFAULT 0,
            priority INTEGER NOT NULL DEFAULT 100,
            last_error TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            PRIMARY KEY (track_id, pipeline)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_processing_state_claim
        ON track_processing_state (pipeline, state, priority, claimed_at)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_processing_state_updated
        ON track_processing_state (pipeline, updated_at DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS track_analysis_features (
            track_id INTEGER PRIMARY KEY REFERENCES library_tracks(id) ON DELETE CASCADE,
            bpm DOUBLE PRECISION,
            audio_key TEXT,
            audio_scale TEXT,
            energy DOUBLE PRECISION,
            mood_json JSONB,
            danceability DOUBLE PRECISION,
            valence DOUBLE PRECISION,
            acousticness DOUBLE PRECISION,
            instrumentalness DOUBLE PRECISION,
            loudness DOUBLE PRECISION,
            dynamic_range DOUBLE PRECISION,
            spectral_complexity DOUBLE PRECISION,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_analysis_features_updated
        ON track_analysis_features (updated_at DESC)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS track_bliss_embeddings (
            track_id INTEGER PRIMARY KEY REFERENCES library_tracks(id) ON DELETE CASCADE,
            bliss_vector DOUBLE PRECISION[],
            bliss_embedding vector(20),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_bliss_embeddings_updated
        ON track_bliss_embeddings (updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_bliss_embeddings_hnsw
        ON track_bliss_embeddings
        USING hnsw (bliss_embedding vector_cosine_ops)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS track_popularity_features (
            track_id INTEGER PRIMARY KEY REFERENCES library_tracks(id) ON DELETE CASCADE,
            lastfm_listeners INTEGER,
            lastfm_playcount BIGINT,
            popularity INTEGER,
            popularity_score DOUBLE PRECISION,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_track_popularity_features_score
        ON track_popularity_features (popularity_score DESC, popularity DESC, updated_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS track_popularity_features")
    op.execute("DROP TABLE IF EXISTS track_bliss_embeddings")
    op.execute("DROP TABLE IF EXISTS track_analysis_features")
    op.execute("DROP TABLE IF EXISTS track_processing_state")
    op.execute("DROP TABLE IF EXISTS import_queue_items")
    op.execute("DROP TABLE IF EXISTS ops_runtime_state")
    op.execute("DROP TABLE IF EXISTS domain_events")
    op.execute("DROP TABLE IF EXISTS ui_snapshots")
