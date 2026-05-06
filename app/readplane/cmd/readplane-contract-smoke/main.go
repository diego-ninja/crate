package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/diego-ninja/crate/app/readplane/internal/contract"
)

type check struct {
	name string
	path string
	sse  bool
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithTimeout(context.Background(), cfg.timeout)
	defer cancel()

	fastapi := contract.NewClient(cfg.fastapiBase, cfg.timeout)
	readplane := contract.NewClient(cfg.readplaneBase, cfg.timeout)

	token, err := fastapi.Login(ctx, cfg.email, cfg.password)
	if err != nil {
		log.Fatalf("login failed: %v", err)
	}

	checks := []check{
		{name: "auth/me", path: "/api/auth/me"},
		{name: "favorites", path: "/api/favorites"},
		{name: "me/library counts", path: "/api/me"},
		{name: "me/follows", path: "/api/me/follows"},
		{name: "me/albums", path: "/api/me/albums"},
		{name: "me/likes", path: "/api/me/likes?limit=25"},
		{name: "me/history", path: "/api/me/history?limit=25"},
		{name: "home/discovery", path: "/api/me/home/discovery"},
		{name: "home/hero", path: "/api/me/home/hero"},
		{name: "home/recently-played", path: "/api/me/home/recently-played"},
		{name: "home/mixes", path: "/api/me/home/mixes"},
		{name: "home/suggested-albums", path: "/api/me/home/suggested-albums"},
		{name: "home/recommended-tracks", path: "/api/me/home/recommended-tracks"},
		{name: "home/radio-stations", path: "/api/me/home/radio-stations"},
		{name: "home/favorite-artists", path: "/api/me/home/favorite-artists"},
		{name: "home/essentials", path: "/api/me/home/essentials"},
	}
	if cfg.checkSSE {
		checks = append(checks, check{name: "home/discovery-stream initial", path: "/api/me/home/discovery-stream", sse: true})
	}

	for _, item := range checks {
		if item.sse {
			mustCompareSSE(ctx, fastapi, readplane, item, token)
			continue
		}
		mustCompareGET(ctx, fastapi, readplane, item, token)
	}
	if cfg.checkP1 {
		mustCheckP1(ctx, fastapi, readplane, token, cfg.p1Query)
	}
	mustCheckGenres(ctx, fastapi, readplane, token)
}

type smokeConfig struct {
	fastapiBase   string
	readplaneBase string
	email         string
	password      string
	timeout       time.Duration
	checkSSE      bool
	checkP1       bool
	p1Query       string
}

func loadConfig() smokeConfig {
	return smokeConfig{
		fastapiBase:   env("FASTAPI_BASE", "http://127.0.0.1:8585"),
		readplaneBase: env("READPLANE_BASE", "http://127.0.0.1:8686"),
		email:         env("CRATE_AUTH_EMAIL", "admin@cratemusic.app"),
		password:      env("CRATE_AUTH_PASSWORD", "admin"),
		timeout:       durationEnv("READPLANE_CONTRACT_TIMEOUT", 15*time.Second),
		checkSSE:      boolEnv("READPLANE_CONTRACT_CHECK_SSE", true),
		checkP1:       boolEnv("READPLANE_CONTRACT_CHECK_P1", true),
		p1Query:       env("READPLANE_CONTRACT_P1_QUERY", "high"),
	}
}

func mustCheckP1(ctx context.Context, fastapi contract.Client, readplane contract.Client, token string, query string) {
	searchPath := "/api/search?q=" + queryEscape(query) + "&limit=5"
	searchRaw := mustCompareGET(ctx, fastapi, readplane, check{name: "p1 search", path: searchPath}, token)
	search := decodeSearch(searchRaw)

	if len(search.Artists) > 0 {
		artist := search.Artists[0]
		if id := jsonID(artist["id"]); id != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist detail", path: "/api/artists/" + id}, token, "hit")
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist top tracks", path: "/api/artists/" + id + "/top-tracks?count=5"}, token, "hit")
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 me follow artist id state", path: "/api/me/follows/artists/" + id}, token)
		}
		if entityUID := jsonString(artist["entity_uid"]); entityUID != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist by entity", path: "/api/artists/by-entity/" + pathEscape(entityUID)}, token, "hit")
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist entity top tracks", path: "/api/artists/by-entity/" + pathEscape(entityUID) + "/top-tracks?count=5"}, token, "hit")
		}
		if slug := jsonString(artist["slug"]); slug != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist by slug", path: "/api/artist-slugs/" + pathEscape(slug)}, token, "hit")
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 artist slug top tracks", path: "/api/artist-slugs/" + pathEscape(slug) + "/top-tracks?count=5"}, token, "hit")
		}
		if name := jsonString(artist["name"]); name != "" {
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 me follow artist name state", path: "/api/me/follows/" + pathEscape(name)}, token)
		}
	}

	if len(search.Albums) > 0 {
		album := search.Albums[0]
		if id := jsonID(album["id"]); id != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 album detail", path: "/api/albums/" + id}, token, "hit")
		}
		if entityUID := jsonString(album["entity_uid"]); entityUID != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 album by entity", path: "/api/albums/by-entity/" + pathEscape(entityUID)}, token, "hit")
		}
		artistSlug := jsonString(album["artist_slug"])
		albumSlug := jsonString(album["slug"])
		if artistSlug != "" && albumSlug != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 album by public slug", path: "/api/artist-slugs/" + pathEscape(artistSlug) + "/albums/" + pathEscape(albumSlug)}, token, "hit")
		}
	}

	if len(search.Tracks) > 0 {
		track := search.Tracks[0]
		if id := jsonID(track["id"]); id != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 track info", path: "/api/tracks/" + id + "/info"}, token, "hit")
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 track playback", path: "/api/tracks/" + id + "/playback"}, token, "hit")
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 track eq features", path: "/api/tracks/" + id + "/eq-features"}, token)
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 track genre", path: "/api/tracks/" + id + "/genre"}, token)
		}
		if entityUID := jsonString(track["entity_uid"]); entityUID != "" {
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 track entity info", path: "/api/tracks/by-entity/" + pathEscape(entityUID) + "/info"}, token, "hit")
			mustEnsureGET(ctx, fastapi, readplane, check{name: "p1 track entity playback", path: "/api/tracks/by-entity/" + pathEscape(entityUID) + "/playback"}, token, "hit")
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 track entity eq features", path: "/api/tracks/by-entity/" + pathEscape(entityUID) + "/eq-features"}, token)
			mustCompareGET(ctx, fastapi, readplane, check{name: "p2 track entity genre", path: "/api/tracks/by-entity/" + pathEscape(entityUID) + "/genre"}, token)
		}
	}
}

func mustCheckGenres(ctx context.Context, fastapi contract.Client, readplane contract.Client, token string) {
	raw := mustCompareGET(ctx, fastapi, readplane, check{name: "p2 genres list", path: "/api/genres"}, token)
	var genres []map[string]any
	if err := json.Unmarshal(raw, &genres); err != nil {
		log.Fatalf("decode genres list: %v", err)
	}
	if len(genres) == 0 {
		return
	}
	if slug := jsonString(genres[0]["slug"]); slug != "" {
		mustCompareGET(ctx, fastapi, readplane, check{name: "p2 genre detail", path: "/api/genres/" + pathEscape(slug)}, token)
	}
}

func mustCompareGET(ctx context.Context, fastapi contract.Client, readplane contract.Client, item check, token string) []byte {
	left, _, err := fastapi.Get(ctx, item.path, token)
	if err != nil {
		log.Fatalf("%s FastAPI failed: %v", item.name, err)
	}
	right, headers, err := readplane.Get(ctx, item.path, token)
	if err != nil {
		log.Fatalf("%s readplane failed: %v", item.name, err)
	}
	ok, diff, err := contract.EqualJSON(left, right)
	if err != nil {
		log.Fatalf("%s compare failed: %v", item.name, err)
	}
	if !ok {
		log.Fatalf("%s mismatch\n%s", item.name, diff)
	}
	fmt.Printf("ok %-32s source=%s\n", item.name, headers.Get("X-Crate-Readplane"))
	return right
}

func mustEnsureGET(ctx context.Context, fastapi contract.Client, readplane contract.Client, item check, token string, expectedSource string) []byte {
	if _, _, err := fastapi.Get(ctx, item.path, token); err != nil {
		log.Fatalf("%s FastAPI failed: %v", item.name, err)
	}
	right, headers, err := readplane.Get(ctx, item.path, token)
	if err != nil {
		log.Fatalf("%s readplane failed: %v", item.name, err)
	}
	var decoded any
	if err := json.Unmarshal(right, &decoded); err != nil {
		log.Fatalf("%s readplane returned invalid JSON: %v", item.name, err)
	}
	source := headers.Get("X-Crate-Readplane")
	if expectedSource != "" && source != expectedSource {
		log.Fatalf("%s source=%s, want %s", item.name, source, expectedSource)
	}
	fmt.Printf("ok %-32s source=%s\n", item.name, source)
	return right
}

func mustCompareSSE(ctx context.Context, fastapi contract.Client, readplane contract.Client, item check, token string) {
	path := item.path
	if strings.Contains(path, "?") {
		path += "&initial=1"
	} else {
		path += "?initial=1"
	}
	left, err := fastapi.FirstSSEData(ctx, path, token)
	if err != nil {
		log.Fatalf("%s FastAPI SSE failed: %v", item.name, err)
	}
	right, err := readplane.FirstSSEData(ctx, path, token)
	if err != nil {
		log.Fatalf("%s readplane SSE failed: %v", item.name, err)
	}
	ok, diff, err := contract.EqualJSON(left, right)
	if err != nil {
		log.Fatalf("%s SSE compare failed: %v", item.name, err)
	}
	if !ok {
		log.Fatalf("%s SSE mismatch\n%s", item.name, diff)
	}
	fmt.Printf("ok %-32s source=sse\n", item.name)
}

type searchPayload struct {
	Artists []map[string]any `json:"artists"`
	Albums  []map[string]any `json:"albums"`
	Tracks  []map[string]any `json:"tracks"`
}

func decodeSearch(raw []byte) searchPayload {
	var payload searchPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		log.Fatalf("decode p1 search: %v", err)
	}
	return payload
}

func jsonString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func jsonID(value any) string {
	switch typed := value.(type) {
	case float64:
		if typed > 0 {
			return strconv.FormatInt(int64(typed), 10)
		}
	case json.Number:
		return typed.String()
	case string:
		return typed
	}
	return ""
}

func queryEscape(value string) string {
	return url.QueryEscape(value)
}

func pathEscape(value string) string {
	return url.PathEscape(value)
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}
