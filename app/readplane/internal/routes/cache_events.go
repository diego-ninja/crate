package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/diego-ninja/crate/app/readplane/internal/auth"
	"github.com/diego-ninja/crate/app/readplane/internal/httpx"
)

const (
	cacheEventsKey      = "cache:invalidation:events"
	cacheEventIDKey     = "cache:invalidation:next_id"
	cacheLiveChannel    = "crate:sse:cache-invalidation"
	cacheHeartbeatEvery = 30 * time.Second
)

type cacheInvalidationEvent struct {
	ID    int64   `json:"id"`
	Scope string  `json:"scope"`
	TS    float64 `json:"ts"`
}

func (s *Server) cacheEvents(w http.ResponseWriter, r *http.Request) {
	if s.redis == nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane cache SSE is disabled")
		return
	}
	if _, err := s.auth.Authenticate(r, true); err != nil {
		if errors.Is(err, auth.ErrUnauthorized) {
			httpx.MarkReadplane(w, "miss")
			httpx.WriteError(w, http.StatusUnauthorized, "Not authenticated")
			return
		}
		s.fallbackOrAuthError(w, r, err)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusInternalServerError, "Streaming is not supported")
		return
	}

	lastEventID, ok := parseLastEventID(r.Header.Get("Last-Event-ID"))
	if !ok {
		latest, err := s.latestCacheEventID(r.Context())
		if err != nil {
			if s.fallback.ServeHTTP(w, r) {
				return
			}
			httpx.MarkReadplane(w, "miss")
			httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane cache replay unavailable")
			return
		}
		lastEventID = latest
	}

	pubsub := s.redis.Subscribe(r.Context(), cacheLiveChannel)
	defer pubsub.Close()
	if _, err := pubsub.Receive(r.Context()); err != nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane cache SSE subscription failed")
		return
	}

	missed, err := s.cacheEventsSince(r.Context(), lastEventID)
	if err != nil {
		if s.fallback.ServeHTTP(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Readplane cache replay unavailable")
		return
	}

	httpx.MarkReadplane(w, "hit")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	for _, event := range missed {
		if writeCacheInvalidationSSE(w, event) == nil {
			lastEventID = event.ID
		}
	}
	flusher.Flush()

	heartbeat := time.NewTicker(cacheHeartbeatEvery)
	defer heartbeat.Stop()
	messages := pubsub.Channel()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_ = writeSSE(w, "heartbeat", map[string]any{"ts": float64(time.Now().UnixNano()) / 1e9})
			_, _ = w.Write([]byte(": heartbeat\n\n"))
			flusher.Flush()
		case message, ok := <-messages:
			if !ok {
				return
			}
			event, ok := parseCacheInvalidationEvent(message.Payload)
			if !ok || event.ID <= lastEventID {
				continue
			}
			if err := writeCacheInvalidationSSE(w, event); err != nil {
				return
			}
			lastEventID = event.ID
			flusher.Flush()
		}
	}
}

func (s *Server) cacheEventsSince(ctx context.Context, lastID int64) ([]cacheInvalidationEvent, error) {
	rawEvents, err := s.redis.LRange(ctx, cacheEventsKey, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	events := make([]cacheInvalidationEvent, 0, len(rawEvents))
	for index := len(rawEvents) - 1; index >= 0; index-- {
		event, ok := parseCacheInvalidationEvent(rawEvents[index])
		if ok && event.ID > lastID {
			events = append(events, event)
		}
	}
	return events, nil
}

func (s *Server) latestCacheEventID(ctx context.Context) (int64, error) {
	value, err := s.redis.Get(ctx, cacheEventIDKey).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return 0, nil
		}
		return 0, err
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < 0 {
		return 0, nil
	}
	return parsed, nil
}

func parseCacheInvalidationEvent(raw string) (cacheInvalidationEvent, bool) {
	var event cacheInvalidationEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		return cacheInvalidationEvent{}, false
	}
	if event.ID <= 0 || strings.TrimSpace(event.Scope) == "" {
		return cacheInvalidationEvent{}, false
	}
	event.Scope = strings.TrimSpace(event.Scope)
	return event, true
}

func writeCacheInvalidationSSE(w http.ResponseWriter, event cacheInvalidationEvent) error {
	if _, err := w.Write([]byte("id: " + strconv.FormatInt(event.ID, 10) + "\n")); err != nil {
		return err
	}
	if _, err := w.Write([]byte("data: " + event.Scope + "\n\n")); err != nil {
		return err
	}
	return nil
}

func parseLastEventID(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}
