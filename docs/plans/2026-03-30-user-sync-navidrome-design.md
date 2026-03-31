# Crate Listen User Sync / Navidrome Design

**Date**: 2026-03-30
**Status**: In Progress
**Scope**: identity sync between `listen`, Crate users, and Navidrome users

## Goal

Define a correct user-sync model for `app/listen` so that:

- `listen` authenticates against Crate users
- each Crate user can be linked to exactly one Navidrome user
- user-scoped actions that depend on Navidrome use the correct identity
- playback remains `Navidrome first`, with fallback to Crate local streaming when Navidrome is unavailable

This design is intentionally separate from Google / Apple auth. Social auth can plug into Crate later, but the identity model must be solved first.

Important scope note:

- this document is about per-user Navidrome identity
- it does not define the projection of global system playlists to Navidrome for external Subsonic/OpenSubsonic clients
- global/public system-playlist projection must be treated as a separate system-level concern

## Current Reality

Today there are two identity systems living side by side:

### Crate identity

- `listen` signs in against `/api/auth/login`
- auth is represented by Crate JWT cookie (`crate_session`)
- users live in `users` table with:
  - `id`
  - `email`
  - `username`
  - `name`
  - `password_hash`
  - `google_id`
  - `role`
- user-personal data already hangs from Crate `user_id`:
  - follows
  - saved albums
  - liked tracks
  - play history
  - playlists

### Navidrome identity

- public Navidrome web UI is exposed behind Traefik on `play.${DOMAIN}`
- Traefik uses `crate-auth-soft` forward auth
- `/api/auth/verify-soft` injects `Remote-User` using `user.username` or email prefix
- backend helper module `crate/navidrome.py` talks to Navidrome with global env credentials:
  - `NAVIDROME_USER`
  - `NAVIDROME_PASSWORD`
- Crate backend APIs like:
  - `/api/navidrome/stream/{song_id}`
  - `/api/navidrome/star`
  - `/api/navidrome/unstar`
  - `/api/navidrome/scrobble`
  - playlist sync worker
  are therefore effectively server-global, not user-scoped

## Problem Statement

The current setup is good enough for a single-user or dev environment, but not for real multi-user behavior.

Main issues:

- Crate knows who the user is; Navidrome API calls mostly do not
- `verify-soft` can impersonate a Navidrome username at the reverse-proxy level, but backend service-to-service calls still use a shared Navidrome account
- user-personal actions are split:
  - follows / likes / saved albums / playlists are stored in Crate
  - streaming / star / scrobble / playlist creation in Navidrome currently behave more like shared integration actions
- playlist sync can create/update playlists in the wrong Navidrome user context if we do not model the link explicitly

This problem statement applies to user-scoped actions.
It should not be conflated with global/public system playlists that may need to exist in Navidrome independently of any user link.

## Design Principles

1. Crate is the source of truth for app identity.
2. Navidrome user linkage is explicit, not inferred ad hoc from email prefix.
3. Playback identity and library identity are not the same thing.
4. The model must work when Navidrome is down.
5. The first implementation should be safe and observable before it is fully automatic.

## Core Model

### Primary identity

Crate `users.id` remains the primary identity for:

- auth/session
- app permissions
- playlists
- follows
- likes
- saved albums
- play history
- future push settings / sync preferences

### Linked identity

Add a dedicated Navidrome linkage layer instead of overloading `users.username`.

Recommended table:

`user_external_identities`

Fields:

- `id`
- `user_id` FK -> `users.id`
- `provider` (`'navidrome'` initially)
- `external_user_id` nullable
- `external_username` nullable
- `status` text
  - `unlinked`
  - `pending`
  - `linked`
  - `error`
- `metadata_json`
- `last_synced_at`
- `created_at`
- `updated_at`

Unique constraints:

- unique `(provider, user_id)`
- unique `(provider, external_username)` when not null

Why a dedicated table:

- future-proofs Apple / Google / Discogs / Last.fm linkage without polluting `users`
- lets us track sync status and errors
- avoids making `users.username` secretly “the Navidrome contract”

## Navidrome Link Semantics

For `provider = 'navidrome'`:

- `external_username` is the Navidrome username to impersonate / target
- `external_user_id` can be filled later if Navidrome exposes/requires a stable user id we can query reliably
- `status = linked` means:
  - the Navidrome user exists
  - Crate has verified the mapping
  - user-scoped Navidrome operations are allowed

## Proposed User Sync States

For a logged-in `listen` user, user sync should expose something like:

- `navidrome_enabled`: server has Navidrome configured and reachable
- `link_status`: `unlinked | pending | linked | error`
- `linked_username`
- `can_stream_via_navidrome`
- `can_sync_playlists`
- `can_star_in_navidrome`
- `fallback_mode`: `local_stream`
- `last_error`

This becomes the UI contract for gating features.

## UX Rules

### Before link exists

- `listen` still works
- local playback can still fall back to `/api/stream/...`
- Crate-local library features still work:
  - likes
  - follows
  - saved albums
  - playlists
- Navidrome-dependent user actions should be disabled or marked as unavailable:
  - sync playlist to Navidrome
  - direct Navidrome favorites sync
  - Navidrome-only scrobble semantics

### After link exists

- playback prefers Navidrome stream URLs when `navidromeId` is present and server is reachable
- playlist sync is enabled
- user-scoped Navidrome actions are enabled

## Playback Strategy

This is the most important product rule:

- `listen` uses Navidrome as primary playback backend
- if Navidrome is unavailable, playback falls back to Crate local streaming

Current `PlayerContext` already supports this shape because a track may carry:

- `libraryTrackId`
- `path`
- `navidromeId`

Recommended final contract:

- `libraryTrackId`: library identity in Crate
- `navidromeId`: preferred playback identity when available
- `path`: fallback playback identity

Decision:

- do not block playback on user sync
- block only the user-scoped Navidrome mutations

That means:

- streaming may still use server-side Navidrome proxy even before user link if we decide that is acceptable
- but starring, scrobbling, playlist sync, and future “resume across devices” should require linked identity

## Backend Changes

### 1. Schema

Add new table:

- `user_external_identities`

Implemented in current batch:

- `user_external_identities` added to schema
- helper functions added in `crate.db.auth`
- `list_users()` now exposes current Navidrome sync state for admin UI

Optional future table:

- `user_sync_events`

for audit/history of link attempts, errors, and reconciliations

### 2. DB helpers

Add DB module functions such as:

- `get_user_external_identity(user_id, provider)`
- `upsert_user_external_identity(...)`
- `set_user_external_identity_status(...)`
- `list_unlinked_users(provider)`

### 3. New API surface

Add a dedicated API domain, for example:

- `GET /api/me/sync`
  returns sync status for current user

- `POST /api/me/sync/navidrome/link`
  body:
  - `username`
  behavior:
  - validate server connectivity
  - validate Navidrome username exists or is allowed
  - store link

- `POST /api/me/sync/navidrome/unlink`
  removes the link or sets `unlinked`

- `POST /api/me/sync/navidrome/verify`
  rechecks the existing link

Implemented in current batch:

- `GET /api/me/sync`
- `GET /api/auth/navidrome/users` (admin)
- `GET /api/auth/users/{user_id}/sync` (admin)

## Separation From System Playlist Projection

Global system playlists are a different concern from user sync.

Rules:

- a system playlist may need to be projected to Navidrome as public/shared so external clients can see it
- that projection should be owned by a system account or system-level integration path
- it should not require a linked Crate user
- user follow in Crate should remain independent of whether a public projection exists in Navidrome

Therefore:

- `user sync` governs personal/user-scoped Navidrome actions
- `system projection` governs public/editorial playlist publication into Navidrome
- `POST /api/auth/users/{user_id}/navidrome-link` (admin)
- `POST /api/auth/users/{user_id}/navidrome-unlink` (admin)

### 4. Gating existing endpoints

Endpoints that should check user linkage before acting in user-scoped mode:

- `/api/playlists/{id}/sync-navidrome`
- `/api/navidrome/star`
- `/api/navidrome/unstar`
- `/api/navidrome/scrobble`

These should fail with a clear `409` or `412` style error when user sync is not ready.

Current status:

- not gated yet
- playlist sync in `listen` is still exposed, but the data model to gate it now exists

### 5. Navidrome client strategy

This is the architectural fork.

#### Option A: Keep server-global Navidrome API creds, but gate by linked username

Meaning:

- Crate still talks to Navidrome with one service account
- user link is used to decide whether a user is allowed to perform Navidrome-scoped actions
- Traefik `verify-soft` still gives per-user browser access to the Navidrome UI

Pros:

- simplest rollout
- no password/token storage per Navidrome user
- works well if Crate is the orchestration layer

Cons:

- backend Navidrome mutations are still not truly per-user at the API credential level
- depends on how Navidrome stores ownership / permissions internally

#### Option B: Store user-scoped Navidrome credentials or app passwords

Meaning:

- each linked user also has Navidrome API credentials
- Crate calls Navidrome on behalf of that user

Pros:

- true per-user semantics

Cons:

- much more complex and sensitive
- requires secret storage
- probably poor UX unless Navidrome supports app passwords well

Recommendation:

- implement Option A first
- structure the DB/API so Option B remains possible later

## Proposed Linking Rule

The safest first rule is:

- Crate `user.username` is the default suggested Navidrome username
- actual link is stored separately in `user_external_identities`
- link must be explicitly verified, not silently assumed

Why:

- `verify-soft` already uses `username` for `Remote-User`
- that keeps browser access compatible
- but we avoid treating `username` as guaranteed linkage truth in the DB model

Current implementation note:

- new Crate users now receive a generated `username` by default if they did not have one
- signup/admin create queue a Navidrome sync task against that username
- `verify-soft` now prefers the linked Navidrome username when one exists

## Listen App Changes

### New sync context / hook

Add something like:

- `useUserSync()`

Responsibilities:

- fetch `/api/me/sync`
- expose:
  - `navidromeLinked`
  - `navidromeEnabled`
  - `canSyncPlaylists`
  - `canUseNavidromeFeatures`
  - `refreshSyncStatus`

### UI entry points

Recommended surfaces:

- user menu in `TopBar`
  - `Sync services`
  - status badge

- dedicated page or modal
  - link Navidrome username
  - show current status
  - retry verification
  - unlink

### Gating in listen

- playlist page:
  - `Sync to Navidrome` hidden or disabled until linked

- future album/track actions:
  - only offer Navidrome mutation actions if linked

- player:
  - keep Navidrome-first streaming logic
  - if stream fails, fallback to `/api/stream/...`
  - do not hard-fail the whole player on missing user sync

## Recommended Rollout

### Phase 1: Model and status

- add `user_external_identities`
- add DB helpers
- add `/api/me/sync`
- add `listen` status hook and basic UI state
- mark Navidrome user actions as disabled when not linked

Status:

- schema + helpers done
- `/api/me/sync` done
- `admin > Users` manual link/create/unlink UI done
- `listen` now has `UserSyncContext` and playlist-sync gating
- `listen` `TopBar` now shows current Navidrome status in the user menu

### Phase 2: Manual link

- add link/unlink/verify endpoints
- add `listen` modal/page for Navidrome link
- require linked status for playlist sync and other mutations

Status:

- admin link/unlink endpoints done
- manual admin UI done
- verify is currently implicit through admin existing-user lookup or worker provisioning
- playlist sync endpoint now requires a synced linked identity and passes the linked username into the worker
- playlist sync worker now creates the Navidrome playlist as the linked external username
- `listen` user-facing link UI still pending

### Phase 3: Safer playback / mutation split

- make explicit which actions require:
  - only Navidrome availability
  - Navidrome availability + user link
- add stream fallback handling in player UX

### Phase 4: Optional full reconciliation

- optionally sync selected Crate-local user data to Navidrome:
  - playlists
  - favorites
  - play activity

This should remain selective. Crate should not automatically collapse all personal data into Navidrome until the ownership rules are fully clear.

## Non-Goals For This Phase

- Google / Apple sign-in
- per-user Navidrome secret storage
- automatic provisioning of Navidrome users
- full two-way sync of likes/history/playlists

## Main Recommendation

Build `user sync` as an explicit identity-link layer, not as a hidden convention around `username`.

Short version:

- Crate user remains the real app user
- Navidrome user becomes a linked external identity
- playback stays Navidrome-first with local fallback
- user-scoped Navidrome mutations are gated on verified link status

This is the smallest design that is safe, understandable, and extensible.
