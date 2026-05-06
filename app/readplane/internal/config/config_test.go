package config

import (
	"testing"
	"time"
)

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("READPLANE_ADDR", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("JWT_SECRET", "")

	cfg := Load("test")

	if cfg.Addr != defaultAddr {
		t.Fatalf("Addr = %q, want %q", cfg.Addr, defaultAddr)
	}
	if cfg.RedisURL != defaultRedisURL {
		t.Fatalf("RedisURL = %q, want %q", cfg.RedisURL, defaultRedisURL)
	}
	if cfg.QueryTimeout != defaultQueryTimeoutMS*time.Millisecond {
		t.Fatalf("QueryTimeout = %s", cfg.QueryTimeout)
	}
	if !cfg.Enabled {
		t.Fatal("Enabled should default to true")
	}
	if !cfg.FallbackEnabled {
		t.Fatal("FallbackEnabled should default to true")
	}
}

func TestLoadParsesOverrides(t *testing.T) {
	t.Setenv("READPLANE_ADDR", ":9999")
	t.Setenv("READPLANE_ENABLED", "false")
	t.Setenv("READPLANE_MAX_DB_CONNS", "3")
	t.Setenv("READPLANE_QUERY_TIMEOUT_MS", "1500")
	t.Setenv("READPLANE_ENABLE_SSE", "0")
	t.Setenv("READPLANE_FALLBACK_ENABLED", "yes")

	cfg := Load("test")

	if cfg.Addr != ":9999" {
		t.Fatalf("Addr = %q", cfg.Addr)
	}
	if cfg.Enabled {
		t.Fatal("Enabled should parse false")
	}
	if cfg.MaxDBConns != 3 {
		t.Fatalf("MaxDBConns = %d", cfg.MaxDBConns)
	}
	if cfg.QueryTimeout != 1500*time.Millisecond {
		t.Fatalf("QueryTimeout = %s", cfg.QueryTimeout)
	}
	if cfg.EnableSSE {
		t.Fatal("EnableSSE should parse false")
	}
	if !cfg.FallbackEnabled {
		t.Fatal("FallbackEnabled should parse yes")
	}
}

func TestLoadBuildsDatabaseURLFromCratePostgresEnv(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("CRATE_POSTGRES_USER", "crate")
	t.Setenv("CRATE_POSTGRES_PASSWORD", "p@ss word")
	t.Setenv("CRATE_POSTGRES_HOST", "crate-postgres")
	t.Setenv("CRATE_POSTGRES_PORT", "5544")
	t.Setenv("CRATE_POSTGRES_DB", "crate_prod")

	cfg := Load("test")

	want := "postgresql://crate:p%40ss%20word@crate-postgres:5544/crate_prod?sslmode=disable"
	if cfg.DatabaseURL != want {
		t.Fatalf("DatabaseURL = %q, want %q", cfg.DatabaseURL, want)
	}
}

func TestLoadPrefersExplicitDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://explicit/db")
	t.Setenv("CRATE_POSTGRES_USER", "crate")
	t.Setenv("CRATE_POSTGRES_HOST", "crate-postgres")
	t.Setenv("CRATE_POSTGRES_DB", "crate")

	cfg := Load("test")

	if cfg.DatabaseURL != "postgresql://explicit/db" {
		t.Fatalf("DatabaseURL = %q", cfg.DatabaseURL)
	}
}
