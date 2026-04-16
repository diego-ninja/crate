# Crate Technical Documentation

This directory now contains two kinds of documentation:

- `plans/` for design notes, one-off roadmaps, and implementation plans.
- `technical/` for long-lived architectural documentation about how Crate is built today.

If you are orienting yourself in the codebase, read the documents in this order:

1. [System Overview](/Users/diego/Code/Ninja/musicdock/docs/technical/01-system-overview.md)
2. [Backend API and Data Layer](/Users/diego/Code/Ninja/musicdock/docs/technical/02-backend-api-and-data.md)
3. [Worker, Tasks, and Background Services](/Users/diego/Code/Ninja/musicdock/docs/technical/03-worker-tasks-and-background-services.md)
4. [Library, Storage, Sync, and Imports](/Users/diego/Code/Ninja/musicdock/docs/technical/04-library-storage-sync-and-imports.md)
5. [Enrichment, Acquisition, and External Integrations](/Users/diego/Code/Ninja/musicdock/docs/technical/05-enrichment-acquisition-and-integrations.md)
6. [Audio Analysis, Similarity, and Discovery Intelligence](/Users/diego/Code/Ninja/musicdock/docs/technical/06-audio-analysis-similarity-and-discovery.md)
7. [Auth, Sessions, Users, and Social Layer](/Users/diego/Code/Ninja/musicdock/docs/technical/07-auth-users-social-and-sessions.md)
8. [Frontend Architecture: Admin and Listen](/Users/diego/Code/Ninja/musicdock/docs/technical/08-frontends-admin-and-listen.md)
9. [Playback, Realtime, Visualizer, and Subsonic](/Users/diego/Code/Ninja/musicdock/docs/technical/09-playback-realtime-and-subsonic.md)
10. [Development, Deployment, and Operations](/Users/diego/Code/Ninja/musicdock/docs/technical/10-development-deployment-and-operations.md)
11. [Documentation Platform and Hosted Site](/Users/diego/Code/Ninja/musicdock/docs/technical/11-documentation-platform-and-hosted-site.md)

## Hosted docs surface

The repository markdown is now also rendered through the dedicated docs frontend in `app/docs`.

Target domains:

- `https://docs.cratemusic.app`
- `https://docs.dev.cratemusic.app`

## Existing topical docs

These older documents are still useful as focused references:

- [Architecture summary](/Users/diego/Code/Ninja/musicdock/docs/architecture.md)
- [API notes](/Users/diego/Code/Ninja/musicdock/docs/api.md)
- [Audio analysis details](/Users/diego/Code/Ninja/musicdock/docs/audio-analysis.md)
- [Enrichment details](/Users/diego/Code/Ninja/musicdock/docs/enrichment.md)

## Source-of-truth stance

The new `technical/` set was written against the code in:

- `/Users/diego/Code/Ninja/musicdock/app/crate`
- `/Users/diego/Code/Ninja/musicdock/app/ui/src`
- `/Users/diego/Code/Ninja/musicdock/app/listen/src`
- `/Users/diego/Code/Ninja/musicdock/docker-compose*.yaml`
- `/Users/diego/Code/Ninja/musicdock/Makefile`

It is intended to describe the current implementation rather than an aspirational future design.
