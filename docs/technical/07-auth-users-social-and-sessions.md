# Auth, Sessions, Users, and Social Layer

## Identity model

Crate has evolved from a simple local-login system into a real multi-user
identity layer.

The current model combines:

- users in PostgreSQL
- persisted sessions
- JWT-backed request identity
- external identities for OAuth providers
- auth invites
- public social profiles

## User records

The core user model is managed from `app/crate/db/repositories/auth.py`.

Relevant concepts include:

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

The data layer also owns bootstrap admin seeding, invite acceptance, username
logic, and lower-level session maintenance.

## Sessions

Crate uses persisted sessions, not only stateless JWT.

Session behavior spans:

- `app/crate/api/auth.py`
- `app/crate/db/repositories/auth.py`

Each session stores data such as:

- session id
- user id
- expiry
- created/last-seen timestamps
- IP
- user agent
- app id
- device label
- revoked state

This enables:

- device/session listing
- revoke current or other sessions
- presence-like behavior
- explicit session cleanup

## Cookie and token model

Auth is hybrid by design:

- cookies are used for first-party web apps
- JWT carries session/user identity
- session rows enforce revocation and lifecycle
- bearer tokens are used by native Listen clients

There are separate cookie names for admin-style and listen-style web auth so
both surfaces can coexist cleanly.

## OAuth providers

The auth layer supports:

- password
- Google OAuth
- Apple OAuth

Availability is determined by both:

- environment configuration
- settings-based enable/disable flags

## External identity model

External login is modeled canonically through `user_external_identities`, not
provider-specific columns.

This makes account linking/unlinking and multi-provider ownership much cleaner.

## Auth invites

Crate supports invite-driven onboarding.

At the DB layer, invite creation and consumption live in repository helpers so
invite acceptance can participate in the same transaction as user creation or
session issuance.

## Frontend auth behavior

### Admin UI

- cookie/session oriented
- operator-facing
- no multi-server model

### Listen Web

- same-origin web app
- persisted session plus auth token handling in the web client
- auth bootstrap via `/api/auth/me`
- session heartbeat while active

### Listen Capacitor

Listen native builds are explicitly **multi-server**:

- the app stores a list of configured Crate servers
- each server can hold its own bearer token
- the current server can change live without a full app reload

The relevant client boundary lives in:

- `app/listen/src/lib/server-store.ts`
- `app/listen/src/lib/api.ts`

## Listen auth runtime

The public `AuthContext` in Listen is now a thin facade over focused internals:

- `use-auth-session.ts` — `/api/auth/me` bootstrap and re-fetch
- `use-auth-oauth-sync.ts` — callback/deep-link completion
- `use-auth-heartbeat.ts` — active-session heartbeat
- `lib/capacitor.ts` and related modules — native boundary and OAuth payload
  persistence

That split matters because Listen is a stateful client with playback, offline
state, and per-server auth concerns.

## Public social layer

The social API lives in `app/crate/api/social.py`.

Core capabilities:

- public user profile lookup by username
- social search
- followers/following endpoints
- follow/unfollow mutations
- self social summary
- affinity exposure between viewer and viewed user

## Collaborative features

User identity also intersects with:

- playlist ownership and collaboration
- playlist invite tokens
- jam room host/collaborator roles
- jam invite flows

Auth in Crate is therefore not only request validation; it is part of the
product model.
