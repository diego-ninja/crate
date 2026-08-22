"""Canonical task type labels and icons.

Single source of truth for human-readable task names. Used by API
responses, Telegram bot, and mirrored in the admin frontend.
"""

TASK_TYPE_LABELS: dict[str, str] = {
    # Library
    "library_sync": "Library Scan",
    "import_queue_item": "Import Staged Album",
    "import_queue_all": "Import Staged Albums",
    "import_queue_remove": "Remove Staged Import",
    "federation_import_album": "Import Federated Album",
    "federation_sync_catalog": "Sync Federated Catalog",
    "global_catalog_reconcile_incremental": "Global Catalog Reconciliation",
    "global_catalog_reconcile_full": "Full Global Catalog Reconciliation",
    "scan": "Health Check",
    "process_new_content": "Process New Content",
    "repair_library": "Library Repair",
    "delete_artist": "Artist Deletion",
    "delete_album": "Album Deletion",
    "migrate_storage": "Storage Migration",
    "migrate_storage_v2": "Legacy Storage Migration v2",
    "fix_artist": "Artist Fix",
    "write_portable_metadata": "Portable Metadata",
    "rehydrate_portable_metadata": "Portable Metadata Rehydrate",
    "export_rich_metadata": "Rich Metadata Export",
    "backfill_artist_heroes": "Artist Hero Backfill",
    "compose_artist_hero": "Artist Hero Composition",
    "preview_artist_hero": "Artist Hero Preview",
    "recompose_artist_hero": "Artist Hero Renderer Migration",
    "derive_artist_hero": "Artist Hero Composition",
    "import_artist_artwork_asset": "Artist Artwork Gallery",
    "assign_artist_artwork_slot": "Artist Artwork Assignment",
    "delete_artist_artwork_asset": "Artist Artwork Deletion",
    "prime_jam_auto_dj": "Jam Room Auto DJ",
    # Enrichment
    "enrich_artists": "Artist Enrichment",
    "enrich_artist": "Artist Enrichment",
    "normalize_artist_bios": "Normalize Artist Bios",
    "research_artist_bio": "Research Artist Bio",
    "enrich_all": "Full Enrichment",
    "sync_lyrics": "Lyrics Sync",
    # Analysis
    "audio_analysis": "Audio Analysis",
    "bliss_analysis": "Bliss Similarity",
    "analyze_batch": "Batch Analysis",
    "backfill_track_audio_fingerprints": "Track Fingerprint Backfill",
    # Tidal / Downloads
    "tidal_download": "Tidal Download",
    "soulseek_download": "Soulseek Download",
    "bandcamp_backfill_entity_urls": "Bandcamp URL Backfill",
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
    # Playback delivery
    "prepare_stream_variant": "Prepare Playback Stream",
    "cleanup_stream_variants": "Clean Playback Cache",
    # Playlists
    "generate_system_playlist": "Playlist Generation",
    "refresh_system_smart_playlists": "Refresh Smart Playlists",
    "persist_playlist_cover": "Save Playlist Cover",
    "draft_i18n_translation": "Listen Translation Draft",
}

TASK_TYPE_ICONS: dict[str, str] = {
    "prime_jam_auto_dj": "🎵",
    "library_sync": "\U0001f4c2",
    "import_queue_item": "\U0001f4e5",
    "import_queue_all": "\U0001f4e5",
    "import_queue_remove": "\U0001f5d1",
    "federation_import_album": "\U0001f4e5",
    "federation_sync_catalog": "\U0001f504",
    "global_catalog_reconcile_incremental": "\U0001f504",
    "global_catalog_reconcile_full": "\U0001f504",
    "scan": "\U0001f50d",
    "process_new_content": "\u2728",
    "repair_library": "\U0001f527",
    "delete_artist": "\U0001f5d1",
    "delete_album": "\U0001f5d1",
    "migrate_storage": "\U0001f4e6",
    "migrate_storage_v2": "\U0001f4e6",
    "fix_artist": "\U0001f527",
    "write_portable_metadata": "\U0001f4be",
    "rehydrate_portable_metadata": "\U0001f4e5",
    "export_rich_metadata": "\U0001f4e6",
    "enrich_artists": "\U0001f50e",
    "enrich_artist": "\U0001f50e",
    "enrich_all": "\U0001f50e",
    "sync_lyrics": "\U0001f4dd",
    "audio_analysis": "\U0001f3b5",
    "bliss_analysis": "\U0001f9ec",
    "analyze_batch": "\U0001f3b5",
    "backfill_track_audio_fingerprints": "\U0001f9ec",
    "tidal_download": "\U0001f4e5",
    "soulseek_download": "\U0001f4e5",
    "bandcamp_backfill_entity_urls": "\U0001f517",
    "index_genres": "\U0001f3f7\ufe0f",
    "infer_genre_taxonomy": "\U0001f3f7\ufe0f",
    "enrich_genre_descriptions": "\U0001f4dd",
    "sync_genre_musicbrainz": "\U0001f310",
    "cleanup_invalid_genre_taxonomy": "\U0001f9f9",
    "generate_smart_playlist": "\U0001f3b6",
    "generate_playlist": "\U0001f3b6",
    "update_popularity": "\U0001f4ca",
    "fetch_popularity": "\U0001f4ca",
    "prepare_stream_variant": "\U0001f3a7",
    "cleanup_stream_variants": "\U0001f9f9",
}


def task_label(task_type: str) -> str:
    """Human-readable label for a task type."""
    return TASK_TYPE_LABELS.get(task_type, task_type.replace("_", " ").title())


def task_icon(task_type: str) -> str:
    """Emoji icon for a task type."""
    return TASK_TYPE_ICONS.get(task_type, "\u2699\ufe0f")
