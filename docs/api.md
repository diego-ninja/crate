# API Notes

This page is a high-level orientation, not a full endpoint inventory.

The authoritative contract is:

- the live OpenAPI schema at `/openapi.json`
- the Scalar reference app in `app/reference/`

Crate has grown past the point where a handwritten endpoint table stays
accurate for long. This note exists to explain the major API surfaces and the
auth/runtime patterns behind them.

## Base structure

- Native API base path: `/api`
- Open Subsonic compatibility layer: `/rest`
- API process mounts `/music` read-only
- Filesystem writes are always delegated to the worker

## Auth model

Crate serves two first-party apps with slightly different auth behavior:

- **Admin UI** primarily uses persisted sessions and cookies.
- **Listen Web** also uses persisted sessions, but identifies itself with a
  different app header/cookie name so web listen and admin can coexist cleanly.
- **Listen Capacitor** uses bearer tokens stored per configured server.

The backend therefore supports:

- password login
- Google OAuth
- Apple OAuth
- persisted session rows
- bearer-token auth for native clients
- session listing, revocation, and heartbeat endpoints

## Major route families

### User/listening product

- `/api/me/*`
- `/api/social/*`
- `/api/playlists/*`
- `/api/jam/*`
- `/api/radio/*`

This is where home discovery, likes, follows, saved albums, listening stats,
play events, social profiles, jam rooms, and user-facing playlist flows live.

### Admin and operations

- `/api/admin/*`
- `/api/tasks/*`
- `/api/settings/*`
- `/api/scanner/*`
- `/api/stack/*`
- `/api/acquisition/*`
- `/api/enrichment/*`

These routes drive the operator-facing dashboard, tasks, scans, repairs,
acquisition, stack controls, and settings.

### Browse and media retrieval

- browse artist/album/track endpoints
- search and explore endpoints
- artwork and stream delivery
- lyrics and ancillary media lookups

### Compatibility

- `/rest/*` exposes the Open Subsonic-style surface used by third-party clients
  such as Symfonium and Ultrasonic.

## Realtime surfaces

Crate mixes classic SSE feeds with snapshot-driven read models.

### Pub/sub style feeds

- `/api/events`
- `/api/events/task/{task_id}`

These are ideal for task activity and lightweight global status updates.

### Replayable invalidation feed

- `/api/cache/events`

This stream is backed by Redis with monotonic IDs and supports replay through
`Last-Event-ID`.

### Snapshot-driven SSE feeds

- `/api/admin/ops-stream`
- `/api/admin/tasks-stream`
- `/api/admin/health-stream`
- `/api/admin/logs-stream`
- `/api/admin/stack-stream`
- `/api/me/home/discovery-stream`

These surfaces exist because the backend now keeps persisted or runtime-backed
read models warm rather than recomputing everything on every client poll.

## Eventing and snapshots

The API no longer relies on cache invalidation alone for complex UI surfaces.
Important backend changes now flow through:

- replayable cache invalidation events
- Redis Streams domain events
- persisted UI snapshots in PostgreSQL
- runtime ops state and read models

That means several HTTP responses are best understood as views over warmed read
models, not direct live SQL assembly inside the route handler.

## Listening telemetry

The canonical telemetry write path is now:

- `POST /api/me/play-events`

Key properties:

- rich payloads with timing/context fields
- optional `client_event_id` for idempotent retries
- persisted to `user_play_events`
- follow-up stats recompute and scrobble happen asynchronously

The legacy `POST /api/me/history` endpoint still exists only as a deprecated
compatibility path and should not be treated as the primary source of truth.
