package routes

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

type homeSliceDef struct {
	payloadKey string
	wrapItems  bool
}

var homeSliceRoutes = map[string]homeSliceDef{
	"/api/me/home/hero":               {payloadKey: "hero"},
	"/api/me/home/recently-played":    {payloadKey: "recently_played", wrapItems: true},
	"/api/me/home/mixes":              {payloadKey: "custom_mixes", wrapItems: true},
	"/api/me/home/suggested-albums":   {payloadKey: "suggested_albums", wrapItems: true},
	"/api/me/home/recommended-tracks": {payloadKey: "recommended_tracks", wrapItems: true},
	"/api/me/home/radio-stations":     {payloadKey: "radio_stations", wrapItems: true},
	"/api/me/home/favorite-artists":   {payloadKey: "favorite_artists", wrapItems: true},
	"/api/me/home/essentials":         {payloadKey: "essentials", wrapItems: true},
}

func (s *Server) homeSlice(w http.ResponseWriter, r *http.Request) {
	def, ok := homeSliceRoutes[r.URL.Path]
	if !ok {
		s.fallbackOrRouteMiss(w, r)
		return
	}
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
		httpx.WriteError(w, http.StatusServiceUnavailable, "Fresh home slice requires FastAPI fallback")
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
	httpx.WriteJSON(w, http.StatusOK, homeSlicePayload(row, def))
}

func homeSlicePayload(row *snapshots.Row, def homeSliceDef) any {
	value := snapshotsValue(row.Payload[def.payloadKey])
	if !def.wrapItems {
		return value
	}
	if value == nil {
		value = []any{}
	}
	return map[string]any{"items": value}
}

func snapshotsValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			out[key] = snapshotsValue(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, item := range typed {
			out[index] = snapshotsValue(item)
		}
		return out
	default:
		return typed
	}
}
