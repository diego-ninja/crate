# Enrichment Notes

Crate enriches artist and album metadata from multiple external sources and
normalizes imported media so the library stays consistent regardless of where
the bytes came from.

## Pipeline shape

When new content arrives from a filesystem scan, Tidal, Soulseek, or manual
upload/import, the downstream flow is roughly:

1. normalize staging tree and target destination
2. sync files into the library model
3. enrich artist/album metadata
4. index genres and MusicBrainz identifiers
5. run audio analysis and Bliss similarity
6. refresh read models, home/admin surfaces, and follow-up tasks

## Artist enrichment

The unified entrypoint is `enrich_artist(...)` in `app/crate/enrichment.py`.
It merges multiple providers rather than scattering provider writes across the
codebase.

Typical sources:

- Last.fm
- MusicBrainz
- Setlist.fm
- Fanart.tv
- Discogs
- Deezer / iTunes fallbacks
- Spotify popularity/follower overlays when configured

## Acquisition normalization

Crate treats acquisition as “import into a canonical library”, not merely
“download succeeded”.

### Tidal

The repo currently pins `tiddl 3.3.0`.

Crate wraps it with:

- progress reporting and task events
- partial failure detection
- staging-tree inspection
- artifact cleanup and repair
- move/import into the library
- downstream sync, enrichment, and analysis

The important current behavior is **best-quality-real-output**:

- if the staging tree contains recoverable lossless audio, Crate preserves it
- if `tiddl` leaves MP4/AAC wrappers, false `.flac` files, or `tmp*` artifacts,
  Crate inspects and normalizes them
- if the “lossless” path is incomplete or not genuinely lossless, Crate falls
  back cleanly to a playable `.m4a` result instead of importing broken FLACs

### Soulseek

Crate uses `slskd` for transport and adds:

- search heuristics
- quality filtering
- retry/alternate-peer logic
- canonical import normalization once files land

## Persistence and freshness

Enrichment data is persisted into PostgreSQL. Caches accelerate fetches, but the
DB is the durable truth. Freshness is governed by timestamps and settings rather
than blindly re-querying providers on every request.
