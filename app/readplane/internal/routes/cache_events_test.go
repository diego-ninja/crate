package routes

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseCacheInvalidationEvent(t *testing.T) {
	event, ok := parseCacheInvalidationEvent(`{"id":42,"scope":"library","ts":123.4}`)
	if !ok {
		t.Fatal("expected valid cache event")
	}
	if event.ID != 42 || event.Scope != "library" {
		t.Fatalf("event = %#v", event)
	}

	if _, ok := parseCacheInvalidationEvent(`{"id":0,"scope":"library"}`); ok {
		t.Fatal("accepted event without positive id")
	}
}

func TestWriteCacheInvalidationSSE(t *testing.T) {
	rec := httptest.NewRecorder()
	err := writeCacheInvalidationSSE(rec, cacheInvalidationEvent{ID: 42, Scope: "library"})
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}
	got := rec.Body.String()
	if !strings.Contains(got, "id: 42\n") || !strings.Contains(got, "data: library\n\n") {
		t.Fatalf("sse = %q", got)
	}
}

func TestParseLastEventID(t *testing.T) {
	if id, ok := parseLastEventID("42"); !ok || id != 42 {
		t.Fatalf("id=%d ok=%v", id, ok)
	}
	if _, ok := parseLastEventID("nope"); ok {
		t.Fatal("accepted invalid id")
	}
}
