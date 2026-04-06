# Resource ID Migration Plan

**Date**: 2026-04-06
**Status**: In Progress
**Scope**: issue #149, stable API resource identity for artists, albums, tracks, and related media routes

## Goal

Stop using mutable name strings as the primary identity for library resources in the API.

This version of the plan assumes:

- Crate is not yet being used by external consumers
- breaking API and frontend route changes are acceptable
- we should prefer a clean cutover over a long compatibility phase

This plan covers:

- artist, album, and track resource identity
- stable human-readable slugs for core entities
- album cover and artist-media routes
- frontend navigation and card URLs
- compatibility with existing name-based routes during migration

This plan does **not** try to normalize the entire database in one go.

## Current Implementation Status

### First implementation batch delivered

The current branch now includes a first vertical slice of this migration:

- `library_artists.id` added as a stable numeric internal identifier
- `slug` added and backfilled for:
  - `library_artists`
  - `library_albums`
  - `library_tracks`
- canonical ID-based API routes added for:
  - artists
  - albums
  - album covers
- list/search/detail payloads now expose `id` and `slug` where needed
- shared frontend route helpers exist for both `listen` and `admin`
- main artist/album pages and shared cards/search surfaces in both apps now prefer ID/slug routes when available

### Intentionally not finished yet

This first batch does **not** yet remove every legacy name-based route or every old string-based URL construction site.

That cleanup is still a follow-up batch, but the canonical direction is now established and working.

## Decision Summary

### Primary decision

Crate should migrate to **numeric internal IDs** as the primary API identity for library resources.

Crate should also add a **unique slug** to each core library entity so URLs can be readable without using mutable names as identity.

### Explicit non-decision

Crate should **not** migrate artists, albums, and tracks to UUID primary keys as part of issue #149.

### Why

The core problem is not that IDs are guessable. The real problem is that API identity is currently tied to:

- artist names
- album names
- path-encoded strings

Those values are mutable, formatting-sensitive, and fragile around:

- special characters
- folder/tag divergence
- renames
- aliases
- URL encoding

Numeric IDs solve that problem cleanly with much lower migration risk than UUIDs.

Unique slugs complement that model well:

- IDs give stable internal identity
- slugs give readable URLs
- the system no longer depends on raw names in paths

## Why Not UUIDs For Artists / Albums / Tracks

UUIDs may still make sense elsewhere in Crate, but they are not the right first move here.

### Reasons

- `library_albums` and `library_tracks` already have numeric primary keys.
- The codebase already follows a mostly `SERIAL`/integer pattern for internal entities.
- Crate is not a multi-region or offline-write system where UUID generation solves an operational problem.
- Introducing UUID primary keys for core library entities would force a broader schema and application migration than the product problem requires.
- The expensive part of this migration is artist normalization, not ID opacity.

### Where UUIDs *could* fit later

If Crate needs opaque public identifiers later, add a separate `public_id` column for specific shareable objects:

- public playlists
- replay or wrapped objects
- public profile/share surfaces

That is a different problem from internal resource identity.

## Current State

### Database

- `library_artists` uses `name TEXT PRIMARY KEY`
- `library_albums` uses `id SERIAL PRIMARY KEY`, but still references artists by name string
- `library_tracks` uses `id SERIAL PRIMARY KEY`, `album_id`, and also stores denormalized artist/album strings

### API

The API currently identifies resources by names in several critical places:

- `/api/artist/{name:path}`
- `/api/album/{artist:path}/{album:path}`
- `/api/cover/{artist:path}/{album:path}`
- several artist media routes also use artist name in the path

### Frontend

`listen` and `admin` build many URLs from names:

- artist page links
- album page links
- album cover URLs
- artist photo/background URLs
- related album links
- search results

### Important consequence

Issue #149 is partly an API routing problem, but it is also a data-model coupling problem.

That means the migration should be split into:

1. API identity migration
2. optional later database normalization

not treated as one risky rewrite.

## Migration Principles

### 1. Prefer a clean cutover

If the project is not yet externally consumed, the migration should replace legacy name-based routes instead of carrying them indefinitely.

### 2. Prefer additive schema changes

Add new columns and routes first. Remove legacy behavior only after frontend adoption and a quiet period.

### 3. Separate API identity from deep normalization

It is worth fixing URLs now even if some internal tables still carry artist names temporarily.

### 4. Use clean route shapes

Take the opportunity to move to a clearer route vocabulary instead of preserving awkward legacy path patterns.

## Target Model

### Resource identity

- artists: new numeric internal ID
- albums: existing numeric ID remains primary
- tracks: existing numeric ID remains primary

### URL identity

Each core entity should also have a stable unique slug:

- `library_artists.slug`
- `library_albums.slug`
- `library_tracks.slug`

The slug is **not** the primary relational identity. It is a human-readable companion to the numeric ID.

### Canonical API routes

Because breaking changes are acceptable, the API should move directly to clean plural resource routes:

- `GET /api/artists/{artist_id}`
- `GET /api/artists/{artist_id}/photo`
- `GET /api/artists/{artist_id}/background`
- `GET /api/artists/{artist_id}/shows`
- `GET /api/albums/{album_id}`
- `GET /api/albums/{album_id}/related`
- `GET /api/albums/{album_id}/cover`
- `GET /api/tracks/{track_id}` when track detail is needed

### Frontend rule

Frontend should treat IDs as the only canonical resource identity. Name-based routes should be removed, not preserved as a normal fallback.

### Canonical frontend routes

Frontend routes should use both `id` and `slug`:

- `/artist/{artist_id}/{slug}`
- `/album/{album_id}/{slug}`
- `/track/{track_id}/{slug}` when track detail exists

That gives us:

- stable routing by ID
- readable URLs
- the option to ignore or later redirect on stale slug mismatches

The important rule is that the app resolves by `id`, not by slug.

## Batches

## Batch 1 - Artist Surrogate ID

### Goal

Give artists the same kind of stable internal identity that albums and tracks already have, and introduce slugs across all core entities.

### Backend changes

- add `id` to `library_artists`
- keep `name` unique
- backfill IDs for existing rows
- add `slug` to `library_artists`
- add `slug` to `library_albums`
- add `slug` to `library_tracks`
- backfill slugs for existing rows
- add uniqueness constraints per entity table
- expose `id` in all artist-shaped payloads that currently only return `name`
- expose `slug` alongside `id` in artist/album/track payloads

### Slug rules

- slug generation should come from a normalized display name
- collisions should be resolved deterministically with numeric suffixes
- slugs should be treated as stable once assigned
- later rename flows may choose to regenerate slugs explicitly, but slug churn should not be automatic

### Notes

This batch does **not** need to rewrite every table that stores artist names.

### Files

- `app/crate/db/core.py`
- `app/crate/db/library.py`
- artist-listing/search routers

## Batch 2 - ID-First Read Endpoints

### Goal

Introduce canonical ID-based routes and remove legacy name-based API entrypoints.

### Backend changes

- add `GET /api/artists/{artist_id}`
- add ID-based artist media routes
- add `GET /api/albums/{album_id}`
- add `GET /api/albums/{album_id}/related`
- add `GET /api/albums/{album_id}/cover`
- add `GET /api/tracks/{track_id}` if needed for player/detail surfaces
- remove name-based detail/media routes after frontend migration lands in the same batch or immediately after

### Cleanup behavior

Shared lookup helpers should still exist internally, but the public API should stop exposing name-based resource-identification routes.

### Optional route style for app-facing detail

If we want cleaner browser-facing URLs, detail endpoints or page loaders may also accept the slug in the path, but must resolve by ID first.

### Files

- `app/crate/api/browse_artist.py`
- `app/crate/api/browse_album.py`
- `app/crate/api/browse_media.py`
- shared media/lookup helpers if extracted

## Batch 3 - Frontend ID Adoption

### Goal

Move all navigation and media URLs to the new stable IDs in one coherent frontend pass.

### Frontend changes

- artist cards link by `artist_id`
- album cards link by `album_id`
- artist cards include `slug` in page URLs
- album cards include `slug` in page URLs
- track links include `slug` when track detail pages appear
- cover URLs use `album_id`
- search results carry IDs forward
- related albums use IDs
- artist media URLs use `artist_id`

### Important rule

Do not spread mixed route semantics for long. Land shared URL builders and card/navigation updates early, then remove old path construction.

### Files

- shared cards/components in `app/ui/src/components/`
- pages that still construct raw string routes
- `encPath()` use sites for artist/album identity

## Batch 4 - Write / Task / Admin Surfaces

### Goal

Remove more name-based coupling from actions, not just read views.

### Changes

- enrich artist by `artist_id`
- show/setlist helpers resolve from `artist_id`
- management actions that currently accept `(artist_name, album_name)` gain ID-first variants
- worker tasks should prefer IDs in params when the target is a library entity

### Reason

If reads are migrated but writes still hinge on names, the system remains brittle around renames.

### Files

- `app/crate/api/enrichment.py`
- `app/crate/api/browse_artist.py`
- worker handlers that still dispatch on artist names

## Batch 5 - Legacy Route Removal And Cleanup

### Goal

Delete obsolete name-based routing and URL construction once the ID pass is complete.

### Changes

- remove deprecated artist-by-name detail/media routes
- remove deprecated album-by-name detail/cover routes
- remove old frontend URL builders based on `(artist, album)` identity
- update docs and tests to the new canonical routes only

## Batch 6 - Optional Deep Normalization

### Goal

Clean up artist-name coupling in the relational model once API identity is already stable.

### Candidate changes

- add `artist_id` to `library_albums`
- gradually move `artist_genres.artist_name` to `artist_id`
- add targeted `artist_id` references in tables where joins by name are hot or fragile
- keep denormalized `artist` text where it is genuinely useful for display/debug/search

### Optional follow-up

If slugs prove broadly useful, later non-library entities can also adopt them:

- playlists
- genres
- recap/replay objects
- upcoming/show-prep objects if they get shareable URLs

### Non-goal

Do **not** attempt a full rewrite of every historical text field that contains artist or album names. Many of those are contextual snapshots, not relational identities.

## Data Model Recommendations

### Artists

- add numeric `id`
- add unique `slug`
- keep `name` unique
- keep external IDs as external IDs:
  - `mbid`
  - `spotify_id`
  - `navidrome_id`

### Albums

- keep `id` as the primary internal identity
- add unique `slug`
- add or prefer helper lookups by `album_id`
- later consider `artist_id` normalization in addition to the existing `artist` text

### Tracks

- keep `id` as the primary internal identity
- add unique `slug`
- continue using `album_id`
- keep `path` as a unique filesystem identity, but not the main API identity

## Risks

### 1. Route ambiguity

If new ID routes overlap with legacy catch-all string routes, FastAPI routing can become fragile or surprising.

That is why this plan prefers:

- `/api/artists/{id}`
- `/api/albums/{id}`
- `/api/artists/by-name/{name:path}`

instead of overlapping singular shapes.

### 2. Artist rename behavior

A lot of maintenance code still updates artists by name. Until Batch 4 and Batch 6 are underway, renames will remain a sensitive area.

### 3. Mixed payloads during migration

Some responses may include IDs before every page is updated to consume them. Frontend work should tolerate both shapes temporarily.

### 4. Compilation / multi-artist edge cases

Track-level artist data and album-level artist identity are not always the same. The migration should keep that distinction clear instead of over-normalizing too early.

## Acceptance Criteria

The migration is successful when:

- artist, album, and track detail/navigation no longer depend primarily on name strings
- album covers and artist media no longer require path-encoded artist/album names
- frontend shared components use IDs consistently
- browser/app routes are readable because they include stable slugs
- obsolete name-based routes are removed
- artist renames no longer threaten basic API navigation

## Recommended Implementation Order

If we want the highest value with the lowest risk, the order should be:

1. add `library_artists.id`
2. add `slug` to artists/albums/tracks and backfill them
3. expose IDs and slugs in list/search/detail payloads
4. add canonical ID-based read routes
5. migrate shared frontend cards and URL builders
6. remove old routes and path builders
7. migrate write/task surfaces
8. only then decide how much deeper relational normalization is worth doing

## Bottom Line

Issue #149 should be implemented as:

- **stable numeric internal IDs for API identity**
- **stable unique slugs for readable URLs**
- **a clean route cutover instead of long-lived aliases**
- **no UUID primary-key migration for library entities**

If Crate later needs opaque public identifiers, add them separately as `public_id` fields on the specific entities that need them.
