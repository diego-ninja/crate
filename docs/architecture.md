# Architecture

A short orientation. For the current detailed picture, read the
[technical set](/) in order.

## Fast orientation

Crate is a self-hosted music platform with:

- one FastAPI backend
- one Go read plane for low-latency snapshot-backed reads and SSE relay
- split worker runtimes for fast/default tasks, maintenance, analysis,
  playback/transcode, projection, and media package generation
- two separate frontend products:
  - `app/ui` for administration and operations
  - `app/listen` for playback, discovery, social, and mobile/PWA use

The most important system boundary is still:

- the API mounts `/music` read-only
- the worker mounts `/music` read-write
- all filesystem mutation flows go through the worker

## What changed in the current architecture

The modern runtime is not just “API + jobs” anymore. It now also includes:

- a **read plane** of snapshot-backed and runtime-backed UI surfaces
- a dedicated **Go readplane service** for hot Listen/Admin routes with
  FastAPI fallback
- a **Redis Streams domain-event bus** used to warm those surfaces
- a dedicated **projector container** that consumes domain events and refreshes
  affected snapshots
- a **Rust media worker** for download package generation with Redis-backed
  progress/cancel state
- a **resource governor** and maintenance window that defer expensive
  background work when playback or the host are under pressure
- **pipeline shadow tables** such as `track_processing_state`,
  `track_analysis_features`, and `track_bliss_embeddings`
- **canonical listening telemetry** in `user_play_events`

## Core layers

- **Operational write plane** — API mutations, worker handlers, task rows,
  acquisition, tag writes, scans, repairs.
- **Library/data plane** — PostgreSQL tables for library entities, users,
  sessions, settings, telemetry, social graph, playlists, and tasks.
- **Read plane** — UI snapshots, ops runtime state, import queue read models,
  snapshot SSE streams, and warmed home/admin surfaces.
- **Playback/client plane** — Listen app, stream endpoints, play-event writes,
  realtime UI feeds, media session, and Subsonic compatibility.

## Read these documents next

1. [System Overview](/technical/system-overview)
2. [Backend API and Data Layer](/technical/backend-api-and-data)
3. [Worker, Tasks, and Background Services](/technical/worker-tasks-and-background-services)
4. [Library, Storage, Sync, and Imports](/technical/library-storage-sync-and-imports)
5. [Enrichment, Acquisition, and External Integrations](/technical/enrichment-acquisition-and-integrations)
6. [Audio Analysis, Similarity, and Discovery Intelligence](/technical/audio-analysis-similarity-and-discovery)
7. [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
8. [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
9. [Playback, Realtime, and Subsonic](/technical/playback-realtime-and-subsonic)
10. [Development, Deployment, and Operations](/technical/development-deployment-and-operations)
