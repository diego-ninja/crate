package catalog

import "testing"

func TestPublicAlbumSlugStripsYearAndArtistPrefix(t *testing.T) {
	got := publicAlbumSlug("2024 - High Vis - Guided Tour", "high-vis")
	if got != "guided-tour" {
		t.Fatalf("slug = %q, want guided-tour", got)
	}
}

func TestSlugifyCollapsesSeparators(t *testing.T) {
	got := slugify("  Live in Orlando, FL 3/14/2022  ")
	if got != "live-in-orlando-fl-3-14-2022" {
		t.Fatalf("slug = %q", got)
	}
}

func TestLooksLikeUUID(t *testing.T) {
	if !looksLikeUUID("123e4567-e89b-12d3-a456-426614174000") {
		t.Fatal("expected valid uuid")
	}
	if looksLikeUUID("123e4567e89b12d3a456426614174000") {
		t.Fatal("accepted compact uuid")
	}
}

func TestNormalizeFloatSlice(t *testing.T) {
	values := normalizeFloatSlice([]any{1, float64(2.5), "3"})
	if len(values) != 3 || values[0] != 1 || values[1] != 2.5 || values[2] != 3 {
		t.Fatalf("values = %#v", values)
	}
}

func TestDeriveBlissSignature(t *testing.T) {
	signature := deriveBlissSignature([]any{0.1, 0.2, 0.4, 0.8})
	if signature == nil {
		t.Fatal("expected signature")
	}
	for _, key := range []string{"texture", "motion", "density"} {
		value, ok := signature[key].(float64)
		if !ok || value <= 0 {
			t.Fatalf("%s = %#v", key, signature[key])
		}
	}
}

func TestSerializeEQFeatures(t *testing.T) {
	payload := serializeEQFeatures(map[string]any{
		"energy":              0.8,
		"loudness":            -8.5,
		"dynamic_range":       11.2,
		"spectral_complexity": 0.7,
		"danceability":        0.4,
		"valence":             0.3,
		"acousticness":        0.2,
		"instrumentalness":    0.1,
	})
	if payload["dynamicRange"] != 11.2 {
		t.Fatalf("dynamicRange = %#v", payload["dynamicRange"])
	}
	if payload["brightness"] != 0.7 {
		t.Fatalf("brightness = %#v", payload["brightness"])
	}
}

func TestEmptyTrackGenrePayload(t *testing.T) {
	payload := emptyTrackGenrePayload()
	for _, key := range []string{"primary", "topLevel", "source", "preset"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("missing %s", key)
		}
		if payload[key] != nil {
			t.Fatalf("%s = %#v", key, payload[key])
		}
	}
}

func TestAnnotateGenreSummaryMapped(t *testing.T) {
	row := map[string]any{
		"canonical_slug":        "post-hardcore",
		"canonical_name":        "post-hardcore",
		"canonical_description": "hardcore expanded into dynamics.",
		"top_level_slug":        "punk",
		"top_level_name":        "punk",
		"top_level_description": "fast and direct.",
		"canonical_eq_gains":    []float64{1, 2, 3},
		"preset_gains":          []float64{4, 5, 6},
		"preset_source":         "inherited",
		"preset_slug":           "punk",
		"preset_name":           "punk",
		"external_description":  "",
		"musicbrainz_mbid":      nil,
		"wikidata_entity_id":    nil,
		"wikidata_url":          nil,
	}

	annotateGenreSummary(row, true)

	if row["mapped"] != true {
		t.Fatalf("mapped = %#v", row["mapped"])
	}
	if row["description"] != "hardcore expanded into dynamics." {
		t.Fatalf("description = %#v", row["description"])
	}
	if _, ok := row["canonical_eq_gains"]; ok {
		t.Fatal("leaked canonical_eq_gains")
	}
	preset, ok := row["eq_preset_resolved"].(map[string]any)
	if !ok || preset["slug"] != "punk" {
		t.Fatalf("preset = %#v", row["eq_preset_resolved"])
	}
}

func TestAnnotateGenreSummaryUsesStaticTopLevelWhenDBHasSelf(t *testing.T) {
	row := map[string]any{
		"canonical_slug":        "hardcore-punk",
		"canonical_name":        "hardcore punk",
		"canonical_description": "hardcore description",
		"top_level_slug":        "hardcore-punk",
		"top_level_name":        "hardcore punk",
		"top_level_description": "hardcore description",
	}

	annotateGenreSummary(row, false)

	if row["top_level_slug"] != "punk" {
		t.Fatalf("top_level_slug = %#v", row["top_level_slug"])
	}
	if row["top_level_description"] != genreTopLevelMetadata["punk"]["description"] {
		t.Fatalf("top_level_description = %#v", row["top_level_description"])
	}
}

func TestAnnotateGenreSummaryUnmappedClearsTaxonomyFields(t *testing.T) {
	row := map[string]any{
		"canonical_slug":              nil,
		"top_level_slug":              "rock",
		"description":                 "old",
		"external_description":        "old",
		"external_description_source": "old",
		"musicbrainz_mbid":            "mbid",
		"wikidata_entity_id":          "qid",
		"wikidata_url":                "url",
	}

	annotateGenreSummary(row, false)

	if row["mapped"] != false {
		t.Fatalf("mapped = %#v", row["mapped"])
	}
	for _, key := range []string{"top_level_slug", "description", "external_description", "musicbrainz_mbid"} {
		if row[key] != nil {
			t.Fatalf("%s = %#v", key, row[key])
		}
	}
}
