# Crate

Crate is a self-hosted music platform: it manages your library, enriches it with
metadata, analyses the audio, streams it to any client that speaks Subsonic,
and ships two first-party frontends on top — an admin UI for librarians and a
listening app for daily use.

These docs describe how every subsystem actually works today. They're written
against the current code, not an aspirational design.

## Start here

If you're orienting yourself in the codebase, read the technical set in order.
Each document stands alone but they build on each other.

1. [System Overview](/technical/system-overview) — the big picture: services, data flow, boundaries.
2. [Backend API and Data Layer](/technical/backend-api-and-data) — FastAPI surface and PostgreSQL schema.
3. [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services) — how heavy work runs.
4. [Library, Storage, Sync, and Imports](/technical/library-storage-sync-and-imports) — filesystem ↔ DB.
5. [Enrichment, Acquisition, and External Integrations](/technical/enrichment-acquisition-and-integrations) — MusicBrainz, Last.fm, Tidal, Soulseek.
6. [Audio Analysis, Similarity, and Discovery Intelligence](/technical/audio-analysis-similarity-and-discovery) — Essentia, Bliss, recommendations.
7. [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions) — identity and the social graph.
8. [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen) — React 19, state, routing.
9. [Playback, Realtime, and Subsonic](/technical/playback-realtime-and-subsonic) — the audio engine and the streaming API.
10. [Development, Deployment, and Operations](/technical/development-deployment-and-operations) — running it, shipping it.
11. [Documentation Platform and Hosted Site](/technical/documentation-platform-and-hosted-site) — how this site itself is built.

## Focused references

Shorter topical notes that predate the full technical set but are still useful
as quick lookups:

- [Architecture summary](/reference/architecture)
- [API notes](/reference/api)
- [Audio analysis details](/reference/audio-analysis)
- [Enrichment details](/reference/enrichment)

## Source code

The repository lives at [github.com/diego-ninja/crate](https://github.com/diego-ninja/crate).
Every code reference in these docs links directly to the file on `main`.
