# Crate Performance Pareto And Native Services Plan

Date: 2026-05-04

## Goal

Make Crate feel closer to Navidrome for the interactive paths while preserving
Crate's heavier enrichment, acquisition, analysis, lyrics, metadata, and export
features.

The key separation is:

- Interactive plane: Listen, admin navigation, playback metadata, search,
  album/artist/track views, task status. This must stay responsive.
- Batch plane: acquisition, global scans, audio analysis, bliss, metadata
  writes, lyrics sync, exports, global health checks, repairs. This can wait.

This plan is ordered by expected impact per unit of work. Native rewrites are
included only where they materially reduce CPU, memory, IO, or tail latency.

## Current Diagnosis

Crate is not slow because Python is intrinsically too slow for every path.
Crate is slow because interactive work shares a small host with heavyweight
batch work and heavyweight dependencies.

Important observations:

- The API image currently carries audio-analysis dependencies such as Essentia,
  librosa, numba, scipy, torch, and model assets that only batch workers need.
- Several admin/listen surfaces still depend on live or semi-live queries where
  precomputed read models would be safer.
- The resource governor protects the system after pressure exists, but it does
  not create hard OS/container reservations for the interactive plane.
- FFmpeg, Essentia, BLAS, NumPy, Torch, and friends can use native threads that
  bypass Python-level concurrency assumptions unless explicitly capped.
- Navidrome feels faster because its interactive surface is narrow, native,
  mostly read-only, and designed around cheap library reads.

## Success Targets

- Listen home and album view: p95 under 250 ms from API once warm.
- Playback prepare / stream metadata: p95 under 100 ms once warm.
- Admin dashboard shell: useful first data under 500 ms.
- API container steady RSS under 350-500 MB.
- Worker containers bounded by class, with no single batch worker able to force
  the host into swap.
- Heavy jobs may be delayed, but interactive navigation and playback must remain
  usable under background load.

## Phase 0: Stop The Bleeding

Expected impact: very high.
Native rewrite: none.

### 0.1 Split API Image From Worker Image

Today the API pays for dependencies that belong to audio/batch workers. Create
at least two backend images:

- `crate-api`: FastAPI, DB, Redis, auth, routing, lightweight image utilities.
- `crate-worker-heavy`: Essentia, torch, librosa, ffmpeg, chromaprint, model
  assets, acquisition tooling, tag writing.

Optional third image:

- `crate-worker-lite`: non-audio tasks such as health, metadata, snapshots,
  lyrics, MusicBrainz, Last.fm.

Why this is first:

- Reduces API memory footprint.
- Reduces API cold start and deploy pressure.
- Makes it possible to reserve memory/CPU for API without paying for ML/audio.
- Lets future services evolve without dragging the entire dependency graph.

### 0.2 Add Hard Container Resource Controls

Use Compose runtime controls, not only Python guards.

Recommended policy:

- API: protected CPU shares, memory reservation, no audio workloads.
- Listen/UI/static nginx: small but protected.
- Postgres: explicit memory budget and connection cap.
- Redis: keep current cap and eviction policy.
- Playback worker: isolated from analysis/acquisition.
- Analysis worker: low CPU shares, strict memory limit, one concurrent heavy job.
- Maintenance worker: low CPU shares, strict memory limit.

Also set native thread caps in worker containers:

```env
OMP_NUM_THREADS=1
OPENBLAS_NUM_THREADS=1
MKL_NUM_THREADS=1
NUMEXPR_NUM_THREADS=1
VECLIB_MAXIMUM_THREADS=1
TORCH_NUM_THREADS=1
NUMBA_NUM_THREADS=1
```

Why this matters:

- Python worker concurrency is not enough if NumPy/Torch/BLAS spawn threads.
- Prevents a single analysis task from saturating all cores.
- Stops batch work from pushing the whole host into swap.

### 0.3 Make Deployment Non-Disruptive

Avoid building heavyweight images on the production host during normal deploys.

Preferred path:

- GitHub Actions builds and pushes images.
- Production only pulls and restarts.
- Server-side build remains emergency-only.

Reason:

- Building the backend image downloads and installs hundreds of MB of native
  packages and models.
- On a small host, this directly competes with users.

### 0.4 Governor Policy Cleanup

Keep:

- Global scans, global health, global analysis, global metadata, exports and
  rebuilds are governed.

Allow:

- Explicit, scoped user tasks enter immediately: album enrich, artist enrich,
  scoped library sync after acquisition, small scoped fingerprint backfills,
  manual admin health checks.

The governor should be a batch scheduler, not a blanket "the app is busy" gate.

## Phase 1: Make Reads Cheap

Expected impact: very high.
Native rewrite: none initially.

### 1.1 Read-Model First Listen

Listen should read from compact snapshots/materialized views:

- home sections
- album detail
- artist detail
- queue/playback metadata
- search suggestions
- saved albums/playlists

Rules:

- No expensive joins in hot Listen navigation.
- No live enrichment dependency in user navigation.
- Payloads shaped for the screen, not generic mega-responses.
- Include lightweight version/etag fields for cache validation.

### 1.2 Admin Surface Diet

Admin can be richer, but the first screen still needs to be cheap.

Priorities:

- Dashboard from one cached surface.
- System Health from rollups, not live recomputation.
- Task lists paginated and stream-patched.
- Album/artist pages load core data first, then diagnostics lazily.

### 1.3 Query Audit By p95/p99

Instrument and rank endpoints by:

- call count
- p50/p95/p99 latency
- DB time
- rows scanned
- response size
- payload serialization time

Then fix the top 10 endpoints only. Likely fixes:

- missing indexes
- over-broad joins
- response pagination
- precomputed counts
- cached cover/thumbnail URLs
- smaller JSON payloads

### 1.4 Static Media And Cover Path

Covers and thumbnails should be nginx/static/cache friendly where possible.

Targets:

- Precompute common sizes.
- Serve with long cache headers and entity/version URLs.
- Avoid Python for hot cover paths unless extracting embedded art on demand.

## Phase 2: Native Primitives, Rust Indexer

Expected impact: high.
Language: Rust.

Build this first inside `crate-cli` as Crate's native primitive toolbox and
test harness. This phase is deliberately not a full worker rewrite. The CLI is
for bounded operations with clean JSON IO, easy benchmarking, and safe fallback
from Python. It should not become a second backend hidden behind long-running
subprocesses.

Large jobs with progress, cancellation, cache lifecycle, or backpressure should
reuse these Rust modules later from a persistent worker, not grow as one huge
CLI command.

Recommended shape:

- `crate-cli scan`: read-only filesystem scan, tags, identity tags, covers.
- `crate-cli diff`: compare two scan snapshots and emit add/remove/change/move
  facts.
- `crate-cli tags inspect`: inspect normalized tags and Crate identity tags.
- `crate-cli tags write-identity`: explicit worker-only identity tag writes.
- `crate-cli fingerprint`: compact audio/file fingerprint helpers.
- `crate-cli quality`: cheap technical media checks.

Not in Phase 2 as CLI work:

- Enriched album/track ZIP creation.
- Artwork resize/embed/extract at export scale.
- Long-running analysis or bulk mutation jobs.

Those belong in Phase 4 as a Rust media worker once the primitive modules and
contracts are stable.

Easy high-return migrations:

1. Content hashes and file-set diffs: already close to done via `scan --hash`;
   removes repeated Python tree walks from content gating.
2. Library scan/tag read: big return, low product risk if promoted through
   shadow mode first.
3. Cheap media quality probe: duration, bitrate, sample rate, bit depth, format,
   corrupt-file detection; useful for health checks without loading heavy audio
   stacks.
4. Fingerprint helpers: good return if kept compact and cancellable, especially
   for identity/rebuild flows.
5. Identity tag inspection and conservative writes: useful for recovery and
   portable metadata, but original-library writes remain worker-only and
   dry-run friendly.

Less immediate:

- Artwork/export packaging: high value, but it needs progress, cancellation,
  cache policy, and structured task events. That is worker-shaped, not CLI-shaped.
- Full audio analysis and ML mood features: worthwhile, but dependency-heavy
  and harder to ship than scan/probe primitives.
- Transcoding: keep FFmpeg; only move supervision/cache lifecycle if needed.

This keeps one native binary and one test harness for primitives without making
Rust own Crate's product logic or forcing Python to supervise heavy subprocesses
forever.

The first command behaves as a read-mostly filesystem scanner and tag reader.

Responsibilities:

- Walk `/music` efficiently.
- Read audio tags and Crate identity tags.
- Compute stable file fingerprints/hashes when needed.
- Detect added/removed/moved/changed files.
- Emit compact diffs to Postgres, Redis stream, or NDJSON consumed by Python.
- Never call external enrichment providers.
- Initially avoid mutating audio files until validated.

Why Rust:

- Excellent low-memory filesystem walking.
- Strong concurrency with explicit limits via Rayon/Tokio.
- Good audio metadata crates such as `lofty`.
- Good hashing ecosystem, e.g. `blake3`.
- Safe for long-running file processing.

What remains in Python:

- Task orchestration.
- Business policy.
- DB migrations.
- Enrichment APIs.
- Admin actions.

Boundary:

- Rust produces facts and diffs.
- Python decides what those facts mean and what tasks to enqueue.
- Rust writes only when a worker invokes an explicit mutating subcommand.
- Mutating subcommands must emit structured progress/events and support dry-run
  mode where practical.
- CLI commands should remain bounded and observable. If a command needs queue
  semantics, cancellation, incremental task events, or export cache ownership,
  promote it to the Rust media worker instead.

Expected wins:

- Faster library sync.
- Lower memory during scans.
- Less pressure on Python workers.
- More reliable reconstruction from identity tags and sidecars.

## Phase 3: Go Read Plane For Listen

Expected impact: high if Phase 1 shows FastAPI/read queries remain hot.
Language: Go.

Detailed implementation spec: `docs/plans/2026-05-05-go-read-plane-phase-3-spec.md`.

Build `crate-readplane` only if the optimized Python read model is still not
fast enough or still too memory-heavy.

Responsibilities:

- Serve Listen hot reads:
  - home
  - search
  - album
  - artist
  - playlist
  - playback metadata
- Read only from Postgres snapshots/materialized views and Redis.
- No enrichment, no writes, no filesystem mutation.
- Use the same auth/session contract, or validate via API-issued tokens.

Why Go:

- Very small memory footprint.
- Simple HTTP and Postgres services.
- Excellent operational predictability.
- Faster development than Rust for a CRUD/read API.
- Static binary deployment.

Why not Rust here first:

- Rust would also be fast, but the domain is mostly HTTP/DB/JSON.
- Go gives better speed-to-benefit for this service.

Boundary:

- FastAPI remains the control plane and write plane.
- Go read plane serves hot consumer reads.
- Snapshots/events are the contract.

## Phase 4: Native Media Worker, Not More CLI Glue

Expected impact: medium-high.
Language: Rust.

Detailed implementation spec: `docs/plans/2026-05-05-crate-media-worker-phase-4-spec.md`.

Build `crate-media-worker` as a persistent worker for media jobs that are too
large or stateful for one-off subprocess calls. It should reuse the Rust modules
proven by `crate-cli`, but own worker concerns directly: progress, cancellation,
resource limits, cache lifecycle, and structured task events.

Responsibilities:

- enriched album/track ZIP creation
- sidecar generation for exported packages
- artwork resize/embed/extract for cache/export artifacts
- lyrics and rich tag embedding for generated copies
- export cache admission, reuse, and eviction
- structured progress events that admin/listen can consume
- cancellation and cooperative backpressure

What stays in `crate-cli`:

- direct diagnostics
- one-shot inspection/probe tools
- benchmark harnesses
- small primitives used by tests and local debugging

Why Rust:

- Strong binary/file manipulation.
- Good archive/hash libraries.
- Can share tag-reading, fingerprint, and artwork code with `crate-cli`.
- Predictable memory and CPU.
- Better fit than Go for audio tag/artwork/archive internals.

Important constraint:

- Mutating original audio files remains high-risk.
- Prefer native writes first for generated/export artifacts.
- Keep original-library tag writes conservative and heavily tested.
- Python remains the task/control plane until a specific native worker proves it
  can own its queue safely.

## Phase 5: Transcode Supervisor, Not Transcoder Rewrite

Expected impact: medium.
Language: Go or Rust.

Do not rewrite transcoding itself. FFmpeg is already native and extremely good.

Build a supervisor only if needed:

- queue admission
- slot reservation
- cancellation
- HLS segment lifecycle
- CPU/IO niceness
- cache eviction
- per-track variant status
- structured progress

Language choice:

- Go if it is mostly process supervision and HTTP/control.
- Rust if it shares cache/index/media primitives with the Rust tooling.

Expected wins:

- Better reliability under load.
- Fewer orphan transcodes.
- Cleaner cache lifecycle.
- Better user-facing progress.

## Phase 6: Optional Native Projector Or Metrics Daemon

Expected impact: medium-low unless profiling proves otherwise.
Language: Go.

Only do this if Redis stream projection or metrics rollups show up in p95/p99 or
CPU profiles.

Go is a good fit for:

- Redis stream consumers.
- metric rollup daemons.
- snapshot warmers.
- small always-on services.

Do not do this before the read plane and indexer work.

## What Not To Rewrite

Avoid rewriting these early:

- FastAPI control plane.
- Admin write endpoints.
- Enrichment provider integrations.
- Task orchestration and policy.
- Alembic/DB schema management.

Reason:

- High behavior surface.
- Low performance return compared with targeted native services.
- High risk of split-brain bugs.

## Server Reality

If the host is already swapping, no language choice fully saves the product.
Rust and Go reduce overhead, but they do not make ffmpeg, Postgres, Torch,
Essentia, Redis, nginx, and multiple workers free.

Comfortable production target for 30-40 simultaneous users plus background work:

- 8 vCPU
- 16 GB RAM minimum, 32 GB comfortable if analysis/acquisition runs often
- NVMe-backed root/data volume
- media storage with predictable read latency
- no production builds on the same host during active use

Lower-cost acceptable target if batch work is aggressively scheduled:

- 4 vCPU
- 8 GB RAM
- strict worker limits
- one heavy job at a time
- prebuilt images only
- read-model-first Listen

## Pareto Order

1. Split API and worker images.
2. Add hard container resource limits and native thread caps.
3. Stop building heavy images on prod during normal deploys.
4. Make Listen/admin hot paths snapshot/read-model-first.
5. Audit and fix top p95/p99 endpoints.
6. Move library scan/tag/diff to Rust `crate-indexer`.
7. Add Go `crate-readplane` for Listen only if Python read models still miss
   latency/memory targets.
8. Move enriched exports/media packaging to Rust.
9. Add Go/Rust transcode supervisor if HLS/variant cache needs stronger
   lifecycle control.
10. Consider Go projector/metrics daemons only after profiling.

## Recommended Next Implementation Slice

Start with a non-native slice:

1. Create `requirements-api.txt`, `requirements-worker.txt`, and separate API
   and worker Dockerfiles/stages.
2. Add Compose resource limits and thread caps per worker class.
3. Add endpoint latency reporting by route with p95/p99 rollups.
4. Pick the top 5 Listen endpoints and force them through cached read models.

Then start native work:

1. Scaffold `tools/crate-indexer` in Rust.
2. Implement read-only scan and tag extraction.
3. Compare results against current Python scanner on `test-music`.
4. Run it read-only against production and compare diffs without applying.
5. Promote it to the source of filesystem diffs once stable.

Implementation note:

- The first native slice reuses the existing Rust `crate-cli scan` binary
  instead of introducing a second scanner binary immediately. It now exposes a
  structured read-only scan result and extracts Crate portable identity tags
  (`crate_artist_uid`, `crate_album_uid`, `crate_track_uid`,
  `crate_audio_fingerprint`, etc.) from audio metadata. A dedicated
  `crate-indexer` service can still be split out later once the read-only diff
  contract is stable.
- `crate-cli quality` is the second small native command. It probes technical
  audio metadata without running analysis and returns duration, bitrate,
  sample rate, bit depth, channels, file size, and per-file read errors. Python
  `read_audio_quality()` now prefers this command when available and falls back
  to Mutagen otherwise.
- Library sync now has two native scan gates. `native_scan_payload_shadow`
  compares the Rust album/track projection with the Python payload before DB
  writes and reports drift without changing behavior. `native_scan_payload_prefer`
  or `native_scan_payload_source=prefer` promotes the Rust projection only when
  that comparison is clean; otherwise the sync falls back to the Python payload.
- `crate-cli diff` is the next native indexer primitive. It compares two scan
  JSON snapshots and emits added, removed, moved, changed, and unchanged counts.
  Move detection is identity-aware, preferring Crate portable track UIDs, then
  MusicBrainz recording IDs, then a conservative unique tag/audio signature.
  This keeps Rust responsible for filesystem facts while Python still owns DB
  policy and task orchestration.
- `crate-cli tags inspect`, `crate-cli tags write-identity`, and
  `crate-cli fingerprint` round out Phase 2 as bounded primitives. They are
  useful for recovery, portable identity, and diagnostics, but they do not make
  Rust own full export or enrichment workflows.
- Worker `library_sync` can now run `native_scan_diff_shadow`. It persists scan
  snapshots under `CRATE_NATIVE_SCAN_SNAPSHOT_DIR`,
  `native_scan_snapshot_dir`, or `/data/native-scan-snapshots`, then emits the
  Rust diff summary as task event/result data on subsequent syncs. This is
  still observation-only: Python remains the source of truth for upserts and
  deletions.
- The Phase 2/Phase 4 boundary was tightened after revisiting the architecture:
  `crate-cli` stays small and bounded, while export/artwork packaging moves to a
  future persistent `crate-media-worker` rather than becoming long-running CLI
  glue supervised by Python.

Next native step after Phase 2:

1. Define a minimal `crate-media-worker` contract for export packages only:
   job input JSON, progress event schema, output artifact metadata, cache key,
   cancellation behavior, and resource limits.
2. Keep Python as the task/control plane initially. The Rust worker should own
   only the media package execution path and report structured events back.
3. Reuse the proven `crate-cli` modules for tags, fingerprints, quality, and
   later artwork/archive helpers through a shared Rust crate instead of invoking
   them as subprocesses from inside the media worker.
4. Promote one workload at a time, starting with generated download packages,
   because it touches copied artifacts rather than mutating the original library.

Phase 4 first slice:

- `app/media-worker` now contains a small Rust service with a minimal HTTP
  contract and a one-shot `package-album` command for local debugging.
- The first implemented workload creates stored ZIP packages from source files
  and a `.crate/album.json` sidecar, using safe entry names and atomic publish.
- Generated track copies can now receive rich tags, plain/synced lyrics,
  analysis JSON, bliss vectors, and cover artwork before they are zipped.
- FastAPI has an opt-in download client behind `CRATE_MEDIA_WORKER_URL` for
  album ZIPs and single-track artifacts. The existing Python path remains the
  fallback when the service is not configured, returns an error, or times out.
- The native ZIP writer now emits ZIP64 structures when needed, so large
  entries, large archive offsets, and large entry counts are no longer an
  architectural blocker for album packages.
- Media jobs now use Redis as the primary progress/cancellation tracker:
  `XADD crate:media-worker:events`, `HSET crate:media-worker:job:{job_id}`,
  and `EXISTS crate:media-worker:cancel:{job_id}`. JSONL progress/cancel files
  remain only as local debug fallback.
- The worker service loop now bridges Redis media-worker events back into
  Crate task progress/events when `job_id` matches a real task id. Admin task
  cancellation also writes `crate:media-worker:cancel:{task_id}` so delegated
  media jobs can stop cooperatively.
- API calls to the media worker now pass through a Redis slot gate
  (`crate:media-worker:slot:{n}`) controlled by
  `CRATE_MEDIA_WORKER_MAX_ACTIVE` and lease TTLs. When no slot is available, the
  request falls back to the Python path instead of queueing more native IO work.
- The media worker now owns native download-cache finalization for worker-built
  artifacts: it writes the cache `manifest.json`, enforces
  `CRATE_DOWNLOAD_CACHE_MAX_BYTES`, and prunes expired/LRU artifacts after
  publishing the album ZIP or enriched track copy. Python still computes cache
  keys and keeps the existing fallback/cache-reader path.
- Media-worker package completions/failures, durations, bytes, slot denials, and
  cache-prune removals are recorded as metrics and surfaced in System Health
  alongside stream/slot runtime state.
- The Docker target is `media-worker`; Compose exposes it behind an explicit
  `media-worker` profile so it does not consume resources until the API/task
  integration is enabled.
- Phase 4 is now functionally complete for the first media-worker slice:
  packaging, rich metadata, ZIP64, Redis progress/cancel, task-event bridging,
  admission/backpressure, and native cache registration/pruning.
