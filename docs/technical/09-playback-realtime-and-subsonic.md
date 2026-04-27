# Playback, Realtime, and Subsonic

## Listen playback architecture

Playback is a defining subsystem of `app/listen`, not a peripheral utility.

The central public coordinator is still
`app/listen/src/contexts/PlayerContext.tsx`, but it is no longer the only place
where player logic lives.

The player is built around these ideas:

- one queue model owned by React
- one real audio engine
- explicit playback persistence
- explicit interruption/recovery logic
- rich play-event telemetry rather than the old lightweight history writes

## Audio engine

The active engine wrapper is `app/listen/src/lib/gapless-player.ts`, wrapping
the vendored Gapless-5 fork in `app/listen/src/lib/gapless5/`.

Responsibilities include:

- initialize the engine once
- manage queue loading and current-track handoff
- configure crossfade
- expose time/duration/buffering state
- expose analyser/output-chain hooks for visualizer and EQ
- support fade helpers and engine sync with React state

## PlayerContext today

`PlayerContext.tsx` still exports the public player contract used by the rest of
Listen, but much of the implementation has moved into focused hooks.

Important internal concerns now include:

- runtime state
- engine callbacks
- engine/React synchronization
- queue mutation and navigation
- persistence/restore
- playback intelligence
- auth/user-change synchronization
- soft interruption recovery
- play-event tracking

That means the architectural direction is now “provider as orchestrator” rather
than “one file owns every playback branch directly”.

## Playback persistence and recovery

Listen persists enough state to continue a session after reload:

- queue
- current index
- current time
- playing flag
- shuffle/repeat state
- unshuffled baseline queue

It also distinguishes:

- explicit user pause
- soft interruption due to buffering/network/server conditions

The recovery logic probes and resumes instead of hard-resetting playback where
possible.

## Equalizer and visualizer

Listen still ships:

- a 10-band equalizer
- adaptive/genre-aware EQ behavior
- a visualizer fed from the engine's analyser node

Those features sit on top of the same engine/runtime split rather than being
page-local UI tricks.

## Listening telemetry

The most important current change is telemetry.

### Canonical write path

Listen now records playback through:

- `POST /api/me/play-events`

The client emits:

- timing window (`started_at`, `ended_at`)
- `played_seconds`
- completion/skip semantics
- playback source metadata
- device/app metadata
- optional `client_event_id` for idempotent retry

`use-play-event-tracker.ts` owns session rotation and event emission, while
`play-event-queue.ts` persists failed writes locally and retries them with
backoff.

### Canonical backend truth

On the server:

- `user_play_events` is the source of truth
- `client_event_id` is unique per user when present
- stats recompute is queued asynchronously
- scrobbling is queued asynchronously after commit
- domain events such as `user.play_event.recorded` and
  `user.listening_aggregates.updated` drive snapshot warming

The old `/api/me/history` path is now deprecated compatibility only.

## Realtime surfaces

Crate uses several realtime mechanisms:

### Classic SSE feeds

- `/api/events`
- `/api/events/task/{task_id}`

### Replayable invalidation feed

- `/api/cache/events`

This feed supports `Last-Event-ID` replay and is used by authenticated clients
to invalidate local caches.

### Snapshot-driven feeds

- `/api/me/home/discovery-stream`
- admin snapshot/event streams

These exist because complex UI surfaces are now built on warmed snapshots/read
models rather than ad hoc polling everywhere.

## Subsonic compatibility

`app/crate/api/subsonic.py` exposes the parallel Open Subsonic-compatible API
under `/rest`.

This lets Crate serve external clients while still keeping Listen's richer
native API and playback model.
