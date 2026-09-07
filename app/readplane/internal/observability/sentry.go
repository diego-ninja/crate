package observability

import (
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryhttp "github.com/getsentry/sentry-go/http"
)

const defaultTraceSampleRate = 0.1

var sensitiveQueryKeys = map[string]struct{}{
	"access_token":  {},
	"api_key":       {},
	"code":          {},
	"media_ticket":  {},
	"password":      {},
	"refresh_token": {},
	"secret":        {},
	"session":       {},
	"signature":     {},
	"state":         {},
	"token":         {},
}

var sensitiveHeaderKeys = map[string]struct{}{
	"authorization":       {},
	"cookie":              {},
	"proxy-authorization": {},
	"x-api-key":           {},
}

// SentrySettings contains the runtime configuration for one service.
type SentrySettings struct {
	Service            string
	DSN                string
	Environment        string
	Release            string
	TracesSampleRate   float64
	ProfilesSampleRate float64
}

func (settings SentrySettings) Enabled() bool {
	return settings.DSN != ""
}

// LoadSentrySettings reads configuration without requiring Sentry to be enabled.
func LoadSentrySettings(service string) SentrySettings {
	dsn := strings.TrimSpace(os.Getenv("SENTRY_DSN"))
	if disabled(os.Getenv("SENTRY_ENABLED")) {
		dsn = ""
	}

	environment := firstNonEmpty(
		os.Getenv("SENTRY_ENVIRONMENT"),
		os.Getenv("CRATE_ENV"),
		"development",
	)
	release := strings.TrimSpace(os.Getenv("SENTRY_RELEASE"))
	if release == "" {
		release = strings.TrimSpace(os.Getenv("GITHUB_SHA"))
		if release != "" {
			release = "crate-" + release
		}
	}

	return SentrySettings{
		Service:            service,
		DSN:                dsn,
		Environment:        environment,
		Release:            release,
		TracesSampleRate:   sampleRate("SENTRY_TRACES_SAMPLE_RATE", defaultTraceSampleRate),
		ProfilesSampleRate: sampleRate("SENTRY_PROFILES_SAMPLE_RATE", 0),
	}
}

// InitSentry initializes the process-wide SDK. Observability errors never stop
// the readplane from serving traffic, so callers should log the returned error.
func InitSentry(service string) (bool, func(), error) {
	settings := LoadSentrySettings(service)
	if !settings.Enabled() {
		return false, func() {}, nil
	}

	options := sentry.ClientOptions{
		Dsn:                   settings.DSN,
		Environment:           settings.Environment,
		Release:               settings.Release,
		EnableTracing:         settings.TracesSampleRate > 0,
		TracesSampleRate:      settings.TracesSampleRate,
		SampleRate:            1,
		SendDefaultPII:        false,
		BeforeSend:            ScrubEvent,
		BeforeSendTransaction: ScrubEvent,
		MaxBreadcrumbs:        50,
	}
	if err := sentry.Init(options); err != nil {
		return false, func() {}, err
	}
	sentry.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetTag("service", settings.Service)
	})

	return true, func() { sentry.Flush(2 * time.Second) }, nil
}

// WrapHTTP adds request transactions and panic recovery to a net/http handler.
func WrapHTTP(handler http.Handler) http.Handler {
	return sentryhttp.New(sentryhttp.Options{
		Repanic:         true,
		WaitForDelivery: false,
	}).Handle(handler)
}

// ScrubEvent removes credentials and user-identifying data before sending.
func ScrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	if event.Request != nil {
		event.Request.URL = scrubURL(event.Request.URL)
		event.Request.QueryString = scrubQuery(event.Request.QueryString)
		event.Request.Cookies = ""
		event.Request.Data = ""
		for key := range event.Request.Headers {
			if _, ok := sensitiveHeaderKeys[strings.ToLower(key)]; ok {
				event.Request.Headers[key] = "[Filtered]"
			}
		}
	}
	event.User.Email = ""
	event.User.IPAddress = ""
	event.User.Username = ""
	event.User.Name = ""
	event.User.Data = nil
	event.Extra = scrubMap(event.Extra).(map[string]interface{})
	for key, context := range event.Contexts {
		event.Contexts[key] = scrubMap(context).(map[string]interface{})
	}
	for key, value := range event.Tags {
		if sensitiveKey(key) {
			event.Tags[key] = "[Filtered]"
		} else {
			event.Tags[key] = value
		}
	}
	return event
}

func sampleRate(name string, fallback float64) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(name)), 64)
	if err != nil {
		value = fallback
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func disabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "no", "off":
		return true
	default:
		return false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func sensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	if normalized == "cookies" || normalized == "set_cookie" {
		return true
	}
	for _, part := range []string{"authorization", "cookie", "credential", "password", "secret", "token"} {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

func scrubURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.RawQuery == "" {
		return raw
	}
	parsed.RawQuery = scrubQuery(parsed.RawQuery)
	return parsed.String()
}

func scrubQuery(raw string) string {
	if raw == "" {
		return ""
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return raw
	}
	for key := range values {
		if _, ok := sensitiveQueryKeys[strings.ToLower(key)]; ok {
			values.Set(key, "[Filtered]")
		}
	}
	return values.Encode()
}

func scrubMap(values map[string]interface{}) interface{} {
	if values == nil {
		return map[string]interface{}{}
	}
	result := make(map[string]interface{}, len(values))
	for key, value := range values {
		if sensitiveKey(key) {
			result[key] = "[Filtered]"
			continue
		}
		switch nested := value.(type) {
		case map[string]interface{}:
			result[key] = scrubMap(nested)
		case []interface{}:
			items := make([]interface{}, len(nested))
			for index, item := range nested {
				if child, ok := item.(map[string]interface{}); ok {
					items[index] = scrubMap(child)
				} else {
					items[index] = item
				}
			}
			result[key] = items
		default:
			result[key] = value
		}
	}
	return result
}
