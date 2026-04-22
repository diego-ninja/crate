"""Add high-confidence performance indexes and remove exact duplicates.

Revision ID: 010
Revises: 009
Create Date: 2026-04-23
"""

from typing import Sequence, Union

from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATE_INDEXES = [
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_artists_lower_name ON library_artists (LOWER(name))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_albums_lower_artist ON library_albums (LOWER(artist))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_albums_lower_artist_lower_name ON library_albums (LOWER(artist), LOWER(name))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_albums_lower_artist_id ON library_albums (LOWER(artist), id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lib_tracks_lower_artist_lower_title ON library_tracks (LOWER(artist), LOWER(title))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_artist_genres_artist_weight ON artist_genres (artist_name, weight DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_album_genres_album_weight ON album_genres (album_id, weight DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shows_date_lower_artist ON shows (date, LOWER(artist_name))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shows_date_lower_city ON shows (date, LOWER(city))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shows_date_lower_country ON shows (date, LOWER(country_code))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shows_lower_city_id ON shows (LOWER(city), id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_play_history_played_at_desc ON play_history (played_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_liked_tracks_user_created ON user_liked_tracks (user_id, created_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_saved_albums_user_created ON user_saved_albums (user_id, created_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_radio_feedback_user_created ON radio_feedback (user_id, created_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_active_seen ON sessions (user_id, COALESCE(last_seen_at, created_at) DESC) WHERE revoked_at IS NULL",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_similarities_lower_artist ON artist_similarities (LOWER(artist_name))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_similarities_lower_similar ON artist_similarities (LOWER(similar_name))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_releases_status_release_detected ON new_releases (status, release_date DESC, detected_at DESC)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_new_releases_lower_artist_lower_album ON new_releases (LOWER(artist_name), LOWER(album_title))",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playlists_user_id ON playlists (user_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playlists_managed_by_user_id ON playlists (managed_by_user_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scan_results_task_id ON scan_results (task_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_favorites_user_id ON favorites (user_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_saved_albums_album_id ON user_saved_albums (album_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_liked_tracks_track_id ON user_liked_tracks (track_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_show_reminders_show_id ON user_show_reminders (show_id)",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_track_stats_track_id ON user_track_stats (track_id)",
]

DROP_DUPLICATE_INDEXES = [
    "DROP INDEX CONCURRENTLY IF EXISTS idx_albums_artist_name",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_tracks_album_id",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_users_email",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_users_google_id",
    "DROP INDEX CONCURRENTLY IF EXISTS idx_playlist_members_composite",
]


def _run_concurrently(statement: str) -> None:
    with op.get_context().autocommit_block():
        op.execute(statement)


def upgrade() -> None:
    for statement in CREATE_INDEXES:
        _run_concurrently(statement)
    for statement in DROP_DUPLICATE_INDEXES:
        _run_concurrently(statement)


def downgrade() -> None:
    for statement in reversed(DROP_DUPLICATE_INDEXES):
        if "idx_albums_artist_name" in statement:
            _run_concurrently("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_albums_artist_name ON library_albums (artist, name)")
        elif "idx_tracks_album_id" in statement:
            _run_concurrently("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracks_album_id ON library_tracks (album_id)")
        elif "idx_users_email" in statement:
            _run_concurrently("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email)")
        elif "idx_users_google_id" in statement:
            _run_concurrently("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_google_id ON users (google_id)")
        elif "idx_playlist_members_composite" in statement:
            _run_concurrently("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playlist_members_composite ON playlist_members (playlist_id, user_id)")

    for statement in reversed(CREATE_INDEXES):
        index_name = statement.split("IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0]
        _run_concurrently(f"DROP INDEX CONCURRENTLY IF EXISTS {index_name}")
