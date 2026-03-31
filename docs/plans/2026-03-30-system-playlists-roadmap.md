# System Playlists Roadmap

**Date**: 2026-03-30
**Status**: Active
**Scope**: executable roadmap for system playlists, curated playlists, user follow, and their relation to the broader playback-intelligence roadmap

## Purpose

Turn the updated design into a practical delivery sequence that can be resumed by another agent without rediscovery.

Related docs:

- `docs/plans/2026-03-31-radio-and-playlist-intelligence-design.md`

## Product Rules

- `admin` creates and manages system playlists
- `listen` consumes and follows system playlists
- end users cannot create smart playlists
- end users cannot create curated playlists
- `smart` defines generation
- `curated` defines public editorial publication
- follow is user-scoped
- Navidrome projection splits into:
  - global public projection for system playlists
  - optional personal projection for linked users

## Batch 1 - Data Model

### Goal

Prepare the backend to represent:

- user playlists
- system smart playlists
- system curated playlists
- user follows of system curated playlists

### Deliverables

- new playlist metadata in `playlists`
- `user_followed_playlists`
- DB helpers for system playlist listing and follow/unfollow
- no breaking change to current playlist APIs

### Files

- `app/crate/db/core.py`
- `app/crate/db/playlists.py`
- `app/crate/db/__init__.py`

### Status

- implemented
- schema/helpers batch validated in dev

## Batch 2 - Read APIs

### Goal

Expose system playlists cleanly to `listen`.

### Deliverables

- read-only curation router
- followed playlists endpoint
- playlist follower state/count

### Files

- `app/crate/api/curation.py` or similar
- `app/crate/api/me.py`

### Depends On

- Batch 1

### Status

- in progress
- admin management router for system playlists implemented

### Status

- in progress
- curation read router and followed-playlists endpoint implemented

## Batch 3 - Admin Management APIs

### Goal

Make `admin` the only place where system playlists are created and maintained.

### Deliverables

- admin create/update/delete for system playlists
- activate/deactivate
- regenerate smart system playlists

### Files

- `app/crate/api/system_playlists.py`
- `app/crate/api/playlists.py` if some helpers stay shared

### Depends On

- Batch 1

## Batch 4 - Admin UI

### Goal

Expose system playlist management in `admin`.

### Deliverables

- filtered management UI
- creation/edit flow for static vs smart system playlists
- badges and states
- follower counts and publication states

### Files

- `app/ui/src/pages/Playlists.tsx`
- or `app/ui/src/pages/SystemPlaylists.tsx`

### Depends On

- Batch 3

### Status

- in progress
- `app/ui/src/pages/Playlists.tsx` ya se ha reconvertido a `System Playlists`
- navegación de admin actualizada para reflejar el foco en playlists del sistema

## Batch 5 - Listen Discovery

### Goal

Expose curated playlists in `listen` as public editorial objects.

### Deliverables

- `Featured Playlists` in Home
- Explore categories
- Followed Playlists in Library
- follow/unfollow actions
- playlist detail semantics for system playlists

### Files

- `app/listen/src/pages/Home.tsx`
- `app/listen/src/pages/Explore.tsx`
- `app/listen/src/pages/Library.tsx`
- `app/listen/src/pages/Playlist.tsx`

### Depends On

- Batch 2

## Batch 6 - Unified Radio

### Goal

Support `track`, `album`, `artist`, and `playlist` radio under one player model.

### Deliverables

- `/api/radio/track/{track_id}`
- `/api/radio/album/{album_id}`
- `/api/radio/artist/{name}`
- `/api/radio/playlist/{playlist_id}`
- PlayerContext radio state and refill logic

This batch should follow the consolidated design in `2026-03-31-radio-and-playlist-intelligence-design.md`.

### Files

- `app/crate/api/radio.py`
- `app/listen/src/contexts/PlayerContext.tsx`
- relevant listen entrypoints

### Depends On

- independent of curation batches

## Batch 6B - Infinite Continuation and Playlist Suggestions

### Goal

Add intelligent continuation when an album or playlist ends in infinite mode, and prepare smart playlist-track inclusion as a player capability.

### Deliverables

- continuation flow for finished albums/playlists
- suggested tracks after queue completion in infinite mode
- playlist suggestion model that does not mutate the stored playlist by default
- player settings / flags for suggestion cadence and enablement

### Files

- `app/crate/api/radio.py` or shared recommendation service
- `app/listen/src/contexts/PlayerContext.tsx`
- relevant playlist / album listen surfaces

### Depends On

- Batch 6
- consolidated behavior rules in `2026-03-31-radio-and-playlist-intelligence-design.md`

## Batch 7 - Smart Regeneration

### Goal

Keep system smart playlists fresh.

### Deliverables

- reusable regenerate helper
- worker task for regeneration
- optional scheduler integration

### Files

- `app/crate/api/playlists.py`
- `app/crate/worker_handlers/*`
- `app/crate/actors.py`
- `app/crate/scheduler.py`

### Depends On

- Batch 3

## Batch 8 - Global Navidrome Projection

### Goal

Publish system playlists to Navidrome so external Subsonic/OpenSubsonic clients can see them.

### Status

In progress. Backend/admin launch flow implemented on 2026-03-31.

### Deliverables

- system projection flow
- owner-of-system strategy
- public/shared visibility in Navidrome
- persisted mapping if needed between Crate playlist and Navidrome playlist id
- admin action to queue public Navidrome projection
- worker task to create/update a public Navidrome playlist from a system playlist
- persisted projection status, error and `navidrome_playlist_id` on `playlists`
- admin UI visibility for `pending` / `syncing` / `projected` / `errored`

### Depends On

- Batch 3
- product decision on which system playlists are projected publicly

## Batch 9 - Optional Personal Navidrome Projection

### Goal

Optionally allow linked users to copy playlists into their personal Navidrome space without changing the source of truth.

### Deliverables

- reuse current per-user Navidrome sync rules where appropriate
- explicit UX distinction from follow

### Depends On

- Batch 5
- current user sync work

## Current Recommendation

Finish Batch 1 completely before touching `listen` discovery or admin system-playlist UIs.

Immediate next steps:

1. validate the new playlist schema/helpers in dev
2. add read APIs for system playlists and followed playlists
3. wire a minimal read-only discovery surface in `listen`
