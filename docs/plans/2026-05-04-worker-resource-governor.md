# Worker Resource Governor Plan

## Context

Production became slow after database migrations because background work was allowed to compete directly with the API, PostgreSQL and Listen playback. The immediate symptom was high load on a 4 core host, full swap, high IO wait, long API response times and `fpcalc` subprocesses reading FLAC files from the main worker while repair and pipeline tasks were running.

The problem is not the existence of workers. The problem is that one worker process currently owns too many responsibilities and does not have enough back-pressure.

## Goals

- Keep Listen and Admin responsive while background maintenance is running.
- Prevent repair, sync, fingerprinting, analysis and exports from saturating disk IO.
- Separate interactive playback work from batch work.
- Make heavy work observable and deferrable.
- Keep clean installs and small self-hosted servers safe by default.

## Design

### 1. Split worker responsibilities

Keep `crate-worker` as the operational coordinator, but stop using it as the place where every heavy workload runs.

- `crate-worker`: scheduler, watcher, projector, fast/default tasks.
- `crate-maintenance-worker`: repair, library pipeline, full sync and rich export.
- `crate-analysis-worker`: audio analysis, bliss and audio fingerprint backfills.
- `crate-playback-worker`: playback stream variants only.

More containers do not necessarily mean more load. Idle containers are cheap. The important part is that each service has lower process counts, narrower queues and explicit CPU/memory limits. The main risk is accidentally starting duplicate service loops or daemons, so specialized workers must use `--no-service-loop`, `--no-daemons`, `--no-projector` and `--no-telegram` intentionally.

Legacy `migrate_storage_v2` and `verify_storage_v2` are no longer part of the normal operating model now that entity UUIDs are canonical. `fix_artist` remains valid because it repairs a concrete artist tree using entity UUIDs, but it should stay explicit/per-artist rather than running as a global automatic repair.

Specialized workers should also use smaller PostgreSQL pools than the API/coordinator so splitting containers does not multiply idle database connections.

### 2. Add a Resource Governor

Add a shared runtime gate for batch work. It should check:

- active listening users
- active streams
- load average relative to CPU count
- IO wait
- swap pressure

When pressure is high, scheduled or background work should defer itself instead of starting. Long-running handlers should also re-check between items.

By default, active Listen playback is treated as pressure. Operators can loosen that with `CRATE_RESOURCE_MAX_ACTIVE_USERS` and `CRATE_RESOURCE_MAX_ACTIVE_STREAMS` if they want limited batch work during light usage.

Full-library batch work is also constrained by `CRATE_MAINTENANCE_WINDOW_ENABLED`, `CRATE_MAINTENANCE_WINDOW_START` and `CRATE_MAINTENANCE_WINDOW_END` in production. Scoped work such as watcher-triggered album syncs and explicit per-artist/per-album actions can still run outside the window when the server is otherwise healthy.

### 3. Move fingerprinting out of sync

`LibrarySync` must not compute audio fingerprints inline. Sync should read tags and cheap media info, then leave missing fingerprints as pending. A dedicated fingerprint backfill task will compute them later under Resource Governor control.

### 4. Lower process priority for audio subprocesses

Wrap `fpcalc` and fallback `ffmpeg` fingerprint commands with `nice` and `ionice` when available. This does not replace real gating, but it reduces damage when work is allowed to run.

### 5. Make scheduled pipeline safer

The default `library_pipeline` cadence should be reduced and gated. Health checks can run more often, but repair/full sync should be treated as maintenance work and deferred when the server is busy.

### 6. Improve observability

System Health should expose:

- current resource pressure state
- reason heavy work is paused
- maintenance window status
- resource deferral metrics
- running heavy tasks
- worker queue breakdown by lane
- IO/swap/load status

## Implementation Order

1. Add this plan document.
2. Add `crate.resource_governor`.
3. Apply the governor to scheduled heavy tasks and Dramatiq task start.
4. Remove inline fingerprint computation from `LibrarySync`.
5. Apply governor and low-priority subprocess execution to fingerprint backfill.
6. Split worker services in Docker Compose.
7. Add focused tests for sync behavior and governor deferral.
8. Add Admin/System Health visibility.

## Open Follow-ups

- Decide whether `library_pipeline` should be disabled by default and replaced by explicit nightly maintenance.
- Consider a separate DB connection role or pool for maintenance.
- Consider host-level IO controls if the production kernel/cgroup setup supports them reliably.
