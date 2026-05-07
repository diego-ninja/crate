package routes

import (
	"reflect"
	"testing"

	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestHomeSlicePayloadWrapsListItems(t *testing.T) {
	row := &snapshots.Row{
		Payload: map[string]any{
			"custom_mixes": []any{
				map[string]any{"id": "punk-rock", "name": "punk rock mix"},
			},
		},
	}

	payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/mixes"])
	got, ok := payload.(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v", payload)
	}
	want := map[string]any{
		"items": []any{
			map[string]any{"id": "punk-rock", "name": "punk rock mix"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("payload = %#v, want %#v", got, want)
	}
}

func TestHomeSlicePayloadUsesEmptyListDefault(t *testing.T) {
	row := &snapshots.Row{Payload: map[string]any{}}

	payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/recently-played"])
	got, ok := payload.(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v", payload)
	}
	items, ok := got["items"].([]any)
	if !ok || len(items) != 0 {
		t.Fatalf("items = %#v", got["items"])
	}
}

func TestHomeSlicePayloadReturnsRawHero(t *testing.T) {
	row := &snapshots.Row{
		Payload: map[string]any{
			"hero": map[string]any{"id": float64(7), "name": "High Vis"},
		},
	}

	payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/hero"])
	got, ok := payload.(map[string]any)
	if !ok {
		t.Fatalf("payload = %#v", payload)
	}
	if got["name"] != "High Vis" {
		t.Fatalf("hero = %#v", got)
	}
}
