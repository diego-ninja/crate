---
title: Artwork delivery
summary: Operate worker-owned persistent artwork variants and their non-blocking read path.
section: operations
audience: [operator, developer]
status: canonical
order: 140
verified: 2026-09-08
sources:
  [
    app/crate/artwork_variants.py,
    app/crate/artwork_materializer.py,
    app/crate/artist_hero_publication.py,
    app/crate/artist_hero_retention.py,
    app/crate/artist_hero_migration.py,
    app/crate/db/repositories/artist_hero_artwork.py,
    app/crate/artwork_maintenance.py,
    app/crate/api/artwork_delivery.py,
  ]
---

# Artwork delivery

Crate materializes artwork as immutable WebP revisions under
`/data/artwork-variants/v1`. HTTP processes are read-only: they serve a current
variant, a local original, or the existing placeholder and enqueue deduplicated
worker work on a miss. Provider calls, embedded-cover extraction, Pillow and all
filesystem writes run in workers.

## Backfill and lifecycle

API startup automatically queues the versioned `backfill_artwork_variants` task
until its durable completion marker is present. Each invocation processes bounded,
stable pages (100 by default) and schedules its continuation only after the page
has been enumerated. It covers album covers, artist photos/backgrounds and genre
covers. Release and external-artist assets materialize on demand.

The task is restart-safe and deduplicates on `artwork:<kind>:<entity-key>`.
`cleanup_artwork_variants` retains current plus one previous revision and removes
only temporary directories older than 24 hours. It also removes stale known
Artist Hero publication directories while retaining the active and previous
revision for each composition. The migration history is now the source of truth
for future retention expansion: active manifests and manifests referenced by
`artist_hero_manifest_history` must remain resolvable before cleanup removes a
publication. Unknown directories are never inferred as safe to delete.
`repair_artwork_variants` samples or scans manifests and requeues corrupt assets;
it never edits them in an API process.

## Artist Hero publications

Versioned Hero WebPs live below
`artist-hero-publications/v1/<entity-uid>/<composition>/<render-revision>` and
are published atomically with a sidecar manifest. The active
`render_manifest` remains the profile pointer; the
`artist_hero_render_revisions` table is append-only metadata for every known
artifact. `artist_hero_manifest_history` stores complete manifests and their
previous pointer before activation. A manifest ID is a SHA-256 of its canonical
JSON, so retries are idempotent and two technical publications can share one
editorial revision without overwriting one another. A later editorial manifest
may also reuse an existing technical artifact; its immutable render metadata is
validated without treating the new editorial revision as a conflict.

Hero writers use the profile revision as an optimistic concurrency token. A
stale worker returns a conflict and cannot replace a newer profile or active
manifest. Retried writes with the same artifact identity and metadata are
idempotent. Delivery can resolve an explicit `v` revision only while its known
artifact directory is retained; legacy profiles continue through the existing
fallback path.

## Artist Hero migration canary

`POST /api/artwork/artist-heroes/migration-canary` starts a cursor-based canary.
It scans only approved manual profiles, with a bounded `batch_size` (1–100),
and returns the next `after_artist_id` cursor. With the default `dry_run: true`
it is read-only. Once a reviewed canary is ready, `dry_run: false` queues one
deduplicated `migrate_artist_hero` task per planned artist plus exactly one
deduplicated continuation for a full page. The target key includes the artist
and expected editorial revision, so a retry cannot fan out duplicate work.

The canary never renders, publishes, changes provenance/review status, advances
the editorial revision, or deletes legacy files. It validates every enabled
composition before considering an artist planned. Missing source, recipe,
profile, entity identity, or artist directory is reported as a skip reason;
an existing manifest covering all enabled compositions is reported as
`already-published`. Planned targets include a deduplication key scoped to the
artist and expected editorial revision.

An execution task captures both enabled sources and recipes, renders the bundle
without touching legacy files, publishes every immutable artifact first, then
activates the complete manifest with a CAS over the expected editorial revision
and expected active manifest. A missing source or recipe therefore cannot
produce a partial publication. CAS failure leaves prepared files inactive and
returns `artist-hero-profile-changed`; it never changes approval, provenance,
featured state, or enabled flags. Cache invalidation and snapshot warming happen
only after a successful activation.

## Operations

- Normal health samples at most 100 assets.
- Admin system metrics expose checked, valid, corrupt, revisions and bytes.
- Request and worker metrics use the `artwork.*` namespace.
- A high `missing` ratio means the backfill is incomplete or source files are
  absent. A high `failed` queue ratio indicates task broker failure.
- Rollback is safe: disable native local media and FastAPI continues serving
  variants/originals/placeholders. Materialized files are additive.

Never delete `current.json` or a current revision manually. Use the cleanup and
repair tasks so publication remains atomic.
