# Architecture

This file is now a short entry point. The full technical architecture has been expanded into the `technical/` set under [docs/README.md](/Users/diego/Code/Ninja/musicdock/docs/README.md).

## Fast orientation

Crate is a self-hosted music platform with:

- one FastAPI backend
- one worker runtime for background work and filesystem mutations
- two separate frontend products:
  - `app/ui` for administration
  - `app/listen` for listening, playback, discovery, and mobile/PWA use

The most important architectural rule is still the same:

- the API mounts `/music` read-only
- the worker mounts `/music` read-write
- all filesystem mutation flows go through background tasks

## Read these documents next

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
