---
title: Artist hero theming rollout
summary: Operate the shared hero presentation, versioned artifacts, canary migration and guarded rollback.
section: operations
audience: [developer, operator]
status: canonical
order: 141
verified: 2026-09-08
sources:
  [
    app/shared/ui/domain/ArtistHeroFrame.tsx,
    app/ui/src/components/artist/HeroCompositionCanvas.tsx,
    app/crate/artist_hero_contract.py,
    app/crate/artist_hero_publication.py,
    app/crate/artist_hero_retention.py,
    app/crate/artist_hero_migration.py,
    app/crate/api/artwork.py,
    app/crate/worker_handlers/artwork.py,
  ]
---

# Artist hero theming rollout

The hero is split into two contracts. `ArtistHeroFrame` and
`ArtistHeroPresentation` own the shared themed presentation in Admin and
Listen. The artwork pipeline owns source capture, renderer output, immutable
publication and delivery. A skin changes the frame tokens and overlay recipe;
it never changes the editorial asset or silently crops pixels.

## Frontend contract

- Desktop and mobile are separate compositions with canonical 1480×600 and
  1080×1350 target sizes.
- `ArtistHeroFrame` resolves `object-cover object-center` for a full-frame
  legacy source and `object-fill` only when explicit artwork bounds describe an
  extended composition.
- Scrims use `--surface-app`; text, CTA, focus and genre badges use semantic
  tokens from the active scope.
- Admin `HeroCompositionCanvas` previews through the same frame and geometry
  contract as Listen. It does not write preferences, recipe state or sources
  when the user only changes preview appearance.
- A profile without a compatible manifest remains visible through the explicit
  legacy fallback. It is never hidden because its photo contains dark pixels.

## Published artifact model

Published files live below:

```text
artist-hero-publications/v1/<entity-uid>/<composition>/<render-revision>/
  artifact.webp
  manifest.json
```

The manifest carries `source_fingerprint`, `recipe_hash`, `renderer_version`,
`render_revision`, `relative_path` and publication version. The profile's
active `render_manifest` points to a complete bundle; the append-only
`artist_hero_manifest_history` stores the previous pointer and full manifest.
The identity includes artist, composition and render revision, so retries are
idempotent and old cache entries cannot be overwritten by a newer revision.

HTTP/readplane paths only read known artifacts. Source resolution, Pillow/WebP
rendering, filesystem writes, cleanup and publication all run in workers.

## Canary and activation

1. Start with `POST /api/artwork/artist-heroes/migration-canary` and keep
   `dry_run: true`. Use a bounded `batch_size` and persist the returned
   `after_artist_id` cursor.
2. Review `planned`, `already-published` and skip reasons. A target is only
   planned when every enabled composition has a valid source, recipe, entity
   identity and artist directory.
3. Re-run the reviewed page with `dry_run: false`. The API queues one
   deduplicated task per artist/revision and one continuation per page.
4. The worker captures source and recipe, renders the complete desktop/mobile
   bundle, writes immutable files, then activates the manifest with CAS over
   both the expected editorial revision and expected active manifest.
5. Cache invalidation and snapshot warming happen only after activation. A CAS
   conflict leaves prepared files inactive and does not modify approval,
   provenance, featured or enabled flags.

Never mass-migrate before a canary has been reviewed and the read path has been
checked in both the current and fallback renderer versions.

## Rollback

Queue `POST /api/artwork/artists/{artist_id}/hero-profile/rollback` with the
retained `target_manifest_id`. The request must include the expected active
manifest as resolved by the API. The worker rejects the operation when the
editorial revision or active manifest has changed since the operator selected
the target. It also rejects rollback to a manifest whose complete bundle is no
longer retained.

Rollback changes only the active technical manifest. It does not revoke
editorial approval, featured status, provenance or enabled compositions. A
successful CAS triggers the normal invalidation/snapshot path. If a rollback is
rejected, inspect the current manifest and choose a new target; do not force a
database update or delete artifact directories manually.

## Retention and health

Retention keeps the active manifest and the newest previous complete bundle.
Cleanup considers only known manifest history and never infers that an unknown
directory is safe to delete. `repair_artwork_variants` validates known assets
and requeues repair work without mutating files from an API process.

During rollout, monitor:

- `artwork.*` request and worker metrics, including missing/failed ratios;
- CAS conflicts, stale jobs, fallback responses and missing source reasons;
- cache invalidation and snapshot projector lag;
- Sentry events for API/readplane errors, worker task failures and render or
  publication conflicts.

The safe emergency control is to disable the native/local-media path and keep
FastAPI delivery active; the additive artifacts remain available. Do not delete
`current.json`, active manifests or retained bundles by hand.

## Verification

Run the shared browser contracts from
[`listen-design-system-visual-qa.md`](listen-design-system-visual-qa.md), then
the focused backend suite:

```bash
PYTHONPATH=app .venv/bin/python -m pytest \
  app/tests/test_artist_hero_contract.py \
  app/tests/test_artist_hero_artwork.py \
  app/tests/test_artist_hero_publication.py \
  app/tests/test_artist_hero_migration.py \
  app/tests/test_artist_hero_composition_delete.py -q
```

The acceptance gate is: shared desktop/mobile presentation parity, no renderer
padding drift, legacy fallback visible, complete-bundle publication, stale
writer rejection, durable history, guarded rollback and healthy read-only API
delivery. A successful canary is required before any broad migration.
