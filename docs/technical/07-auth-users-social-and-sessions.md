# Auth, Sessions, Users, and Social Layer

## Identity model

Crate has evolved from a simple local-login system into a real multi-user identity layer.

The current model combines:

- users in PostgreSQL
- persisted sessions
- JWT-based request identity
- external identities for OAuth providers
- auth invites
- public social profiles

This is much richer than a pure cookie login system.

## User records

The core user model is managed from [app/crate/db/auth.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/auth.py).

Relevant fields and concepts include:

- email
- username
- display name
- avatar
- bio
- role
- password hash
- external identities
- subsonic token
- last login

The DB layer also owns username suggestion and bootstrap admin seeding.

## Bootstrap admin

On an empty install, `_seed_admin()` in [app/crate/db/auth.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/auth.py):

- creates `admin@cratemusic.app`
- uses `DEFAULT_ADMIN_PASSWORD`
- ensures a stable admin username

This is part of the schema/init flow, not a separate setup script.

## Sessions

Crate now uses persisted sessions, not just stateless JWT.

Session behavior is implemented across:

- [app/crate/api/auth.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/auth.py)
- [app/crate/db/auth.py](https://github.com/diego-ninja/crate/blob/main/app/crate/db/auth.py)

Each session stores information such as:

- session id
- user id
- expiry
- created time
- last seen time
- IP
- user agent
- app id
- device label
- revoked state

This enables:

- device/session listing
- revoke current or other sessions
- "active sessions" in admin
- lightweight presence semantics

## Cookie and JWT model

Auth uses an HTTP-only cookie, but JWT still matters:

- the cookie stores the token
- the token carries user and session identity
- the session row is used to validate and manage long-lived state

This hybrid model gives Crate:

- easy request auth
- revocation and auditability
- compatibility across web and Capacitor/native shells

## OAuth providers

The auth layer supports:

- password
- Google OAuth
- Apple OAuth

Provider availability is not hard-coded only by environment. It is the combination of:

- env-based provider configuration
- settings-based provider enable/disable flags

That means providers can be configured technically but disabled product-wise.

## External identity model

External login is modeled canonically through `user_external_identities`, not only legacy fields such as `google_id`.

This is important because it:

- avoids provider-specific special cases
- supports account linking/unlinking
- allows one user to own several login methods

## Auth invites

Crate supports auth invites for private/beta-style onboarding.

Use cases:

- invite-only instances
- controlled onboarding
- joining via deep link and later continuing to the intended destination

This is part of the auth router, not a separate invitation subsystem.

## Frontend auth behavior

Listen auth in [app/listen/src/contexts/AuthContext.tsx](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/AuthContext.tsx):

- fetches `/api/auth/me`
- stores active user id in local storage
- heartbeats session activity
- clears playback/session-local state when the authenticated user changes
- clears queued telemetry on logout or account switch

This is important because Listen is effectively a stateful client with local playback state.

## Public social layer

The social API lives in [app/crate/api/social.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/social.py).

Core capabilities:

- public user profile lookup by username
- social search
- followers/following endpoints
- follow/unfollow mutations
- self social summary endpoint
- affinity exposure between viewer and viewed user

### Relationship model

Crate models follow relationships directly and derives friendship-like state:

- `following`
- `followed_by`
- `is_friend`

There is no separate friendship table in the v1 model.

## Affinity

Affinity is a computed product feature, not just a stored field.

The public profile response can include:

- `affinity_score`
- `affinity_band`
- `affinity_reasons`

This is intended to make similarity between users explainable, not just numeric.

## Public profiles

Public profile payloads include:

- username
- display name
- avatar
- bio
- joined date
- follower/following/friend counts
- public playlists
- relationship state relative to the viewer

This makes the social layer visible in Listen without requiring admin context.

## Collaborative playlists

Crate's user model now also intersects with collaboration:

- playlist owner
- collaborators
- playlist invite tokens
- public/private visibility

These are playlist-level product relationships rather than generic social graph edges, but they live in the same broader user system.

## Jam sessions

Jam rooms are another user-centered subsystem:

- host and collaborator roles
- invite-based join
- websocket-connected room state
- persisted jam room events and membership

The auth/session layer matters here because websocket access uses the same JWT/session identity semantics as HTTP routes.

## Design decisions in this layer

### Why persist sessions in DB

Because a music app benefits from session-aware behavior:

- multiple devices
- revoke-all-other-sessions
- app-specific device labels
- social and collaborative auditing

Pure stateless JWT would make these weaker or harder.

### Why make social profiles public

Crate's social layer is intentionally lightweight and product-facing:

- discovery through people
- affinity as a listening feature
- playlist collaboration

That works better when the profile surface is visible by default.

### Why auth is shared between admin and listen

Although the products are separate frontends, they share:

- user accounts
- sessions
- provider configuration
- social identity

This keeps Crate coherent as one platform.

## Related documents

- [Backend API and Data Layer](/technical/backend-api-and-data)
- [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
- [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
