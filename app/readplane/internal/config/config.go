package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAddr                  = ":8686"
	defaultRedisURL              = "redis://localhost:6379/0"
	defaultFallbackBase          = "http://api:8585"
	defaultMaxDBConns            = 8
	defaultMinDBConns            = 1
	defaultQueryTimeoutMS        = 800
	defaultSnapshotMaxAgeSeconds = 600
	defaultStaleMaxAgeSeconds    = 3600
	defaultRouteMode             = "shadow"
)

type Config struct {
	Addr            string
	DatabaseURL     string
	RedisURL        string
	JWTSecret       string
	Enabled         bool
	MaxDBConns      int32
	MinDBConns      int32
	QueryTimeout    time.Duration
	SnapshotMaxAge  time.Duration
	StaleMaxAge     time.Duration
	EnableSSE       bool
	RouteMode       string
	APIBase         string
	FallbackEnabled bool
	Version         string
}

func Load(version string) Config {
	return Config{
		Addr:            stringEnv("READPLANE_ADDR", defaultAddr),
		DatabaseURL:     databaseURL(),
		RedisURL:        stringEnv("REDIS_URL", defaultRedisURL),
		JWTSecret:       stringEnv("JWT_SECRET", ""),
		Enabled:         boolEnv("READPLANE_ENABLED", true),
		MaxDBConns:      int32Env("READPLANE_MAX_DB_CONNS", defaultMaxDBConns),
		MinDBConns:      int32Env("READPLANE_MIN_DB_CONNS", defaultMinDBConns),
		QueryTimeout:    msEnv("READPLANE_QUERY_TIMEOUT_MS", defaultQueryTimeoutMS),
		SnapshotMaxAge:  secondsEnv("READPLANE_SNAPSHOT_MAX_AGE_SECONDS", defaultSnapshotMaxAgeSeconds),
		StaleMaxAge:     secondsEnv("READPLANE_STALE_MAX_AGE_SECONDS", defaultStaleMaxAgeSeconds),
		EnableSSE:       boolEnv("READPLANE_ENABLE_SSE", true),
		RouteMode:       stringEnv("READPLANE_ROUTE_MODE", defaultRouteMode),
		APIBase:         strings.TrimRight(stringEnv("API_FALLBACK_BASE", defaultFallbackBase), "/"),
		FallbackEnabled: boolEnv("READPLANE_FALLBACK_ENABLED", true),
		Version:         version,
	}
}

func databaseURL() string {
	if value := stringEnv("DATABASE_URL", ""); value != "" {
		return value
	}

	user := stringEnv("CRATE_POSTGRES_USER", "")
	password := stringEnv("CRATE_POSTGRES_PASSWORD", "")
	host := stringEnv("CRATE_POSTGRES_HOST", "")
	database := stringEnv("CRATE_POSTGRES_DB", "")
	if user == "" || host == "" || database == "" {
		return ""
	}
	port := stringEnv("CRATE_POSTGRES_PORT", "5432")
	postgresURL := url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(user, password),
		Host:   host + ":" + port,
		Path:   "/" + database,
	}
	query := postgresURL.Query()
	query.Set("sslmode", "disable")
	postgresURL.RawQuery = query.Encode()
	return postgresURL.String()
}

func stringEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
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

func int32Env(key string, fallback int32) int32 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil || parsed < 0 {
		return fallback
	}
	return int32(parsed)
}

func msEnv(key string, fallback int) time.Duration {
	value := intEnv(key, fallback)
	if value <= 0 {
		value = fallback
	}
	return time.Duration(value) * time.Millisecond
}

func secondsEnv(key string, fallback int) time.Duration {
	value := intEnv(key, fallback)
	if value <= 0 {
		value = fallback
	}
	return time.Duration(value) * time.Second
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
