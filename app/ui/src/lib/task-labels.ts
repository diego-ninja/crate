/** Human-readable task type labels — mirrors app/crate/task_registry.py */

const TASK_LABELS: Record<string, string> = {
  library_sync: "Library Scan",
  scan: "Health Check",
  process_new_content: "Process New Content",
  repair_library: "Library Repair",
  delete_artist: "Artist Deletion",
  delete_album: "Album Deletion",
  migrate_storage: "Storage Migration",
  migrate_storage_v2: "Storage Migration v2",
  enrich_artists: "Artist Enrichment",
  enrich_artist: "Artist Enrichment",
  enrich_all: "Full Enrichment",
  audio_analysis: "Audio Analysis",
  bliss_analysis: "Bliss Similarity",
  analyze_batch: "Batch Analysis",
  tidal_download: "Tidal Download",
  soulseek_download: "Soulseek Download",
  index_genres: "Genre Indexing",
  infer_genre_taxonomy: "Taxonomy Inference",
  enrich_genre_descriptions: "Genre Description Enrichment",
  sync_genre_musicbrainz: "MusicBrainz Genre Sync",
  cleanup_invalid_genre_taxonomy: "Taxonomy Cleanup",
  generate_smart_playlist: "Smart Playlist Generation",
  generate_playlist: "Playlist Generation",
  update_popularity: "Popularity Update",
  fetch_popularity: "Popularity Fetch",
};

export function taskLabel(taskType: string): string {
  return TASK_LABELS[taskType] ?? taskType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
