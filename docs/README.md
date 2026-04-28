# Crate

Crate is a self-hosted music platform: it manages your library, enriches it
with external metadata, analyzes the audio, streams it through native and web
clients, and exposes two first-party frontends on top of one backend.

These docs are intended to match the current code, not a historical design.
The technical set below is the canonical architectural documentation.

## Start here

Read the technical set in order when you need an accurate picture of how the
system works today.

1. [System Overview](/technical/system-overview) — services, boundaries, read/write split, and product shape.
2. [Backend API and Data Layer](/technical/backend-api-and-data) — FastAPI, PostgreSQL, read models, domain events, and cache architecture.
3. [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services) — Dramatiq, daemons, projector, watcher, and scheduler.
4. [Library, Storage, Sync, and Imports](/technical/library-storage-sync-and-imports) — filesystem normalization and library ingestion.
5. [Enrichment, Acquisition, and External Integrations](/technical/enrichment-acquisition-and-integrations) — metadata providers, Tidal, Soulseek, and post-download normalization.
6. [Audio Analysis, Similarity, and Discovery Intelligence](/technical/audio-analysis-similarity-and-discovery) — Essentia, Bliss, and discovery primitives.
7. [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions) — persisted sessions, OAuth, presence, and social graph.
8. [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen) — React app structure, context boundaries, and shared UI strategy.
9. [Playback, Realtime, and Subsonic](/technical/playback-realtime-and-subsonic) — player engine, telemetry, realtime feeds, and `/rest`.
10. [Development, Deployment, and Operations](/technical/development-deployment-and-operations) — dev stack, deploy model, observability, and operator workflows.
11. [Documentation Platform and Hosted Site](/technical/documentation-platform-and-hosted-site) — how the docs/reference surfaces themselves are built.

## Focused references

These are shorter companion notes. They are intentionally high-level and should
not be treated as the authoritative contract when they disagree with the live
technical set or generated API docs.

- [Architecture summary](/reference/architecture)
- [API notes](/reference/api)
- [Audio analysis notes](/reference/audio-analysis)
- [Enrichment notes](/reference/enrichment)

## Historical plans and audits

`docs/plans/` and dated technical audits are kept as historical working notes.
They are useful for understanding why the system changed, but they are not the
source of truth for current runtime behavior.

## Live API reference

The exhaustive HTTP contract lives in the generated OpenAPI schema and the
Scalar reference app under `app/reference/`. Use those for exact request and
response shapes.

## Source code

The repository lives at [github.com/diego-ninja/crate](https://github.com/diego-ninja/crate).
Code references in the technical set link to files on `main`.
