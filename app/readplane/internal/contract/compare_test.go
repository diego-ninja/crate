package contract

import "testing"

func TestEqualJSONNormalizesObjectOrder(t *testing.T) {
	ok, diff, err := EqualJSON([]byte(`{"b":2,"a":1}`), []byte(`{"a":1,"b":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("diff = %s", diff)
	}
}

func TestEqualJSONNormalizesSnapshotTimes(t *testing.T) {
	left := []byte(`{"snapshot":{"built_at":"2026-05-05T09:00:00+00:00"}}`)
	right := []byte(`{"snapshot":{"built_at":"2026-05-05T09:00:00Z"}}`)

	ok, diff, err := EqualJSON(left, right)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("diff = %s", diff)
	}
}

func TestEqualJSONNormalizesNumericRepresentation(t *testing.T) {
	ok, diff, err := EqualJSON([]byte(`{"bpm":152.0}`), []byte(`{"bpm":152}`))
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatalf("diff = %s", diff)
	}
}

func TestEqualJSONReportsMismatch(t *testing.T) {
	ok, diff, err := EqualJSON([]byte(`{"a":1}`), []byte(`{"a":2}`))
	if err != nil {
		t.Fatal(err)
	}
	if ok || diff == "" {
		t.Fatalf("ok=%v diff=%q", ok, diff)
	}
}

func TestEqualJSONReportsFirstPathMismatch(t *testing.T) {
	ok, diff, err := EqualJSON(
		[]byte(`{"items":[{"name":"one"},{"name":"two"}]}`),
		[]byte(`{"items":[{"name":"one"},{"name":"three"}]}`),
	)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected mismatch")
	}
	if diff != `$.items[1].name: left="two" right="three"` {
		t.Fatalf("diff = %s", diff)
	}
}
