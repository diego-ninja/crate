# Library, Storage, Sync, and Imports

## The library as both filesystem and database

Crate's library model has two parallel realities:

- the real files under `/music`
- the normalized representation in PostgreSQL

The sync layer keeps those worlds aligned, while the import/storage layer controls how new files enter the canonical library.

## Configured library root

[app/config.yaml](/Users/diego/Code/Ninja/musicdock/app/config.yaml) declares:

- `library_path: /music`
- supported audio extensions
- excluded directories
- import sources
- scanner configuration

This file is mounted into API and worker and is the root of several behaviors:

- sync
- watcher
- imports
- scanners
- repair and naming logic

## Storage models

### Legacy layout

Historically, Crate has used human-readable directory structures such as:

- `Artist/Album/Track.flac`
- `Artist/Year/Album/Track.flac`

These are easy to inspect manually but fragile:

- special characters
- leading dots
- rename cascades
- duplicate artist folder variants

### Storage V2

Crate is migrating toward UUID-backed storage paths via [app/crate/storage_layout.py](/Users/diego/Code/Ninja/musicdock/app/crate/storage_layout.py).

The new shape is conceptually:

- artist directory by `artist.storage_id`
- album directory by `album.storage_id`
- track file name by `track.storage_id`

This makes physical paths opaque and stable, decoupling them from display names.

### Transitional reality

Current Crate supports both:

- legacy name-based folders
- v2 storage-id-based folders

Helpers like `resolve_artist_dir()` and `resolve_album_dir()` exist precisely because the migration is still in progress.

## Sync architecture

[app/crate/library_sync.py](/Users/diego/Code/Ninja/musicdock/app/crate/library_sync.py) is the core filesystem indexing layer.

### Responsibilities

- walk artist and album directories
- infer canonical artist names
- read tags and media metadata
- upsert artists, albums, and tracks
- detect deletions
- maintain denormalized counters
- skip unnecessary rework when mtimes and track counts suggest no change

### Key design choices

#### Canonical artist grouping

Multiple artist folders can map to one canonical DB artist. This handles cases such as:

- casing differences
- renamed folders
- multi-folder transitional states

#### Album tree support

The sync layer supports both:

- two-level libraries
- three-level `Artist/Year/Album` libraries

#### Mtime short-circuiting

Sync avoids full rescans when:

- stored mtime is recent enough
- track counts still match

This keeps full library sync reasonably cheap on large libraries.

#### FFprobe fallback

When mutagen cannot parse enough info, the sync layer can fall back to `ffprobe` for duration and bitrate.

## Watcher-driven incremental sync

[app/crate/library_watcher.py](/Users/diego/Code/Ninja/musicdock/app/crate/library_watcher.py) complements full sync with event-driven updates.

Key behaviors:

- only reacts to created or moved files, not every modification
- ignores known photo/cover outputs
- debounces by album directory
- respects processing flags to avoid reacting to worker-owned mutations
- queues `process_new_content` only when newly added content actually needs downstream work

The watcher is intentionally conservative because enrichment and repair themselves can write files.

## Imports and staging

Imports are separate from the canonical library.

[app/config.yaml](/Users/diego/Code/Ninja/musicdock/app/config.yaml) defines import roots for:

- Tidal
- Soulseek
- related staging areas

Crate treats these as raw intake zones, not final library destinations.

## Acquisition to library flow

The normal ingestion path is:

1. external download or upload lands in a staging/import area
2. worker normalizes names and structure
3. target artist/album destination is resolved
4. files are moved into the canonical library
5. sync indexes them
6. post-ingest enrichment and analysis are queued

The worker acquisition handler in [app/crate/worker_handlers/acquisition.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/acquisition.py) owns a lot of this handoff logic.

## Name sanitation and directory resolution

Acquisition code does several important normalization steps:

- sanitize invalid path characters
- strip dangerous leading dots
- choose visible artist folder names over hidden variants
- align staged artist folders with existing library folders when possible

This is especially important for artist names that would otherwise create hidden directories or invalid paths.

## Organizer and repair layer

Beyond sync, Crate contains maintenance tooling for library shape:

- organizer logic
- duplicate detection
- naming checks
- incomplete albums
- mergeable partials
- auto-repair and fix application

The scanner/fixer stack is configured in [app/config.yaml](/Users/diego/Code/Ninja/musicdock/app/config.yaml) and implemented across:

- `/Users/diego/Code/Ninja/musicdock/app/crate/scanners`
- organizer and repair modules
- related worker handlers

These tools let Crate act not just as an indexer, but as an opinionated library maintenance system.

## Storage migration

Storage migration is a first-class background capability:

- `migrate_storage_v2`
- `verify_storage_v2`

These tasks exist because storage-v2 is not merely a new naming pattern. It changes physical identity assumptions across:

- acquisition
- sync
- playback identity
- path-based operations

## Design decisions in this layer

### Why not write directly into final folders from every integration

Because every source has its own quirks:

- Tidal emits temporary/intermediate files
- Soulseek can produce inconsistent folder names
- uploads can contain zip structure surprises

Using staging/import logic gives Crate a place to normalize before the library becomes canonical.

### Why keep sync even with a watcher

The watcher is not enough by itself:

- it can miss events after outages or container restarts
- large restructures are easier to validate with full sync
- mtime-based full sync provides repair and correctness guarantees

The watcher is for freshness. Full sync is for truth reconciliation.

### Why storage-v2 matters

The storage-id model is ultimately about robustness:

- stable paths
- safe handling of weird names
- simpler renames
- cleaner reconciliation between DB identity and filesystem identity

## Related documents

- [Worker, Tasks, and Background Services](/Users/diego/Code/Ninja/musicdock/docs/technical/03-worker-tasks-and-background-services.md)
- [Enrichment, Acquisition, and External Integrations](/Users/diego/Code/Ninja/musicdock/docs/technical/05-enrichment-acquisition-and-integrations.md)
- [Development, Deployment, and Operations](/Users/diego/Code/Ninja/musicdock/docs/technical/10-development-deployment-and-operations.md)
