# Crate Refactor Roadmap

**Date**: 2026-03-30
**Status**: Active roadmap
**Scope**: Backend worker decomposition, frontend shared core extraction, app boundary clarification, documentation alignment

## Goal

Refactor the codebase to reduce maintenance cost and implementation risk while preserving the current product split:

- `app/ui` / `crate-ui`: admin web app, desktop-oriented, focused on library management and operations
- `app/listen` / `crate-listen`: consumer-facing listening app, intended to remain separate and compatible with future Capacitor packaging for app stores

This roadmap explicitly does **not** merge the two frontend apps. Shared code should support both products without collapsing their UX, routing, deployment, or product goals into one app.

## Current State Summary

The repo has a solid architectural direction, but a few files and patterns dominate maintenance cost:

- `app/crate/worker.py` is the main operational hotspot and contains task handlers for many unrelated domains
- `app/crate/api/browse.py` concentrates a large amount of read/query/display logic
- `app/ui/src/pages/Artist.tsx` and `app/ui/src/components/layout/SearchBar.tsx` are large and product-dense
- `app/ui` and `app/listen` duplicate parts of their frontend foundation
- Documentation had lagged behind the actual existence and role of `crate-listen`

## Batch 1 Completed

Initial phase-1 work already completed:

- Added explicit product split to `README.md`
- Added explicit product split and shared-code guidance to `AGENTS.md`
- Introduced a first shared frontend core in `app/shared/web/`
- Extracted low-risk shared pieces:
  - `app/shared/web/api.ts`
  - `app/shared/web/use-api.ts`
  - `app/shared/web/utils.ts`
- Kept each app with local facades:
  - `app/ui/src/lib/api.ts`
  - `app/ui/src/hooks/use-api.ts`
  - `app/ui/src/lib/utils.ts`
  - `app/listen/src/lib/api.ts`
  - `app/listen/src/hooks/use-api.ts`
  - `app/listen/src/lib/utils.ts`
- Started decomposing `app/crate/worker.py` with a first extracted handler domain:
  - `app/crate/worker_handlers/artwork.py`
  - `app/crate/worker_handlers/__init__.py`
- Continued worker decomposition with a second extracted handler domain:
  - `app/crate/worker_handlers/management.py`
- Continued worker decomposition with a third extracted handler domain:
  - `app/crate/worker_handlers/acquisition.py`
- Continued worker decomposition with a fourth extracted handler domain:
  - `app/crate/worker_handlers/analysis.py`
- Continued worker decomposition with a fifth extracted handler domain:
  - `app/crate/worker_handlers/enrichment.py`
- Continued worker decomposition with a sixth extracted handler domain:
  - `app/crate/worker_handlers/integrations.py`
- Continued worker decomposition with a seventh extracted handler domain:
  - `app/crate/worker_handlers/library.py`
- Kept `app/crate/worker.py` as the runtime facade and task registry surface
- Verified both frontend builds still pass

This establishes the recommended pattern for future shared frontend work:

1. keep product-facing entrypoints local to each app
2. move low-risk generic logic to `app/shared/web/`
3. avoid importing product-specific components into shared code

## Refactor Principles

### 1. Preserve Product Boundaries

Do not merge `app/ui` and `app/listen`.

`app/ui` and `app/listen` may share infrastructure and logic, but they must remain:

- separate apps
- separately deployable
- separately evolvable
- free to diverge visually and behaviorally

### 2. Refactor the Hot Path First

Start where complexity blocks real work:

- worker execution flow
- duplicated frontend foundation
- very large domain files that slow feature work and bug fixing

### 3. Prefer Extraction Over Rewrites

For phase 1 and 2, avoid “big-bang” replacements. Move code into clearer modules while keeping behavior stable.

### 4. Improve Operability Alongside Structure

Whenever code is moved, preserve or improve:

- task visibility
- logging
- SSE progress/events
- build/test verification

### 5. Shared Code Must Be Truly Shared

Only move code into `app/shared/web/` if it is:

- product-neutral
- stable enough to support both apps
- not tightly coupled to admin-only or listen-only UX

## Pareto Priorities

These are ordered by likely impact on maintenance and delivery speed.

### Priority A

- Decompose `app/crate/worker.py`
- Expand the shared frontend core carefully
- Align docs and architectural guidance with the actual two-app setup

### Priority B

- Decompose `app/crate/api/browse.py`
- Split very large UI files in `app/ui`
- Introduce a minimal shared auth/session foundation usable by both frontends without forcing UX convergence

### Priority C

- Normalize backend domain boundaries further
- Reduce remaining duplication in player/visualizer/helpers where safe
- Improve migrations/schema evolution strategy
- Reduce silent exception swallowing in critical paths

## Phase Plan

## Phase 1

### Objective

Create safer structure without changing product behavior:

- reduce duplication in low-risk frontend foundation
- clarify app boundaries
- prepare worker decomposition

### Tasks

#### 1. Shared Frontend Foundation

Continue extracting generic pieces into `app/shared/web/`:

- API client factories
- fetch hooks
- neutral formatting/helpers
- type helpers shared by both apps

Candidate next targets:

- shared auth/session types
- shared track/player type definitions
- shared route-safe utilities
- shared palette or media helper primitives if they remain product-neutral

Avoid moving yet:

- page components
- app shells
- routing
- auth UX
- visualizer UI wrappers
- player UX behavior that differs between admin and listen

#### 2. Worker Decomposition Preparation

Before moving code:

- inventory handlers by domain
- identify common dependencies used by handlers
- define target module layout

Recommended target structure:

```text
app/crate/worker.py
app/crate/worker_handlers/
  __init__.py
  analysis.py
  artwork.py
  acquisition.py
  enrichment.py
  library.py
  management.py
  playlists.py
  shows.py
```

Do not introduce `app/crate/worker/` as a package unless `worker.py` is renamed first. The current module name would otherwise create an avoidable import collision.

Suggested responsibility split:

- `analysis.py`: `analyze_tracks`, `analyze_album_full`, `compute_bliss`, `compute_popularity`
- `artwork.py`: cover scanning/fetch/apply/upload handlers
- `acquisition.py`: tidal and soulseek downloads, cleanup incomplete downloads, new releases
- `enrichment.py`: artist enrichment, MBIDs, process new content
- `library.py`: sync, pipeline, health, repair
- `management.py`: delete/move/wipe/rebuild/reset/match/tag updates
- `playlists.py`: Navidrome sync and playlist-adjacent worker tasks
- `shows.py`: show sync and related tasks

Current extraction status:

- `artwork.py` is already extracted and registered from `worker.py`
- `analysis.py` is extracted and registered from `worker.py`:
  - moved: analytics computation, album/full-track audio analysis, chunk coordination for analysis work, bliss computation, popularity computation, genre indexing
  - note: `analyze_all` remains the task name for analysis chunk tasks and is now registered from the analysis handler module
- `enrichment.py` is extracted and registered from `worker.py`:
  - moved: single/bulk artist enrichment, enrichment reset, MBID enrichment, folder reorganization, `process_new_content`, content hashing, enrichment-specific processing guards
  - note: the end-to-end new-content pipeline now lives outside `worker.py`, alongside its helper flow
- `management.py` is partially extracted:
  - moved: health/repair/pipeline, destructive library ops, tag updates, duplicate resolution, match-apply
  - `reset_enrichment` no longer needs to stay in `worker.py`; that dependency moved with the enrichment handler family
- `acquisition.py` is extracted and registered from `worker.py`:
  - moved: Tidal downloads, new-release checks, Soulseek download monitoring, incomplete-download cleanup
  - includes the local helper flow for alternate peer retries and post-download process queueing
- `integrations.py` is extracted and registered from `worker.py`:
  - moved: Navidrome playlist sync, Navidrome ID mapping, Ticketmaster show sync, similarity backfill
- `library.py` is extracted and registered from `worker.py`:
  - moved: scan, library sync, fix-issues flow, batch retag
- `worker.py` is now materially smaller and functioning as a thin runtime facade plus registry while extraction continues
- `app/crate/api/browse.py` is no longer a monolith:
  - `app/crate/api/browse.py` now acts as a thin router aggregator
  - `app/crate/api/browse_artist.py` contains artist, shows, upcoming and artist-adjacent browse routes
  - `app/crate/api/browse_album.py` contains album, cover and album-download routes
  - `app/crate/api/browse_media.py` contains search, favorites, ratings, track info, discover completeness, stream, similar-tracks and track download routes
  - `app/crate/api/browse_shared.py` contains shared browse helpers and filesystem fallbacks
- `app/ui/src/pages/Artist.tsx` has started to be decomposed:
  - extracted `app/ui/src/components/artist/ArtistNetworkGraph.tsx`
  - extracted `app/ui/src/components/artist/ArtistPageBits.tsx` for small reusable artist-page primitives and track matching helper
  - extracted `app/ui/src/components/artist/ArtistTopTracksSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistDiscographySection.tsx`
  - extracted `app/ui/src/components/artist/ArtistSetlistSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistShowsSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistOverviewSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistAboutSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistSimilarSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistStatsSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistHeroSection.tsx`
  - extracted `app/ui/src/components/artist/ArtistLoadingState.tsx`
  - extracted `app/ui/src/components/artist/ArtistTabsNav.tsx`
  - extracted `app/ui/src/components/artist/artistPageData.ts`
  - extracted `app/ui/src/components/artist/artistPageTypes.ts`
  - widened shared typing in `app/ui/src/hooks/use-artist-data.ts` so the page and extracted components use the actual enrichment payload shape
  - `Artist.tsx` has been reduced from ~1681 lines to ~405 lines while preserving behavior through repeated `app/ui` production builds

#### 3. Documentation

Keep these files updated whenever architecture changes:

- `README.md`
- `AGENTS.md`
- `docs/architecture.md`

If frontend sharing expands materially, add a short section to `README.md` documenting:

- what lives in `app/shared/web`
- what must remain app-local

### Success Criteria

- both frontends still build
- worker behavior unchanged
- docs accurately describe two separate frontend apps
- shared frontend code remains generic

## Phase 2

### Objective

Break apart the highest-cost domain files and reduce implementation friction.

### Tasks

#### 1. Decompose `app/crate/worker.py`

Move handlers incrementally, keeping `run_worker`, service loop, and final task registry stable during transition.

Recommended sequence:

1. extract pure helper functions
2. extract least-coupled handler groups
3. keep a thin compatibility layer in `worker.py`
4. only then reduce `TASK_HANDLERS` registration into imports from modular handler files

Important rule:

Do not change task names, task payload contracts, or event names unless necessary. Preserve compatibility with the existing UI polling/SSE behavior.

#### 2. Decompose `app/crate/api/browse.py`

Recommended target split:

```text
app/crate/api/browse/
  artists.py
  albums.py
  tracks.py
  covers.py
  search.py
  stream.py
  discovery.py
  shows.py
```

Key caution:

Routes using `{name:path}` and other catch-all patterns must preserve registration order.

#### 3. Split Admin UI Hotspots

Refactor these first:

- `app/ui/src/pages/Artist.tsx`
- `app/ui/src/components/layout/SearchBar.tsx`

Suggested split for `Artist.tsx`:

- `ArtistHero`
- `ArtistOverviewTab`
- `ArtistDiscographyTab`
- `ArtistSetlistTab`
- `ArtistShowsTab`
- `ArtistSimilarTab`
- `ArtistAboutTab`
- `useArtistPage` hook for data loading and mutation logic

Suggested split for `SearchBar.tsx`:

- `useUnifiedSearch`
- `SearchResultsPanel`
- `SearchRecentQueries`
- `SearchResultRow`

### Success Criteria

- `worker.py` becomes a thin runtime/composition file
- browse routes are domain-organized
- admin UI hotspots become easier to modify independently

## Phase 3

### Objective

Consolidate shared behavior safely and reduce structural debt that remains after the hotspots are fixed.

### Tasks

#### 1. Shared Auth and Session Foundation

Create shared auth/session primitives for both frontends without forcing a shared UX.

Safe shared candidates:

- user/session types
- `auth/me` fetch helper
- cookie/session awareness
- logout helper
- maybe route guard primitives

Keep product-local:

- admin role-aware navigation
- listen’s lightweight consumer UX
- login/register page design and flows

#### 2. Player and Audio Core Evaluation

There is meaningful duplication between:

- `app/ui/src/contexts/PlayerContext.tsx`
- `app/listen/src/contexts/PlayerContext.tsx`

But do **not** merge blindly. The player is product-sensitive.

Recommended approach:

- extract only non-UX audio primitives first
- keep context shape/product features app-specific where needed

Potential shared candidates:

- track typing
- stream URL resolution helper
- queue persistence helpers
- recently-played persistence helpers
- audio scrobble/history helper calls

Potential app-local concerns:

- `playSource`
- admin-specific player controls
- mobile/fullscreen listen behavior
- Capacitor-specific future concerns in `listen`

#### 3. Visualizer Rationalization

There is duplicated visualizer code in both frontends. Treat this as a separate workstream after the player core is better understood.

Do not touch visualizer sharing until:

- player boundaries are clearer
- `listen` mobile/Capacitor needs are explicit

## Phase 4

### Objective

Tackle deeper platform debt once the codebase is easier to work in.

### Tasks

#### 1. Database Migration Strategy

Current schema management in `app/crate/db/core.py` should eventually evolve into a clearer migration system.

Recommended minimum direction:

- `schema_version` table
- numbered migration modules
- bootstrapping that applies pending migrations in order

Do this only after the domain layout is more stable.

#### 2. Error Handling and Logging Pass

Critical-path modules should progressively replace silent `except Exception` with at least debug-level logs.

Prioritize:

- worker acquisition paths
- enrichment
- watcher/sync
- navidrome integration
- audio analysis

#### 3. Test Coverage Expansion

Add tests around:

- extracted worker modules
- shared frontend core
- app-specific frontend wrappers where behavior differs

`app/listen` currently especially needs more explicit coverage.

## Workstream Suggestions

If different agents or sessions pick up this roadmap, these workstreams can be pursued semi-independently.

### Workstream A: Worker

- modularize worker handlers
- preserve task contracts and events
- add targeted tests where possible

### Workstream B: Shared Frontend Core

- extend `app/shared/web/`
- keep app facades local
- verify both frontend builds on every batch

### Workstream C: Admin UI Decomposition

- split `Artist.tsx`
- split `SearchBar.tsx`
- reduce local complexity without changing appearance significantly

### Workstream D: Backend Read API Structure

- decompose `browse.py`
- document route ordering constraints

### Workstream E: Docs and Architecture

- keep README/AGENTS/architecture docs current
- record decisions about what must remain app-local vs shared

## Suggested Ticket Breakdown

### Ticket Group 1

- expand `app/shared/web/` with shared types and low-risk helpers
- add a short README section for shared frontend core

### Ticket Group 2

- create or extend `app/crate/worker_handlers/`
- move one domain at a time, starting with artwork or management handlers

### Ticket Group 3

- split `app/ui/src/pages/Artist.tsx` into tab components and hooks

### Ticket Group 4

- split `app/crate/api/browse.py` by route domain

### Ticket Group 5

- evaluate shared player/audio primitives between admin and listen

## Risks and Constraints

### Product Risk

The biggest strategic risk is accidentally merging `admin` and `listen` concerns while extracting shared code.

Mitigation:

- keep app-local entrypoints
- keep app-local routing and UX
- only move neutral logic into shared modules

### Operational Risk

The biggest technical risk is changing worker behavior while reorganizing files.

Mitigation:

- preserve task names
- preserve payload shapes
- preserve event names and progress structures
- move code incrementally

### Capacitor Risk

`listen` is intended for future Capacitor packaging. Shared code must not assume browser-only desktop admin patterns.

Mitigation:

- prefer plain React/TypeScript logic in shared code
- avoid admin-specific DOM assumptions in shared modules
- keep mobile/app-shell behavior in `listen` local

## Verification Checklist

For each refactor batch:

- `app/ui` builds successfully
- `app/listen` builds successfully
- worker imports resolve
- no route ordering regressions in API registration
- no task type names changed unintentionally
- docs updated if architecture changed

Recommended commands:

```bash
cd app/ui && npm run build
cd app/listen && npm run build
```

Backend verification can be expanded per batch depending on touched modules.

## Next Recommended Step

Continue phase 1 by starting the worker decomposition preparation:

1. create target worker module layout
2. extract the least-coupled handler family first
3. keep runtime logic in place until all handler imports are stable

If frontend work is preferred first, the next safest step is:

1. move shared frontend types/helpers into `app/shared/web/`
2. keep `PlayerContext` and app shells local
3. document clearly which abstractions are intentionally not shared
