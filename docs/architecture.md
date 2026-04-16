# Architecture

A one-page orientation. For the full architecture, read the [technical set](/)
in order — it covers each subsystem in depth.

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

1. [System Overview](/technical/system-overview)
2. [Backend API and Data Layer](/technical/backend-api-and-data)
3. [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services)
4. [Library, Storage, Sync, and Imports](/technical/library-storage-sync-and-imports)
5. [Enrichment, Acquisition, and External Integrations](/technical/enrichment-acquisition-and-integrations)
6. [Audio Analysis, Similarity, and Discovery Intelligence](/technical/audio-analysis-similarity-and-discovery)
7. [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
8. [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
9. [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
10. [Development, Deployment, and Operations](/technical/development-deployment-and-operations)
