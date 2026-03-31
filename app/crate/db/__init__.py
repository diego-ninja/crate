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
`from crate.db import get_db_ctx, create_task` continue to work.
"""

# Core (pool, context, schema)
from crate.db.core import (
    get_db, get_db_ctx, init_db,
)

# Tasks
from crate.db.tasks import (
    create_task, create_task_dedup, update_task, get_task, list_tasks, claim_next_task,
    list_child_tasks, heartbeat_task, cleanup_zombie_tasks, cleanup_orphaned_tasks,
    save_scan_result, get_latest_scan,
)

# Cache & Settings
from crate.db.cache import (
    get_setting, set_setting,
    get_mb_cache, set_mb_cache,
    get_cache, set_cache, delete_cache, delete_cache_prefix, get_cache_stats,
    get_dir_mtime, set_dir_mtime, get_all_dir_mtimes, delete_dir_mtime,
)

# Library
from crate.db.library import (
    get_library_artists, get_library_artist, get_library_albums,
    get_library_album, get_library_tracks, get_library_stats,
    get_library_track_count,
    upsert_artist, upsert_album, upsert_track,
    update_track_audiomuse, update_artist_enrichment,
    delete_artist, delete_album, delete_track,
    set_track_rating, get_track_rating,
)

# Auth
from crate.db.auth import (
    create_user, get_user_by_email, get_user_by_google_id,
    get_user_by_id, update_user_last_login, update_user, list_users, delete_user,
    create_session, get_session, delete_session,
    suggest_username, get_user_external_identity, upsert_user_external_identity,
    unlink_user_external_identity,
)

# Playlists
from crate.db.playlists import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    remove_playlist_track, reorder_playlist,
    list_system_playlists, is_playlist_followed, follow_playlist,
    unfollow_playlist, get_playlist_followers_count, get_followed_system_playlists,
    set_playlist_navidrome_projection,
)

# Tidal
from crate.db.tidal import (
    add_tidal_download, get_tidal_downloads, update_tidal_download,
    delete_tidal_download, get_next_queued_download,
    set_monitored_artist, get_monitored_artists, is_artist_monitored,
)

# Genres
from crate.db.genres import (
    get_or_create_genre, set_artist_genres, set_album_genres,
    get_all_genres, get_genre_detail,
)

# Audit & Management
from crate.db.audit import (
    log_audit, get_audit_log, wipe_library_tables, get_db_table_stats,
)

# Health Issues
from crate.db.health import (
    upsert_health_issue, get_open_issues, get_issue_counts,
    resolve_issue, resolve_issues_by_type, dismiss_issue,
    resolve_stale_issues, cleanup_old_resolved,
    get_artist_issues, get_artist_issue_count, get_all_artist_issue_counts,
)

# New Releases
from crate.db.releases import (
    upsert_new_release, get_new_releases, mark_release_downloading,
    mark_release_downloaded, mark_release_dismissed, is_album_in_library,
)

# Shows
from crate.db.shows import (
    upsert_show, get_upcoming_shows, get_all_shows,
    get_show_cities, get_show_countries, delete_past_shows,
)

# Task Events (SSE)
from crate.db.events import (
    emit_task_event, get_task_events, cleanup_task_events, cleanup_old_events,
)

# Similarities
from crate.db.similarities import (
    upsert_similarity, bulk_upsert_similarities, get_similar_artists,
    get_artist_network, mark_library_status,
)

# User Library (personal: follows, saves, likes, history)
from crate.db.user_library import (
    follow_artist, unfollow_artist, get_followed_artists, is_following,
    save_album, unsave_album, get_saved_albums, is_album_saved,
    like_track, unlike_track, get_liked_tracks, is_track_liked,
    record_play, get_play_history, get_play_stats,
    get_user_library_counts,
)
