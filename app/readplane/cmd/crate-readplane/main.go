package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
	"github.com/thecrateapp/crate/app/readplane/internal/redisx"
	"github.com/thecrateapp/crate/app/readplane/internal/routes"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

var version = "dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := config.Load(version)
	if !cfg.Enabled {
		logger.Warn("READPLANE_ENABLED=false; service still starting for health checks")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Connect(ctx, cfg)
	if err != nil {
		logger.Error("failed to connect postgres", "error", err)
		os.Exit(1)
	}

	var redisClient = mustRedis(ctx, cfg, logger)
	fallback, err := httpx.NewFallbackProxy(cfg.FallbackEnabled, cfg.APIBase, cfg.Version)
	if err != nil {
		logger.Error("failed to configure fallback proxy", "error", err)
		os.Exit(1)
	}

	authenticator := auth.NewAuthenticator(pool, cfg.JWTSecret, cfg.QueryTimeout)
	catalogStore := catalog.NewStore(pool, cfg.QueryTimeout)
	snapshotStore := snapshots.NewStore(pool, cfg.QueryTimeout, cfg.SnapshotMaxAge, cfg.StaleMaxAge)
	server := routes.NewServer(cfg, pool, redisClient, authenticator, catalogStore, snapshotStore, fallback, logger)

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("crate-readplane listening", "addr", cfg.Addr, "version", cfg.Version)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Warn("http shutdown failed", "error", err)
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Warn("readplane shutdown failed", "error", err)
	}
}

func mustRedis(ctx context.Context, cfg config.Config, logger *slog.Logger) *redis.Client {
	if !cfg.EnableSSE {
		return nil
	}
	client, err := redisx.Connect(cfg.RedisURL)
	if err != nil {
		logger.Error("failed to configure redis", "error", err)
		os.Exit(1)
	}
	pingCtx, cancel := context.WithTimeout(ctx, cfg.QueryTimeout)
	defer cancel()
	if err := redisx.Ping(pingCtx, client); err != nil {
		logger.Warn("redis ping failed during startup; readiness will stay unhealthy until it recovers", "error", err)
	}
	return client
}
