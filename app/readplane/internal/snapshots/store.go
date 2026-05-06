package snapshots

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/diego-ninja/crate/app/readplane/internal/postgres"
)

var ErrNotFound = errors.New("snapshot not found")

const defaultCacheTTL = 2 * time.Second

type SnapshotMeta struct {
	Scope        string     `json:"scope"`
	SubjectKey   string     `json:"subject_key"`
	Version      int64      `json:"version"`
	BuiltAt      time.Time  `json:"built_at"`
	SourceSeq    int64      `json:"source_seq"`
	StaleAfter   *time.Time `json:"stale_after"`
	Stale        bool       `json:"stale"`
	GenerationMS int64      `json:"generation_ms"`
}

type Row struct {
	Payload map[string]any
	Meta    SnapshotMeta
}

type Store struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
	maxAge       time.Duration
	staleMaxAge  time.Duration
	cacheTTL     time.Duration
	mu           sync.RWMutex
	cache        map[string]cacheEntry
}

type cacheEntry struct {
	row       *Row
	expiresAt time.Time
}

func NewStore(pool *pgxpool.Pool, queryTimeout time.Duration, maxAge time.Duration, staleMaxAge time.Duration) *Store {
	return &Store{
		pool:         pool,
		queryTimeout: queryTimeout,
		maxAge:       maxAge,
		staleMaxAge:  staleMaxAge,
		cacheTTL:     defaultCacheTTL,
		cache:        make(map[string]cacheEntry),
	}
}

func (s *Store) Get(ctx context.Context, scope string, subjectKey string) (*Row, error) {
	return s.get(ctx, scope, subjectKey, false)
}

func (s *Store) GetFresh(ctx context.Context, scope string, subjectKey string) (*Row, error) {
	return s.get(ctx, scope, subjectKey, true)
}

func (s *Store) get(ctx context.Context, scope string, subjectKey string, bypassCache bool) (*Row, error) {
	key := cacheKey(scope, subjectKey)
	now := time.Now()
	if !bypassCache {
		if row := s.cacheGet(key, now); row != nil {
			return row, nil
		}
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	const query = `
		SELECT scope, subject_key, version, payload_json, built_at, source_seq, generation_ms, stale_after
		FROM ui_snapshots
		WHERE scope = $1 AND subject_key = $2
		LIMIT 1
	`
	var payloadBytes []byte
	var sourceSeq sql.NullInt64
	var staleAfter sql.NullTime
	row := Row{}
	if err := s.pool.QueryRow(queryCtx, query, scope, subjectKey).Scan(
		&row.Meta.Scope,
		&row.Meta.SubjectKey,
		&row.Meta.Version,
		&payloadBytes,
		&row.Meta.BuiltAt,
		&sourceSeq,
		&row.Meta.GenerationMS,
		&staleAfter,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if sourceSeq.Valid {
		row.Meta.SourceSeq = sourceSeq.Int64
	}
	if staleAfter.Valid {
		row.Meta.StaleAfter = &staleAfter.Time
	}

	stale, usable := SnapshotFreshness(row.Meta.BuiltAt, row.Meta.StaleAfter, now, s.maxAge, s.staleMaxAge)
	if !usable {
		return nil, ErrNotFound
	}
	row.Meta.Stale = stale

	payload, err := DecodePayload(payloadBytes)
	if err != nil {
		return nil, err
	}
	row.Payload = payload
	s.cacheSet(key, &row, now)
	return &row, nil
}

func cacheKey(scope string, subjectKey string) string {
	return scope + "\x00" + subjectKey
}

func (s *Store) cacheGet(key string, now time.Time) *Row {
	if s.cacheTTL <= 0 {
		return nil
	}
	s.mu.RLock()
	entry, ok := s.cache[key]
	s.mu.RUnlock()
	if !ok || !entry.expiresAt.After(now) {
		if ok {
			s.mu.Lock()
			if current, exists := s.cache[key]; exists && !current.expiresAt.After(now) {
				delete(s.cache, key)
			}
			s.mu.Unlock()
		}
		return nil
	}
	return cloneRow(entry.row)
}

func (s *Store) cacheSet(key string, row *Row, now time.Time) {
	if s.cacheTTL <= 0 {
		return
	}
	s.mu.Lock()
	s.cache[key] = cacheEntry{row: cloneRow(row), expiresAt: now.Add(s.cacheTTL)}
	s.mu.Unlock()
}

func cloneRow(row *Row) *Row {
	if row == nil {
		return nil
	}
	clone := *row
	clone.Payload = cloneMap(row.Payload)
	return &clone
}

func (r Row) DecoratedPayload() map[string]any {
	payload := cloneMap(r.Payload)
	payload["snapshot"] = r.Meta
	return payload
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = cloneValue(value)
	}
	return output
}

func cloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneMap(typed)
	case []any:
		output := make([]any, len(typed))
		for index, item := range typed {
			output[index] = cloneValue(item)
		}
		return output
	default:
		return typed
	}
}

func DecodePayload(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode snapshot payload: %w", err)
		}
		return map[string]any{"value": value}, nil
	}
	if payload == nil {
		return map[string]any{}, nil
	}
	return payload, nil
}

func SnapshotFreshness(
	builtAt time.Time,
	staleAfter *time.Time,
	now time.Time,
	maxAge time.Duration,
	staleMaxAge time.Duration,
) (stale bool, usable bool) {
	if builtAt.IsZero() {
		return false, false
	}
	if maxAge <= 0 {
		maxAge = 10 * time.Minute
	}
	if staleMaxAge <= 0 {
		staleMaxAge = time.Hour
	}
	stale = now.Sub(builtAt) > maxAge
	if staleAfter != nil && !staleAfter.IsZero() && !staleAfter.After(now) {
		stale = true
	}
	if !stale {
		return false, true
	}
	return true, now.Sub(builtAt) <= staleMaxAge
}
