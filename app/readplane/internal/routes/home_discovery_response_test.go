package routes

import (
	"testing"
	"time"

	"github.com/diego-ninja/crate/app/readplane/internal/snapshots"
)

func TestHomeDiscoveryHTTPPayloadMatchesFastAPIResponseModelDefaults(t *testing.T) {
	builtAt := time.Date(2026, 5, 5, 10, 0, 0, 0, time.UTC)
	staleAfter := builtAt.Add(10 * time.Minute)
	row := &snapshots.Row{
		Payload: map[string]any{
			"custom_mixes": []any{
				map[string]any{
					"name": "Daily Discovery",
					"artwork_artists": []any{
						map[string]any{"artist_id": float64(52), "artist_name": "Poison The Well"},
					},
				},
			},
		},
		Meta: snapshots.SnapshotMeta{
			Scope:        "home:discovery",
			SubjectKey:   "1",
			Version:      4,
			BuiltAt:      builtAt,
			SourceSeq:    99,
			StaleAfter:   &staleAfter,
			GenerationMS: 12,
		},
	}

	payload := homeDiscoveryHTTPPayload(row)
	snapshot, ok := payload["snapshot"].(map[string]any)
	if !ok {
		t.Fatalf("snapshot = %#v", payload["snapshot"])
	}
	if _, ok := snapshot["source_seq"]; ok {
		t.Fatalf("source_seq should be omitted from HTTP response model payload")
	}
	if _, ok := payload["recommended_tracks"].([]any); !ok {
		t.Fatalf("recommended_tracks default missing: %#v", payload["recommended_tracks"])
	}

	mixes := payload["custom_mixes"].([]any)
	card := mixes[0].(map[string]any)
	if card["title"] != nil {
		t.Fatalf("title default = %#v", card["title"])
	}
	if _, ok := card["tracks"].([]any); !ok {
		t.Fatalf("tracks default missing: %#v", card["tracks"])
	}

	artists := card["artwork_artists"].([]any)
	artist := artists[0].(map[string]any)
	if artist["album"] != nil || artist["album_id"] != nil || artist["artist"] != nil {
		t.Fatalf("artwork defaults not applied: %#v", artist)
	}
}
