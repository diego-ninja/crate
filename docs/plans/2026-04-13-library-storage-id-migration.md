# Library Storage IDs and Filesystem Layout V2

## Why we are doing this

The current library layout couples filesystem names to artist and album names:

- artist folder names become identity (`folder_name`)
- album directories become identity (`library_albums.path`)
- track paths become identity in too many places (`playlist_tracks.track_path`, play history fallbacks, radio seeds, likes/history payloads)

This is fragile in production. We are already seeing real failures and inconsistencies from:

- leading dots creating hidden folders
- provider-normalized names not matching canonical names
- unicode and punctuation edge cases
- renames implying filesystem moves
- acquisition/import pipelines having to guess the correct folder
- mixed reliance on `track_path` instead of stable track identity

Before a public release, storage needs to become boring and robust.

## Decision

We will move Crate to a **managed storage layout** where the filesystem uses stable opaque IDs instead of artist/album names.

### High-level decision

- Add a stable `storage_id` to `library_artists`, `library_albums`, and `library_tracks`
- Use those IDs to build the library filesystem layout
- Make the database the source of truth for artist/album/track identity
- Treat filesystem names as storage addresses, not metadata
- Stop using `track_path` as identity for user actions, playlists, radio seeds, and playback
- Use `track_id` internally in the DB, and `track.storage_id` as the public opaque track identifier where needed

## ID recommendation

### Recommendation: `UUIDv4`

Use `UUIDv4` stored in PostgreSQL `UUID` columns and serialized as canonical strings.

Why:

- standard and widely understood
- native support in Python stdlib (`uuid.uuid4()`)
- no new dependency required
- no need for time-sortable IDs in filesystem paths
- lower implementation risk than UUIDv7/ULID right now

### Not recommended for this phase

- `ULID`: nice ergonomics, but introduces another format and dependency without meaningful benefit here
- `UUIDv7`: attractive, but not necessary for storage paths and slightly more implementation complexity for little gain

## Final storage model

### Database identity

Keep current numeric PKs for relational joins:

- `library_artists.id`
- `library_albums.id`
- `library_tracks.id`

Add new stable storage IDs:

- `library_artists.storage_id UUID NOT NULL UNIQUE`
- `library_albums.storage_id UUID NOT NULL UNIQUE`
- `library_tracks.storage_id UUID NOT NULL UNIQUE`

### Filesystem identity

Filesystem layout becomes opaque and deterministic:

```text
/music/<artist_storage_id>/<album_storage_id>/<track_storage_id>.<ext>
```

Example:

```text
/music/9d53c5bb-38a9-4d8f-8d5e-fd8a7f2fd7a1/1c6d7d4a-9f68-4411-9f4a-6f0ea59f46f8/0d7c4d0e-8e83-48d5-8a86-8dcb6ef7875d.flac
```

### Why fully opaque filenames too

We should not stop at artist/album directories only. Track filenames can also cause invalid/awkward paths, and title-based filenames create rename churn.

Using `track.storage_id` as the filename:

- removes title sanitization as a correctness concern
- avoids renaming files when tags change
- makes the path fully deterministic
- makes move/import code much simpler

Track order remains a metadata concern in DB/tags, not a filesystem concern.

## Source of truth after migration

### Database becomes authoritative for

- canonical artist name
- canonical album name
- canonical track title
- slugs
- relationships
- paths
- artwork/photo/background resolution targets

### Filesystem becomes authoritative only for

- file existence
- file bytes
- file mtimes/hashes

## Scope

This is not just a folder rename. It is a storage-layer migration touching:

- schema
- acquisition
- sync
- repair
- enrichment
- artwork
- playlists
- user library history/stats
- radio
- playback contracts
- `listen`
- `admin`

## Non-goals

- changing artist/album web routes from `id + slug` to storage IDs
- changing user-facing URLs in `listen` or `admin` unless required
- changing tags solely for cosmetic filesystem naming
- supporting unmanaged manual edits directly inside `/music` forever

## Critical architectural consequence

The current scanner/sync model assumes `/music` is both:

- the storage layer
- and the discovery layer

Opaque ID-based folders make manual filesystem discovery by folder name much less meaningful.

### Therefore:

We should explicitly move toward:

- `/music` as a **managed library**
- optional `/imports` or acquisition staging as the place for unmanaged/manual drops

This is the correct tradeoff for robustness.

## Implementation plan

## Phase 0: Freeze the target design

Before coding:

- agree on final path format
- agree on `UUIDv4`
- agree that `track.storage_id` becomes the public opaque track identifier
- agree that `track_id`, not `track_path`, is the internal reference for likes/playlists/history/radio
- agree that `/music` is managed storage

## Phase 1: Schema additions

### 1.1 Add storage IDs

Add to schema:

- `library_artists.storage_id UUID`
- `library_albums.storage_id UUID`
- `library_tracks.storage_id UUID`

Constraints:

- backfill all existing rows
- then mark `NOT NULL`
- unique index on each

### 1.2 Add track identity to playlist rows

Current problem:

- `playlist_tracks` stores only `track_path`

Add:

- `playlist_tracks.track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL`
- optional `playlist_tracks.track_storage_id UUID` is not required if `track_id` exists

Goal:

- DB relations use `track_id`
- `track_path` remains temporary compatibility data only

### 1.3 Make history/stat tables path-optional, not path-identity

Current tables already have `track_id` in many places, but still lean on `track_path`:

- `play_history`
- `user_play_events`
- `user_track_stats`

Plan:

- keep `track_path` as historical snapshot/debug field
- make all lookups and writes prefer `track_id`
- stop treating `track_path` as the thing that identifies the track

### 1.4 Optional but recommended: add `relative_path`

Current `path` fields are absolute.

Recommendation:

- keep `path` for compatibility in this phase
- optionally add `relative_path` later if we want to decouple DB rows from a specific mount point

This is useful, but not required to ship V2.

## Phase 2: Centralize path construction

Create a single storage layout module, for example:

- `app/crate/storage_layout.py`

This module must be the only place allowed to build managed library paths.

Functions:

- `artist_dir(library_root, artist_storage_id) -> Path`
- `album_dir(library_root, artist_storage_id, album_storage_id) -> Path`
- `track_path(library_root, artist_storage_id, album_storage_id, track_storage_id, ext) -> Path`
- `is_storage_v2_artist_dir(path) -> bool`
- `is_storage_v2_album_dir(path) -> bool`
- `parse_storage_v2_path(path) -> tuple[...] | None`

Also add helpers:

- `ensure_storage_ids(...)`
- `build_storage_track_filename(track_storage_id, ext)`

### Rule

No more ad-hoc `lib / artist_name / album_name` path building in worker/api code.

## Phase 3: Dual-read, dual-write compatibility layer

We need a transition period where:

- legacy named folders still work
- new writes go to storage V2

### 3.1 Reads

All path resolution helpers should support:

- legacy v1 artist/album folders
- new v2 storage layout

### 3.2 Writes

All new acquisition/imports should write to V2 immediately:

- Tidal downloads
- Soulseek downloads
- setlist playlist exports if they touch files
- future external imports

### 3.3 Lookup preference

When a row already has a V2 `path`, use it directly.

Never attempt to “re-derive” a path from artist/album names if a DB path exists.

## Phase 4: Stop using `track_path` as identity

This is mandatory. The storage migration will remain fragile unless we do this.

### 4.1 Likes

Current direction:

- likes can still be resolved from `track_path`

Target:

- likes use `track_id`
- API accepts `track_id`
- `track_path` support becomes compatibility-only and then is removed

### 4.2 Playlists

Current problem:

- `playlist_tracks.track_path` is the core reference

Target:

- `playlist_tracks.track_id` is the primary relation
- `track_path` remains only as historical compatibility during migration

Required work:

- backfill `playlist_tracks.track_id`
- update queries in [playlists.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/playlists.py) to join by `track_id` first
- update inserts to always persist `track_id`

### 4.3 Radio

Current problem:

- track radio still resolves seeds from `path`

Target:

- radio seed identity is `track_id`
- `path` input stays only as temporary fallback

### 4.4 Playback events and stats

Target:

- all new analytics writes use `track_id`
- `track_path` is stored only as snapshot/debug if we decide to keep it at all

### 4.5 Queue and player state

Target:

- queue persistence and playback use `track_id` and `track.storage_id`
- never require a raw filesystem path in the client

## Phase 5: API contract changes

## 5.1 Track payloads

All track payloads sent to clients should consistently include:

- `track_id` (numeric internal DB id)
- `track_storage_id` (public opaque UUID)

We should stop relying on overloaded `id` semantics.

### Recommended contract

- `track_id`: internal numeric DB id
- `storage_id`: public opaque identifier for playback/client identity
- `path`: legacy compatibility only, progressively removed from clients

## 5.2 Stream endpoints

Current state in `listen`:

- playback still falls back to `track.path`

Target:

- stream by `track_id` or `track.storage_id`
- no public stream URL should require path segments from the library

Recommended endpoint strategy:

- keep `/api/tracks/{track_id}/stream` for internal numeric-id callers
- add `/api/tracks/by-storage/{storage_id}/stream`
- progressively move clients to `storage_id`

## 5.3 Like/history APIs

Target request payloads:

- like/unlike: `track_id`
- play event: `track_id`
- queue/radio session payloads: `track_id`, optionally `storage_id`

## Phase 6: Acquisition rewrite for V2 paths

### 6.1 Tidal

When Tidal finishes:

- resolve or create artist row
- ensure `artist.storage_id`
- resolve or create album row
- ensure `album.storage_id`
- create/resolve tracks and `track.storage_id`
- move files directly into V2 path

Never derive final location from provider folder names.

### 6.2 Soulseek

Same principle:

- incoming files may arrive under arbitrary names
- final managed library placement must be V2 path-based
- any provider/source name becomes metadata only

### 6.3 Import staging

All acquisitions should go:

- provider/source -> staging
- staging -> canonical DB resolution
- DB resolution -> V2 library move

## Phase 7: Sync and scanner split

This is where the architecture changes meaningfully.

## 7.1 Managed library sync

For V2 folders, sync should be DB-driven:

- discover artist directory by `artist.storage_id`
- discover album directory by `album.storage_id`
- verify files exist
- verify file count/hash/mtime
- update metadata from tags only where intended

No folder-name inference should be involved.

## 7.2 Legacy discovery sync

Keep legacy name-based scanning only for:

- old library paths during migration
- optional import/inbox scanning

## 7.3 Recommended new split

- `/music`: managed V2 library
- `/imports`: optional human/manual drop zone using legacy scanning rules

This keeps robustness without killing manual imports.

## Phase 8: Data migration in production

## 8.1 Backfill storage IDs first

Safe, online migration:

- add nullable columns
- backfill all rows
- add unique indexes
- mark columns not null

No file moves yet.

## 8.2 Backfill relational references

Before moving files:

- backfill `playlist_tracks.track_id`
- verify history/event tables resolve `track_id`
- update API writers so new writes already stop depending on `track_path`

This is the critical prerequisite.

## 8.3 Introduce dual-read support

Deploy code that can read both:

- legacy named layout
- V2 opaque layout

Only after this is in production should filesystem moves begin.

## 8.4 Migrate files artist-by-artist in worker tasks

Implement a dedicated worker task, for example:

- `migrate_library_storage_v2`

Behavior:

- select one artist at a time
- create V2 target directories
- move albums/tracks into V2 layout
- update `library_albums.path`
- update `library_tracks.path`
- keep transaction boundaries tight around DB writes
- emit progress and resumable checkpoints

### Strong recommendation

Do not migrate the entire library in one transaction or one giant task.

## 8.5 Verification after each artist

After each migrated artist:

- verify all track files exist at target
- verify track counts match
- verify album counts match
- verify artwork/photo/background lookups still work
- verify no hidden legacy leftovers remain

## 8.6 Rollback strategy

For the migration task:

- log source and destination paths
- keep idempotent checkpoints
- only delete empty legacy folders after verification

If a task fails mid-artist:

- DB must still point to the last fully-committed state
- rerun should resume cleanly

## Phase 9: Cleanup and deprecation

After the full library has migrated:

- stop writing `folder_name` for new records
- deprecate config `folder_pattern`
- remove path-based acquisition heuristics
- remove `track_path` identity logic from likes/radio/playlists/history
- convert scanners/repair tools to V2 assumptions

Eventually:

- `folder_name` becomes legacy compatibility only or is dropped
- path-based fallbacks are removed

## Impact on backend modules

### Must change

- [library_sync.py](/Users/diego/Code/Ninja/musicdock/app/crate/library_sync.py)
- [content.py](/Users/diego/Code/Ninja/musicdock/app/crate/content.py)
- [db/library.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/library.py)
- [db/playlists.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/playlists.py)
- [db/user_library.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/user_library.py)
- [api/radio.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/radio.py)
- [bliss.py](/Users/diego/Code/Ninja/musicdock/app/crate/bliss.py)
- [worker_handlers/acquisition.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/acquisition.py)
- [worker_handlers/management.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/management.py)
- [worker_handlers/enrichment.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/enrichment.py)
- [worker_handlers/analysis.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/analysis.py)
- [worker_handlers/artwork.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/artwork.py)
- health/repair/scanner modules under [app/crate/](/Users/diego/Code/Ninja/musicdock/app/crate)

### Needs special care

- anything doing `lib / folder_name`
- anything doing `LIKE '%/' || track_path`
- anything treating raw path as public identity

## Impact on `listen`

Routes and user-facing page structure should not need to change, but the data contracts do.

### Required `listen` changes

#### 1. Track identity in client models

`listen` track models should consistently carry:

- `trackId` or `libraryTrackId`
- `storageId`

And should stop depending on:

- `path` as public identity

#### 2. Player and stream URLs

In [player-utils.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/player-utils.ts):

- stop falling back to `track.path` for stream URL construction
- prefer `track.storageId` or `track.libraryTrackId`

#### 3. Queue persistence

Queue state saved in local storage should use:

- `trackId`
- `storageId`

not raw library paths.

#### 4. Likes and play events

In contexts and actions:

- send `track_id`
- do not send `track_path` except temporary fallback during rollout

#### 5. Radio

Radio sessions should store:

- `track_id`
- optionally `storage_id`

not `seedPath`.

### Expected outcome for `listen`

The app should look the same to the user, but become more robust:

- fewer broken track references after moves
- cleaner queue persistence
- no dependency on raw filesystem layout

## Impact on `admin`

`admin` should also not require major UX changes, but it needs:

- acquisition/repair tooling updated to V2 storage assumptions
- any manual file/path diagnostics to understand `storage_id`
- any table or debug view that shows paths to make the new layout understandable

## Performance and operational notes

### Benefits

- simpler acquisition path resolution
- fewer path edge cases
- fewer repair heuristics
- fewer sync mismatches caused by names
- more deterministic worker behavior

### Costs

- larger migration effort
- mixed-layout compatibility during rollout
- scanners become more DB-aware

## Recommended execution order

### Step 1

Schema: add `storage_id` to artist/album/track.

### Step 2

Add central storage layout helpers.

### Step 3

Backfill and switch playlists/history/likes/radio to `track_id`-first behavior.

### Step 4

Update `listen` contracts so playback and actions stop depending on raw `path`.

### Step 5

Change Tidal/Soulseek/import pipeline to write directly into V2 layout for new content.

### Step 6

Add dual-read sync/scanner support.

### Step 7

Run production migration artist-by-artist with verification.

### Step 8

Remove legacy assumptions and deprecate `folder_pattern`.

## Release gating checklist

Before public release, all of this should be true:

- no new acquisitions create name-derived artist/album directories
- likes do not depend on `track_path`
- playlists resolve by `track_id`
- radio works from `track_id`
- `listen` playback never requires raw library paths
- V2 layout works for new downloads
- production migration tooling exists and is resumable
- hidden-folder and weird-name cases are covered by regression tests

## Recommendation

We should do this now, and we should do it as a single explicit storage project, not as scattered bugfixes.

The bugs we are seeing in production are not isolated edge cases. They are symptoms of the current model coupling filesystem naming to identity.

The shortest path to a genuinely robust public release is:

- `storage_id` everywhere
- `track_id` for DB relations
- managed V2 filesystem layout
- no more path-as-identity in clients or user data
