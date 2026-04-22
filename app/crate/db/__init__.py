"""Database package — frozen compatibility facade.

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

This module is kept stable so existing imports and external scripts do
not break, but new code should prefer direct imports from concrete
modules such as ``crate.db.tasks`` or ``crate.db.queries.health``.

In other words: this facade is compat, not the preferred growth path.
"""

# Core (pool, context, schema)
from crate.db.core import (
    get_db, get_db_ctx, init_db,
)

# Tasks
from crate.db.tasks import (
    create_task, create_task_dedup, update_task, get_task, list_tasks, claim_next_task,
    list_child_tasks, heartbeat_task, cleanup_zombie_tasks, cleanup_orphaned_tasks,
    save_scan_result, get_latest_scan, check_siblings_complete,
    delete_tasks_by_status, delete_old_finished_tasks,
)

# Cache & Settings
from crate.db.cache import (
    get_setting, set_setting,
    get_mb_cache, set_mb_cache,
    get_cache, set_cache, delete_cache, delete_cache_prefix, get_cache_stats,
    get_dir_mtime, set_dir_mtime, get_all_dir_mtimes, delete_dir_mtime,
    clear_all_cache_tables,
)

# Library
from crate.db.library import (
    get_library_artists, get_library_artist, get_library_albums,
    get_library_artist_by_id, get_library_album,
    get_library_album_by_id, get_library_track_by_id, get_library_track_by_storage_id, get_library_track_by_path,
    quarantine_album, unquarantine_album, delete_quarantined_album,
    get_library_tracks_by_storage_ids,
    get_library_tracks, get_library_stats, get_album_quality_map,
    get_library_track_count,
    upsert_artist, upsert_album, upsert_track,
    update_track_analysis, update_artist_enrichment,
    delete_artist, delete_album, delete_track,
    set_track_rating, get_track_rating, update_artist_has_photo,
    get_track_path_by_id, get_artist_analysis_tracks,
    get_artist_refs_by_names, get_artist_tracks_for_setlist,
    find_user_playlist_by_name,
    get_albums_missing_covers,
    get_release_by_id,
    enrich_track_refs,
)

# Auth
from crate.db.auth import (
    count_users, create_user, get_user_by_email, get_user_by_google_id,
    get_user_by_external_identity, get_user_by_id, update_user_last_login, update_user, list_users, delete_user,
    create_session, get_session, list_sessions, touch_session, revoke_session, revoke_other_sessions, delete_session,
    get_user_presence, get_users_presence, list_users_map_rows,
    suggest_username, get_user_external_identity, upsert_user_external_identity,
    list_user_external_identities, unlink_user_external_identity,
    create_auth_invite, get_auth_invite, list_auth_invites, consume_auth_invite,
    cleanup_expired_sessions, cleanup_ended_jam_rooms,
)

# Playlists
from crate.db.playlists import (
    create_playlist, get_playlists, get_playlist, update_playlist,
    delete_playlist, get_playlist_tracks, add_playlist_tracks,
    replace_playlist_tracks,
    remove_playlist_track, reorder_playlist,
    list_system_playlists, is_playlist_followed, follow_playlist,
    unfollow_playlist, get_playlist_followers_count, get_followed_system_playlists,
    get_playlist_members, get_playlist_member,
    can_view_playlist, can_edit_playlist, is_playlist_owner,
    add_playlist_member, remove_playlist_member,
    create_playlist_invite, consume_playlist_invite,
    get_playlist_filter_options,
    execute_smart_rules,
    generate_by_genre, generate_by_decade, generate_by_artist,
    generate_similar_artists, generate_random,
    log_generation_start, log_generation_complete, log_generation_failed,
    get_generation_history, set_generation_status, get_smart_playlists_for_refresh,
    duplicate_playlist,
)

# Tidal
from crate.db.tidal import (
    add_tidal_download, get_tidal_downloads, get_tidal_download, update_tidal_download,
    delete_tidal_download, get_next_queued_download,
    set_monitored_artist, get_monitored_artists, is_artist_monitored,
)

# Genres
from crate.db.genres import (
    get_or_create_genre, set_artist_genres, set_album_genres,
    get_all_genres, get_genre_detail, get_genre_graph, get_unmapped_genres,
    get_artists_with_tags, get_albums_with_genres,
    get_artists_missing_genre_mapping, get_artist_album_genres,
    get_total_genre_count, list_unmapped_genres_for_inference,
    get_unmapped_genre_count, get_remaining_without_external_description,
    get_genre_seed_artists, get_genre_cooccurring_artist_slugs,
    get_genre_cooccurring_album_slugs,
    list_invalid_genre_taxonomy_nodes, cleanup_invalid_genre_taxonomy_nodes,
    list_genre_taxonomy_nodes_for_external_enrichment,
    list_genre_taxonomy_nodes_for_musicbrainz_sync,
    upsert_genre_taxonomy_edge,
    upsert_genre_taxonomy_node,
    update_genre_external_metadata,
    get_genre_taxonomy_node_id, set_genre_eq_gains,
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

# Serialization helpers
from crate.db.serialize import (
    serialize_row, serialize_rows,
)

# Home
from crate.db.home import (
    get_home_mix, get_home_playlist, get_home_discovery, get_home_section,
    get_home_hero, get_home_recently_played, get_home_mixes,
    get_home_suggested_albums, get_home_recommended_tracks,
    get_home_radio_stations, get_home_favorite_artists, get_home_essentials,
)

from crate.db.jam import (
    create_jam_room, get_jam_room, get_jam_room_members, get_jam_room_member,
    is_jam_room_member, upsert_jam_room_member, touch_jam_room_member,
    append_jam_room_event, list_jam_room_events, update_jam_room_state,
    create_jam_room_invite, consume_jam_room_invite,
)

# Management
from crate.db.management import (
    get_last_analyzed_track, get_last_bliss_track, get_storage_v2_status,
    count_recent_active_users, count_recent_streams,
    upsert_metric_rollup, query_metric_rollups,
)

# New Releases
from crate.db.releases import (
    upsert_new_release, get_new_releases, mark_release_downloading,
    mark_release_downloaded, mark_release_dismissed, is_album_in_library,
    cleanup_old_releases,
)

# Shows
from crate.db.shows import (
    upsert_show, consolidate_show, get_unique_user_cities,
    get_upcoming_shows, get_upcoming_shows_near, get_all_shows,
    get_show_cities, get_show_countries, delete_past_shows,
    attend_show, unattend_show, get_attending_show_ids,
    get_show_reminders, create_show_reminder,
    get_upcoming_show_counts,
)

# Task Events (SSE)
from crate.db.events import (
    emit_task_event, get_task_events, cleanup_task_events, cleanup_old_events,
    cleanup_orphan_events, cleanup_old_tasks,
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
    record_play, record_play_event, recompute_user_listening_aggregates, get_play_history, get_play_stats,
    get_stats_overview, get_stats_trends,
    get_top_tracks, get_top_artists, get_top_albums, get_top_genres,
    get_replay_mix,
    get_user_library_counts,
)

# Social
from crate.db.social import (
    follow_user, unfollow_user, get_relationship_state,
    get_followers, get_following, search_users,
    get_public_user_profile, get_public_user_profile_by_username,
    get_public_playlists_for_user, get_me_social, get_affinity,
)

# Worker logs
from crate.db.worker_logs import (
    insert_log, query_logs, list_known_workers, cleanup_old_logs,
)
