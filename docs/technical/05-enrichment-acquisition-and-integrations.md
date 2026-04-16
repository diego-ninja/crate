# Enrichment, Acquisition, and External Integrations

## Why this layer exists

Crate is not a passive index of tags. A large part of its value comes from enriching local files with external knowledge and from importing new content into the library.

This layer spans:

- artist enrichment
- album and artwork enrichment
- acquisition from paid and P2P sources
- show aggregation
- library completeness checks

## Artist enrichment

The main unified entrypoint is [app/crate/enrichment.py](/Users/diego/Code/Ninja/musicdock/app/crate/enrichment.py).

For a given artist, `enrich_artist(...)` pulls from multiple providers and persists into DB.

### Sources consulted

- Last.fm
- Spotify
- MusicBrainz
- Setlist.fm
- Fanart.tv
- Discogs
- Deezer and iTunes as image fallbacks in adjacent code paths

### Data persisted

Typical artist enrichment writes include:

- biography
- tags
- similar artists
- listeners and playcount
- MBID and MusicBrainz URLs
- country, area, type, dates
- members
- Discogs profile and identifiers
- Spotify popularity and followers

The function also updates genre links and may download a local artist photo if missing.

### Freshness strategy

Enrichment is not run blindly every time. It is guarded by:

- `enriched_at`
- a configurable minimum age in settings
- force-refresh logic that invalidates caches

This reduces provider churn and rate-limit pressure.

## Artwork sourcing

Artwork is handled across API helpers, worker handlers, and image-specific modules.

Typical sources include:

- Cover Art Archive
- embedded file tags
- Deezer
- iTunes
- Last.fm
- Fanart.tv
- MusicBrainz-linked assets
- manual upload/crop by the user

Crate treats artwork as part of the product surface, not just metadata decoration.

## Acquisition sources

Crate currently integrates strongly with two acquisition channels:

### Tidal

Key pieces:

- API surface in [app/crate/api/tidal.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/tidal.py)
- transport and download logic in [app/crate/tidal.py](/Users/diego/Code/Ninja/musicdock/app/crate/tidal.py)
- worker orchestration in [app/crate/worker_handlers/acquisition.py](/Users/diego/Code/Ninja/musicdock/app/crate/worker_handlers/acquisition.py)

Tidal downloads are mediated through `tiddl`, and Crate wraps the result with:

- progress reporting
- partial failure reporting
- intermediate file cleanup
- library move and sync
- post-download enrichment pipeline

### Soulseek

Key pieces:

- API surface in [app/crate/api/acquisition.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/acquisition.py)
- integration logic in [app/crate/soulseek.py](/Users/diego/Code/Ninja/musicdock/app/crate/soulseek.py)
- worker orchestration in acquisition handlers

Crate uses `slskd` as the network client and adds:

- search heuristics
- quality filtering
- alternate peer retry
- import normalization

## Unified acquisition philosophy

Even though Tidal and Soulseek are very different sources, Crate tries to converge them into one internal pattern:

- enqueue acquisition task
- download to staging
- normalize files
- resolve target artist/album destination
- move into library
- sync to DB
- queue enrichment and analysis

This makes the downstream pipeline source-agnostic.

## Post-acquisition processing

The acquisition worker does more than download bytes.

It also:

- emits user-facing task events
- updates acquisition status tables
- suppresses watcher loops during library writes
- aligns staged artist names with existing library folder conventions
- triggers scans and downstream processing
- seeds user library state in some upload/import flows

That is why acquisition belongs in the worker layer rather than in the API.

## Shows and live data

Crate also treats external event data as part of enrichment/discovery.

Key integrations:

- Ticketmaster
- Last.fm event scraping
- Setlist.fm probable setlists

This data powers:

- upcoming shows in admin and listen
- artist show sections
- setlist-derived intelligence

## Discovery and completeness integrations

External integrations also feed quality/discovery surfaces such as:

- completeness against MusicBrainz discography
- new releases checks
- artist similarity backfills
- popularity overlays

This means enrichment is not just "decorate artist page". It directly drives discovery workflows.

## Rate limiting and resilience

Crate's enrichment/acquisition code makes several pragmatic trade-offs:

- source calls are wrapped defensively
- caches are used aggressively
- failures in one source do not normally abort the whole enrichment flow
- long-running acquisition is task-based, not request-based
- partial Tidal failures can still produce usable files

This is the right posture for a self-hosted app operating against unstable third-party APIs.

## Design decisions in this layer

### Why unify enrichment in one service function

A single enrichment orchestrator gives Crate:

- one place to enforce freshness policy
- one place to merge source outputs
- one place to persist consistent artist state

Without this, the risk would be duplicated source logic and inconsistent writes across routes and tasks.

### Why keep source modules separate

Although the orchestration is unified, source implementations remain separate modules because:

- each provider has different auth and data shape
- rate-limit behavior differs
- fallback order matters
- source-specific failures should stay isolated

### Why acquisition is opinionated

Crate does not just "download what the source gives".

It normalizes aggressively because the end goal is a clean canonical library, not merely a successful transfer.

## Related documents

- [Library, Storage, Sync, and Imports](/Users/diego/Code/Ninja/musicdock/docs/technical/04-library-storage-sync-and-imports.md)
- [Audio Analysis, Similarity, and Discovery Intelligence](/Users/diego/Code/Ninja/musicdock/docs/technical/06-audio-analysis-similarity-and-discovery.md)
- [Frontend Architecture: Admin and Listen](/Users/diego/Code/Ninja/musicdock/docs/technical/08-frontends-admin-and-listen.md)
