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

## Phase 2: First Native Service, Rust Indexer

Expected impact: high.
Language: Rust.

Build `crate-indexer` as a read-mostly filesystem scanner and tag reader.

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

Expected wins:

- Faster library sync.
- Lower memory during scans.
- Less pressure on Python workers.
- More reliable reconstruction from identity tags and sidecars.

## Phase 3: Go Read Plane For Listen

Expected impact: high if Phase 1 shows FastAPI/read queries remain hot.
Language: Go.

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

## Phase 4: Native Media Utility Service

Expected impact: medium-high.
Language: Rust first, Go acceptable for process supervision.

Split media tooling into a native CLI/service:

- enriched zip creation
- sidecar generation
- identity tag inspection
- optional identity tag writing
- artwork embedding for export artifacts
- lyrics embedding for export artifacts
- file hashing

Why Rust:

- Strong binary/file manipulation.
- Good archive/hash libraries.
- Can share tag-reading code with `crate-indexer`.
- Predictable memory and CPU.

Important constraint:

- Mutating original audio files remains high-risk.
- Prefer native writes first for generated/export artifacts.
- Keep original-library tag writes conservative and heavily tested.

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

