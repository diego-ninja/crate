package routes

import (
	"github.com/diego-ninja/crate/app/readplane/internal/snapshots"
)

var homeDiscoveryListDefaults = []string{
	"recently_played",
	"custom_mixes",
	"suggested_albums",
	"recommended_tracks",
	"radio_stations",
	"favorite_artists",
	"essentials",
}

var homeCardNilDefaults = []string{
	"id",
	"name",
	"title",
	"description",
	"subtitle",
	"badge",
	"kind",
	"track_count",
	"total_duration",
}

var homeArtworkNilDefaults = []string{
	"artist",
	"artist_id",
	"artist_entity_uid",
	"artist_slug",
	"album",
	"album_id",
	"album_entity_uid",
	"album_slug",
	"artist_name",
}

var homeTrackNilDefaults = []string{
	"track_id",
	"track_entity_uid",
	"track_path",
	"title",
	"artist",
	"artist_id",
	"artist_entity_uid",
	"artist_slug",
	"album",
	"album_id",
	"album_entity_uid",
	"album_slug",
	"duration",
	"format",
	"bitrate",
	"sample_rate",
	"bit_depth",
}

func homeDiscoveryHTTPPayload(row *snapshots.Row) map[string]any {
	payload := row.DecoratedPayload()
	for _, key := range homeDiscoveryListDefaults {
		ensureListDefault(payload, key)
	}
	payload["snapshot"] = snapshotHTTPMetadata(row.Meta)
	normalizeHomeCards(payload["custom_mixes"])
	normalizeHomeCards(payload["essentials"])
	normalizeHomeTracks(payload["recommended_tracks"])
	return payload
}

func snapshotHTTPMetadata(meta snapshots.SnapshotMeta) map[string]any {
	return map[string]any{
		"scope":         meta.Scope,
		"subject_key":   meta.SubjectKey,
		"version":       meta.Version,
		"built_at":      meta.BuiltAt,
		"stale_after":   meta.StaleAfter,
		"stale":         meta.Stale,
		"generation_ms": meta.GenerationMS,
	}
}

func normalizeHomeCards(value any) {
	items, ok := value.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		card, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ensureNilDefaults(card, homeCardNilDefaults)
		ensureListDefault(card, "artwork_tracks")
		ensureListDefault(card, "artwork_artists")
		ensureListDefault(card, "tracks")
		ensureListDefault(card, "items")
		normalizeArtworkRefs(card["artwork_tracks"])
		normalizeArtworkRefs(card["artwork_artists"])
		normalizeHomeTracks(card["tracks"])
	}
}

func normalizeArtworkRefs(value any) {
	items, ok := value.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		ref, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ensureNilDefaults(ref, homeArtworkNilDefaults)
	}
}

func normalizeHomeTracks(value any) {
	items, ok := value.([]any)
	if !ok {
		return
	}
	for _, item := range items {
		track, ok := item.(map[string]any)
		if !ok {
			continue
		}
		ensureNilDefaults(track, homeTrackNilDefaults)
	}
}

func ensureListDefault(payload map[string]any, key string) {
	if value, ok := payload[key]; !ok || value == nil {
		payload[key] = []any{}
	}
}

func ensureNilDefaults(payload map[string]any, keys []string) {
	for _, key := range keys {
		if _, ok := payload[key]; !ok {
			payload[key] = nil
		}
	}
}
