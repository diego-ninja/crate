package routes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
	"github.com/thecrateapp/crate/app/readplane/internal/redisx"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

type Server struct {
	cfg       config.Config
	pool      *pgxpool.Pool
	redis     *redis.Client
	auth      *auth.Authenticator
	catalog   *catalog.Store
	snapshots *snapshots.Store
	fallback  *httpx.FallbackProxy
	logger    *slog.Logger
}

func NewServer(
	cfg config.Config,
	pool *pgxpool.Pool,
	redisClient *redis.Client,
	authenticator *auth.Authenticator,
	catalogStore *catalog.Store,
	snapshotStore *snapshots.Store,
	fallback *httpx.FallbackProxy,
	logger *slog.Logger,
) *Server {
	return &Server{
		cfg:       cfg,
		pool:      pool,
		redis:     redisClient,
		auth:      authenticator,
		catalog:   catalogStore,
		snapshots: snapshotStore,
		fallback:  fallback,
		logger:    logger,
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.route(http.MethodGet, s.healthz))
	mux.HandleFunc("/readyz", s.route(http.MethodGet, s.readyz))
	mux.HandleFunc("/api/auth/me", s.route(http.MethodGet, s.authMe))
	mux.HandleFunc("/api/me", s.route(http.MethodGet, s.myLibraryRoute))
	mux.HandleFunc("/api/me/home/hero", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/recently-played", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/mixes", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/suggested-albums", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/recommended-tracks", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/radio-stations", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/favorite-artists", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/essentials", s.route(http.MethodGet, s.homeSlice))
	mux.HandleFunc("/api/me/home/discovery", s.route(http.MethodGet, s.homeDiscovery))
	mux.HandleFunc("/api/me/home/discovery-stream", s.route(http.MethodGet, s.homeDiscoveryStream))
	mux.HandleFunc("/api/me/albums", s.route(http.MethodGet, s.myAlbumsRoute))
	mux.HandleFunc("/api/me/follows", s.route(http.MethodGet, s.myFollowsRoute))
	mux.HandleFunc("/api/me/follows/", s.route(http.MethodGet, s.myFollowStateRoute))
	mux.HandleFunc("/api/me/history", s.route(http.MethodGet, s.myHistoryRoute))
	mux.HandleFunc("/api/me/likes", s.route(http.MethodGet, s.myLikesRoute))
	mux.HandleFunc("/api/cache/events", s.route(http.MethodGet, s.cacheEvents))
	mux.HandleFunc("/api/favorites", s.route(http.MethodGet, s.favoritesRoute))
	mux.HandleFunc("/api/genres", s.route(http.MethodGet, s.genresRoute))
	mux.HandleFunc("/api/genres/", s.route(http.MethodGet, s.genresRoute))
	mux.HandleFunc("/api/search", s.route(http.MethodGet, s.searchRoute))
	mux.HandleFunc("/api/albums/", s.route(http.MethodGet, s.albumRoute))
	mux.HandleFunc("/api/artist-slugs/", s.route(http.MethodGet, s.artistSlugRoute))
	mux.HandleFunc("/api/artists/", s.route(http.MethodGet, s.artistRoute))
	mux.HandleFunc("/api/tracks/", s.route(http.MethodGet, s.trackRoute))
	return s.withCommonHeaders(s.withAccessLog(mux))
}

type handlerFunc func(http.ResponseWriter, *http.Request)

func (s *Server) route(method string, handler handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			if s.fallback != nil && strings.HasPrefix(r.URL.Path, "/api/") && s.fallback.ServeHTTP(w, r) {
				return
			}
			httpx.MarkReadplane(w, "miss")
			httpx.WriteError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		handler(w, r)
	}
}

func (s *Server) withCommonHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.MarkVersion(w, s.cfg.Version)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		s.logger.Info(
			"readplane request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"route_source", recorder.Header().Get("X-Crate-Readplane"),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	httpx.MarkReadplane(w, "hit")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"service": "crate-readplane",
		"version": s.cfg.Version,
	})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := postgres.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()

	details := map[string]any{"postgres": false, "redis": nil, "schema": false}
	if err := s.pool.Ping(ctx); err != nil {
		httpx.MarkReadplane(w, "miss")
		details["error"] = err.Error()
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "details": details})
		return
	}
	details["postgres"] = true
	if err := postgres.RequiredTablesReady(ctx, s.pool); err != nil {
		httpx.MarkReadplane(w, "miss")
		details["error"] = err.Error()
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "details": details})
		return
	}
	details["schema"] = true

	if s.cfg.EnableSSE {
		details["redis"] = false
		if s.redis == nil {
			httpx.MarkReadplane(w, "miss")
			details["error"] = "redis client is nil"
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "details": details})
			return
		}
		if err := redisx.Ping(ctx, s.redis); err != nil {
			httpx.MarkReadplane(w, "miss")
			details["error"] = err.Error()
			httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "details": details})
			return
		}
		details["redis"] = true
	}

	httpx.MarkReadplane(w, "hit")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "details": details})
}

func (s *Server) authMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.auth.Authenticate(r, false)
	if err != nil {
		s.fallbackOrAuthError(w, r, err)
		return
	}
	httpx.MarkReadplane(w, "hit")
	httpx.WriteJSON(w, http.StatusOK, user)
}

func (s *Server) homeDiscovery(w http.ResponseWriter, r *http.Request) {
	user, err := s.auth.Authenticate(r, false)
	if err != nil {
		s.fallbackOrAuthError(w, r, err)
		return
	}
	if r.URL.Query().Get("fresh") == "1" {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Fresh home discovery requires FastAPI fallback")
		return
	}
	row, err := s.snapshots.Get(r.Context(), "home:discovery", strconv.FormatInt(user.ID, 10))
	if err != nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		status := http.StatusServiceUnavailable
		detail := "Home discovery snapshot unavailable"
		if errors.Is(err, snapshots.ErrNotFound) {
			status = http.StatusNotFound
			detail = "Home discovery snapshot not found"
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, status, detail)
		return
	}
	httpx.MarkReadplane(w, "hit")
	httpx.WriteJSON(w, http.StatusOK, homeDiscoveryHTTPPayload(row))
}

func (s *Server) homeDiscoveryStream(w http.ResponseWriter, r *http.Request) {
	user, err := s.auth.Authenticate(r, true)
	if err != nil {
		s.fallbackOrAuthError(w, r, err)
		return
	}
	if !s.cfg.EnableSSE || s.redis == nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane SSE is disabled")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusInternalServerError, "Streaming is not supported")
		return
	}

	subjectKey := strconv.FormatInt(user.ID, 10)
	if r.URL.Query().Get("initial") != "0" {
		if _, err := s.snapshots.Get(r.Context(), "home:discovery", subjectKey); err != nil && s.fallback.ServeHTTP(w, r) {
			return
		}
	}

	channel := redisx.SnapshotChannel("home:discovery", subjectKey)
	pubsub := s.redis.Subscribe(r.Context(), channel)
	defer pubsub.Close()
	if _, err := pubsub.Receive(r.Context()); err != nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane SSE subscription failed")
		return
	}

	httpx.MarkReadplane(w, "hit")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if r.URL.Query().Get("initial") != "0" {
		s.writeSnapshotEvent(r.Context(), w, subjectKey, false)
		flusher.Flush()
	}

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()
	messages := pubsub.Channel()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_ = writeSSE(w, "heartbeat", map[string]any{"ts": time.Now().Unix()})
			_, _ = w.Write([]byte(": heartbeat\n\n"))
			flusher.Flush()
		case _, ok := <-messages:
			if !ok {
				return
			}
			s.writeSnapshotEvent(r.Context(), w, subjectKey, true)
			flusher.Flush()
		}
	}
}

func (s *Server) writeSnapshotEvent(ctx context.Context, w http.ResponseWriter, subjectKey string, fresh bool) {
	getSnapshot := s.snapshots.Get
	if fresh {
		getSnapshot = s.snapshots.GetFresh
	}
	row, err := getSnapshot(ctx, "home:discovery", subjectKey)
	if err != nil {
		s.logger.Warn("failed to reload home discovery snapshot", "error", err, "subject_key", subjectKey)
		return
	}
	payload, err := json.Marshal(row.DecoratedPayload())
	if err != nil {
		s.logger.Warn("failed to encode home discovery snapshot", "error", err, "subject_key", subjectKey)
		return
	}
	_, _ = w.Write([]byte("data: "))
	_, _ = w.Write(payload)
	_, _ = w.Write([]byte("\n\n"))
}

func writeSSE(w http.ResponseWriter, event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if event != "" {
		if _, err := w.Write([]byte("event: " + event + "\n")); err != nil {
			return err
		}
	}
	if _, err := w.Write([]byte("data: ")); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	_, err = w.Write([]byte("\n\n"))
	return err
}

func (s *Server) fallbackOrAuthError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, auth.ErrUnauthorized) {
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	if s.fallback.ServeHTTP(w, r) {
		return
	}
	httpx.MarkReadplane(w, "miss")
	httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane authentication unavailable")
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.redis != nil {
		if err := s.redis.Close(); err != nil {
			s.logger.Warn("failed to close redis", "error", err)
		}
	}
	if s.pool != nil {
		s.pool.Close()
	}
	return nil
}
