package observability

import (
	"testing"

	"github.com/getsentry/sentry-go"
)

func TestLoadSentrySettings(t *testing.T) {
	t.Setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
	t.Setenv("SENTRY_ENVIRONMENT", "staging")
	t.Setenv("SENTRY_RELEASE", "crate-abc123")
	t.Setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")

	settings := LoadSentrySettings("readplane")

	if !settings.Enabled() {
		t.Fatal("expected Sentry to be enabled")
	}
	if settings.Service != "readplane" {
		t.Fatalf("service = %q, want readplane", settings.Service)
	}
	if settings.DSN != "https://public@example.ingest.sentry.io/1" {
		t.Fatalf("unexpected DSN: %q", settings.DSN)
	}
	if settings.Environment != "staging" {
		t.Fatalf("environment = %q, want staging", settings.Environment)
	}
	if settings.Release != "crate-abc123" {
		t.Fatalf("release = %q, want crate-abc123", settings.Release)
	}
	if settings.TracesSampleRate != 0.25 {
		t.Fatalf("trace sample rate = %v, want 0.25", settings.TracesSampleRate)
	}
}

func TestLoadSentrySettingsDisablesWithoutDSN(t *testing.T) {
	t.Setenv("SENTRY_DSN", "")

	settings := LoadSentrySettings("readplane")

	if settings.Enabled() {
		t.Fatal("expected Sentry to be disabled without a DSN")
	}
}

func TestLoadSentrySettingsClampsInvalidRate(t *testing.T) {
	t.Setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
	t.Setenv("SENTRY_TRACES_SAMPLE_RATE", "2")

	settings := LoadSentrySettings("readplane")

	if settings.TracesSampleRate != 1 {
		t.Fatalf("trace sample rate = %v, want 1", settings.TracesSampleRate)
	}
}

func TestScrubEventRedactsRequestCredentialsAndUserPII(t *testing.T) {
	event := &sentry.Event{
		Request: &sentry.Request{
			URL:         "https://api.example.test/api/stream?media_ticket=secret&artist=birds-in-row",
			QueryString: "media_ticket=secret&artist=birds-in-row",
			Cookies:     "session=secret",
			Headers: map[string]string{
				"Authorization": "Bearer secret",
				"Content-Type":  "application/json",
			},
		},
		User: sentry.User{ID: "42", Email: "user@example.test", IPAddress: "192.0.2.10"},
		Extra: map[string]interface{}{
			"refresh_token": "secret",
			"safe":          "kept",
		},
	}

	scrubbed := ScrubEvent(event, nil)

	if scrubbed.Request.URL != "https://api.example.test/api/stream?artist=birds-in-row&media_ticket=%5BFiltered%5D" {
		t.Fatalf("unexpected URL: %q", scrubbed.Request.URL)
	}
	if scrubbed.Request.QueryString != "artist=birds-in-row&media_ticket=%5BFiltered%5D" {
		t.Fatalf("unexpected query string: %q", scrubbed.Request.QueryString)
	}
	if scrubbed.Request.Cookies != "" {
		t.Fatalf("cookies should be removed, got %q", scrubbed.Request.Cookies)
	}
	if scrubbed.Request.Headers["Authorization"] != "[Filtered]" {
		t.Fatalf("authorization header was not redacted")
	}
	if scrubbed.Request.Headers["Content-Type"] != "application/json" {
		t.Fatalf("content type header should be preserved")
	}
	if scrubbed.User.ID != "42" || scrubbed.User.Email != "" || scrubbed.User.IPAddress != "" {
		t.Fatalf("unexpected user: %+v", scrubbed.User)
	}
	if scrubbed.Extra["refresh_token"] != "[Filtered]" || scrubbed.Extra["safe"] != "kept" {
		t.Fatalf("unexpected extra: %#v", scrubbed.Extra)
	}
}
