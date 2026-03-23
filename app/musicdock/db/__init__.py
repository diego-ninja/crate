"""Database package — re-exports all functions for backward compatibility.

The monolithic db.py has been split into modules:
  core.py     — connection pool, get_db_ctx, init_db
  tasks.py    — task CRUD, scan results
  cache.py    — settings, mb_cache, generic cache, dir_mtimes
  library.py  — artists, albums, tracks (upsert, delete, stats, enrichment)
  auth.py     — users, sessions
  playlists.py — playlists, playlist_tracks
  tidal.py    — tidal_downloads, monitored_artists
  genres.py   — genres, artist_genres, album_genres
  audit.py    — audit_log, wipe, table stats

All functions are re-exported here so existing imports like
`from musicdock.db import get_db_ctx, create_task` continue to work.
"""

# Core (pool, context, schema)
from musicdock.db.core import (
    get_db, get_db_ctx, init_db,
)

# Tasks
from musicdock.db.tasks import (
    create_task, update_task, get_task, list_tasks, claim_next_task,
    save_scan_result, get_latest_scan,
)

# Cache & Settings
from musicdock.db.cache import (
    get_setting, set_setting,
    get_mb_cache, set_mb_cache,
    get_cache, set_cache, delete_cache,
    get_dir_mtime, set_dir_mtime, get_all_dir_mtimes, delete_dir_mtime,
)

# Library
from musicdock.db.library import (
    get_library_artists, get_library_artist, get_library_albums,
    get_library_album, get_library_tracks, get_library_stats,
    get_library_track_count,
    upsert_artist, upsert_album, upsert_track,
    update_track_audiomuse, update_artist_enrichment,
    delete_artist, delete_album, delete_track,
)

# Auth
from musicdock.db.auth import (
    create_user, get_user_by_email, get_user_by_google_id,
    get_user_by_id, update_user_last_login, list_users, delete_user,
    create_session, get_session, delete_session,
)

# Playlists
from musicdock.db.playlists import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    remove_playlist_track, reorder_playlist,
)

# Tidal
from musicdock.db.tidal import (
    add_tidal_download, get_tidal_downloads, update_tidal_download,
    delete_tidal_download, get_next_queued_download,
    set_monitored_artist, get_monitored_artists, is_artist_monitored,
)

# Genres
from musicdock.db.genres import (
    get_or_create_genre, set_artist_genres, set_album_genres,
    get_all_genres, get_genre_detail,
)

# Audit & Management
from musicdock.db.audit import (
    log_audit, get_audit_log, wipe_library_tables, get_db_table_stats,
)
