"""Canonical task type labels and icons.

Single source of truth for human-readable task names. Used by API
responses, Telegram bot, and mirrored in the admin frontend.
"""

TASK_TYPE_LABELS: dict[str, str] = {
    # Library
    "library_sync": "Library Scan",
    "scan": "Health Check",
    "process_new_content": "Process New Content",
    "repair_library": "Library Repair",
    "delete_artist": "Artist Deletion",
    "delete_album": "Album Deletion",
    "migrate_storage": "Storage Migration",
    "migrate_storage_v2": "Storage Migration v2",
    # Enrichment
    "enrich_artists": "Artist Enrichment",
    "enrich_artist": "Artist Enrichment",
    "enrich_all": "Full Enrichment",
    # Analysis
    "audio_analysis": "Audio Analysis",
    "bliss_analysis": "Bliss Similarity",
    "analyze_batch": "Batch Analysis",
    # Tidal / Downloads
    "tidal_download": "Tidal Download",
    "soulseek_download": "Soulseek Download",
    # Genres
    "index_genres": "Genre Indexing",
    "infer_genre_taxonomy": "Taxonomy Inference",
    "enrich_genre_descriptions": "Genre Description Enrichment",
    "sync_genre_musicbrainz": "MusicBrainz Genre Sync",
    "cleanup_invalid_genre_taxonomy": "Taxonomy Cleanup",
    # Playlists
    "generate_smart_playlist": "Smart Playlist Generation",
    "generate_playlist": "Playlist Generation",
    # Popularity
    "update_popularity": "Popularity Update",
    "fetch_popularity": "Popularity Fetch",
    # Playlists
    "generate_system_playlist": "Playlist Generation",
    "refresh_system_smart_playlists": "Refresh Smart Playlists",
    "persist_playlist_cover": "Save Playlist Cover",
}

TASK_TYPE_ICONS: dict[str, str] = {
    "library_sync": "\U0001f4c2",
    "scan": "\U0001f50d",
    "process_new_content": "\u2728",
    "repair_library": "\U0001f527",
    "delete_artist": "\U0001f5d1",
    "delete_album": "\U0001f5d1",
    "migrate_storage": "\U0001f4e6",
    "migrate_storage_v2": "\U0001f4e6",
    "enrich_artists": "\U0001f50e",
    "enrich_artist": "\U0001f50e",
    "enrich_all": "\U0001f50e",
    "audio_analysis": "\U0001f3b5",
    "bliss_analysis": "\U0001f9ec",
    "analyze_batch": "\U0001f3b5",
    "tidal_download": "\U0001f4e5",
    "soulseek_download": "\U0001f4e5",
    "index_genres": "\U0001f3f7\ufe0f",
    "infer_genre_taxonomy": "\U0001f3f7\ufe0f",
    "enrich_genre_descriptions": "\U0001f4dd",
    "sync_genre_musicbrainz": "\U0001f310",
    "cleanup_invalid_genre_taxonomy": "\U0001f9f9",
    "generate_smart_playlist": "\U0001f3b6",
    "generate_playlist": "\U0001f3b6",
    "update_popularity": "\U0001f4ca",
    "fetch_popularity": "\U0001f4ca",
}


def task_label(task_type: str) -> str:
    """Human-readable label for a task type."""
    return TASK_TYPE_LABELS.get(task_type, task_type.replace("_", " ").title())


def task_icon(task_type: str) -> str:
    """Emoji icon for a task type."""
    return TASK_TYPE_ICONS.get(task_type, "\u2699\ufe0f")
