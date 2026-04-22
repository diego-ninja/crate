# Database Index Audit

Date: 2026-04-22
Branch: `refactor/database_indexes`

## Summary

The database is not missing indexes everywhere. It already contains a fair number of B-tree, GIN, and partial indexes. The deeper issue is alignment: many of the hottest query shapes in the codebase are not served well by the indexes that exist today.

The dominant mismatch patterns are:

- case-insensitive lookups and joins using `LOWER(...)`
- text-name joins between tables that should ideally join by ids
- filters plus sort orders that want composite indexes rather than single-column indexes
- a handful of exact duplicate indexes that add write cost without adding read value

In short: the problem is less "there are no indexes" and more "the indexes that exist do not match the actual access patterns."

## Methodology

This audit combined four sources:

1. Code audit of `app/crate/db/`, `app/crate/api/`, and hot query modules.
2. Live index inventory from the local Postgres dev database.
3. `pg_stat_user_tables` and `pg_stat_user_indexes`.
4. Constraint audit for foreign keys lacking a usable left-prefix index.

Important caveat:

- The local dev database is small, so the planner often prefers sequential scans even when an index exists.
- That means `idx_scan = 0` is not, by itself, proof that an index is useless.
- Even so, the mismatch between current query shapes and current index definitions is obvious from the code.

## Key Findings

### 1. Exact duplicate indexes exist today

These are high-confidence cleanup candidates:

- `library_albums`
  - `library_albums_artist_name_key` on `(artist, name)`
  - `idx_albums_artist_name` on `(artist, name)`
  - Same key, same predicate. The non-unique copy is redundant.
- `library_tracks`
  - `idx_lib_tracks_album` on `(album_id)`
  - `idx_tracks_album_id` on `(album_id)`
  - Exact duplicate.
- `users`
  - `users_email_key` and `idx_users_email`
  - `users_google_id_key` and `idx_users_google_id`
  - The non-unique copies are redundant.
- `playlist_members`
  - `playlist_members_pkey` and `idx_playlist_members_composite` both cover `(playlist_id, user_id)`
  - The extra composite index is redundant.

### 2. The biggest systemic gap is missing expression indexes for `LOWER(...)`

Representative patterns in the code:

- `library_artists WHERE LOWER(name) = LOWER(:artist_name)`
  - `app/crate/db/jobs/popularity.py`
  - `app/crate/db/library.py`
  - `app/crate/db/jobs/repair.py`
  - `app/crate/db/queries/bliss.py`
- `library_albums WHERE LOWER(artist) = LOWER(:artist)`
  - `app/crate/db/library.py`
  - `app/crate/db/queries/browse.py`
  - `app/crate/db/releases.py`
  - `app/crate/db/jobs/popularity.py`
- joins like `LOWER(a.artist) = LOWER(ar.name)`
  - `app/crate/db/jobs/popularity.py`
  - `app/crate/db/queries/bliss.py`
  - `app/crate/db/radio.py`
  - `app/crate/db/queries/health.py`
- `shows`
  - `LOWER(artist_name) = LOWER(:artist)`
  - `LOWER(city) = LOWER(:city)`
  - `LOWER(country_code) = LOWER(:country)`
  - `DISTINCT ON (LOWER(city))`

Current plain B-tree indexes on raw text columns do not support those expression predicates efficiently.

### 3. `sessions` is poorly indexed for presence queries

This table stands out in local stats:

- `seq_scan = 1175`
- `seq_tup_read = 190042`
- `idx_scan = 0`

Relevant query patterns from `app/crate/db/auth.py`:

- active session aggregation by user with:
  - `revoked_at IS NULL`
  - `expires_at IS NULL OR expires_at > NOW()`
  - `COALESCE(last_seen_at, created_at) >= NOW() - INTERVAL '10 minutes'`
  - `GROUP BY user_id`
- list sessions for a user:
  - `WHERE user_id = :user_id`
  - optional `revoked_at IS NULL`
  - `ORDER BY COALESCE(last_seen_at, created_at) DESC`
- revoke all sessions for a user:
  - `WHERE user_id = :user_id AND revoked_at IS NULL`

Current indexes:

- `idx_sessions_user_id`
- `idx_sessions_last_seen`

These do not line up well with the actual filters and sort key.

### 4. `play_history` needs at least one time-first index

Current indexes:

- `idx_play_history_user (user_id, played_at DESC)`
- `idx_play_history_track (track_id)`

Observed query patterns:

- per-user history ordered by latest play
- global recent activity windows:
  - `WHERE played_at > now() - interval ...`
  - `COUNT(DISTINCT user_id)`
  - `COUNT(*)`
  - `app/crate/db/management.py`
  - `app/crate/db/queries/telegram.py`
- `DISTINCT ON (ph.user_id) ORDER BY ph.user_id, ph.played_at DESC`
  - `app/crate/db/auth.py`

The current user-first index is useful for personal history, but not for global recent-window scans.

### 5. `artist_genres` and `album_genres` are under-indexed for read patterns

Current indexes:

- `artist_genres_pkey (artist_name, genre_id)`
- `idx_artist_genres_artist (artist_name)`
- `idx_artist_genres_genre (genre_id)`
- `album_genres_pkey (album_id, genre_id)`
- `idx_album_genres_genre (genre_id)`

Observed query patterns:

- by artist, ordered by `weight DESC`
  - `app/crate/db/queries/browse_artist.py`
  - `app/crate/db/queries/analytics.py`
- by album, ordered by `weight DESC`
  - `app/crate/db/queries/browse.py`
  - `app/crate/db/queries/browse_media.py`
- by genre, then joined back into artists/albums with weight-sensitive ordering
  - `app/crate/db/genres.py`

Missing today:

- `artist_genres (artist_name, weight DESC)`
- `album_genres (album_id, weight DESC)`

### 6. `new_releases` and `shows` rely on case-insensitive matching without matching indexes

`new_releases` patterns from `app/crate/db/releases.py`:

- `LOWER(la.name) = LOWER(nr.artist_name)`
- `LOWER(alb.artist) = LOWER(nr.artist_name)`
- `LOWER(alb.name) = LOWER(nr.album_title)`
- browse ordering by `status`, `release_date`, `detected_at`

`shows` patterns from `app/crate/db/shows.py`:

- dedup:
  - `WHERE date = :date AND LOWER(artist_name) = LOWER(:artist)`
- browse:
  - `WHERE date >= :today AND status != 'cancelled'`
  - optional `artist_name = :artist_name`
  - optional `LOWER(city) = LOWER(:city)`
  - optional `LOWER(country_code) = LOWER(:country)`
  - `ORDER BY date ASC`
- city list:
  - `DISTINCT ON (LOWER(city)) ORDER BY LOWER(city), id`

Current indexes there are too raw for those shapes.

### 7. The new radio stack has both index gaps and a deeper vector-search limitation

The radio and recommendation stack now spans:

- `app/crate/db/radio.py`
- `app/crate/db/queries/bliss.py`
- `app/crate/db/paths.py`
- `app/crate/radio_engine.py`

There are two distinct performance layers here.

#### 7.1 Seed/profile queries need classic support indexes

Examples:

- recent liked vectors:
  - `user_liked_tracks -> library_tracks`
  - `ORDER BY created_at DESC LIMIT ...`
- saved album vectors:
  - `user_saved_albums -> library_tracks`
- followed artist vectors:
  - `user_follows -> library_albums -> library_tracks`
  - case-insensitive join on artist name
- feedback history:
  - `radio_feedback WHERE user_id = :user_id AND created_at > ... ORDER BY created_at DESC`

These can benefit from normal indexing.

#### 7.2 Nearest-neighbour search over `bliss_vector` is not meaningfully index-backed today

Representative queries:

- `app/crate/db/queries/bliss.py`
  - `get_bliss_candidates()`
  - `get_multi_seed_bliss_candidates()`
- `app/crate/db/paths.py`
  - `_find_step_track()`
  - `_find_best_candidate()`

These do things like:

```sql
WHERE t.bliss_vector IS NOT NULL
ORDER BY t.bliss_vector <-> ARRAY[...]::float8[]
LIMIT N
```

On the local database, `EXPLAIN (ANALYZE)` shows the expected plan:

- sequential scan on `library_tracks`
- compute distance row by row
- top-N sort

That means:

- there is no usable nearest-neighbour index path today
- adding another plain B-tree index will not solve the core cost of these queries

#### 7.3 Important architectural mismatch: `vector` exists, but `bliss_vector` is still `float8[]`

The database has the `vector` extension installed.

But:

- `library_tracks.bliss_vector` is still `DOUBLE PRECISION[]`
- there is no `vector(20)` column
- there is no `ivfflat` or `hnsw` index

So the project already has the right extension available, but the radio/path queries are still operating on a storage type that cannot exploit pgvector ANN indexes.

#### 7.4 There is also a correctness issue in radio seed resolution

`app/crate/db/radio.py:get_recent_play_vectors()` reads from `play_events`.

In the current schema:

- `user_play_events` exists
- `play_events` does not exist

So part of the discovery radio seed path is not just under-indexed; it is pointing at a table that is not present in the live schema.

## High-Confidence Missing Indexes

These are the strongest candidates for a first migration.

### Expression indexes for case-insensitive artist/album matching

```sql
CREATE INDEX idx_lib_artists_lower_name
ON library_artists (LOWER(name));

CREATE INDEX idx_lib_albums_lower_artist
ON library_albums (LOWER(artist));

CREATE INDEX idx_lib_albums_lower_artist_lower_name
ON library_albums (LOWER(artist), LOWER(name));
```

### Weight-aware genre indexes

```sql
CREATE INDEX idx_artist_genres_artist_weight
ON artist_genres (artist_name, weight DESC);

CREATE INDEX idx_album_genres_album_weight
ON album_genres (album_id, weight DESC);
```

### `shows` case-insensitive browse indexes

```sql
CREATE INDEX idx_shows_date_lower_artist
ON shows (date, LOWER(artist_name));

CREATE INDEX idx_shows_date_lower_city
ON shows (date, LOWER(city));

CREATE INDEX idx_shows_date_lower_country
ON shows (date, LOWER(country_code));
```

### `play_history` recent-window index

```sql
CREATE INDEX idx_play_history_played_at_desc
ON play_history (played_at DESC);
```

### Radio seed/support indexes

```sql
CREATE INDEX idx_user_liked_tracks_user_created
ON user_liked_tracks (user_id, created_at DESC);

CREATE INDEX idx_user_saved_albums_user_created
ON user_saved_albums (user_id, created_at DESC);

CREATE INDEX idx_radio_feedback_user_created
ON radio_feedback (user_id, created_at DESC);
```

These do not solve vector search itself, but they reduce latency in radio session seeding and feedback replay.

## Strong Candidates, But Validate With `EXPLAIN`

### Sessions active-state index

Option A:

```sql
CREATE INDEX idx_sessions_user_active_seen
ON sessions (user_id, COALESCE(last_seen_at, created_at) DESC)
WHERE revoked_at IS NULL;
```

Option B:

```sql
CREATE INDEX idx_sessions_user_active_expiry_seen
ON sessions (user_id, expires_at, COALESCE(last_seen_at, created_at) DESC)
WHERE revoked_at IS NULL;
```

Notes:

- `NOW()` cannot be embedded in an index predicate.
- Even so, partial indexing on `revoked_at IS NULL` plus sort support should help materially.

### `artist_similarities` lower-expression indexes

```sql
CREATE INDEX idx_similarities_lower_artist
ON artist_similarities (LOWER(artist_name));

CREATE INDEX idx_similarities_lower_similar
ON artist_similarities (LOWER(similar_name));
```

### `new_releases` lifecycle index

```sql
CREATE INDEX idx_new_releases_status_release_detected
ON new_releases (status, release_date DESC, detected_at DESC);
```

And likely:

```sql
CREATE INDEX idx_new_releases_lower_artist_lower_album
ON new_releases (LOWER(artist_name), LOWER(album_title));
```

### `library_tracks` fallback resolution index

```sql
CREATE INDEX idx_lib_tracks_lower_artist_lower_title
ON library_tracks (LOWER(artist), LOWER(title));
```

This likely helps play-history fallback resolution and some discovery paths.

### Radio/bliss artist-side join support

```sql
CREATE INDEX idx_lib_albums_lower_artist_id
ON library_albums (LOWER(artist), id);
```

Why:

- several radio/bliss queries first constrain by artist identity through `library_albums`, then fan out into `library_tracks`
- especially relevant for:
  - followed-artist radio seeds
  - same-artist radio
  - similar-artist radio

## Foreign Key Coverage Gaps

Several foreign keys do not currently have a usable supporting index on the referencing side.

Most relevant application-facing gaps:

- `playlists.user_id`
- `playlists.managed_by_user_id`
- `scan_results.task_id`
- `favorites.user_id`
- `user_saved_albums.album_id`
- `user_liked_tracks.track_id`
- `user_show_reminders.show_id`
- `user_track_stats.track_id`

Some collaboration and jam tables also have gaps, but those are lower priority unless usage grows.

### Refined FK coverage pass (after implementing `010`)

A later catalog pass corrected an inspection bug: `pg_index.indkey` is zero-based, while
`pg_constraint.conkey` is one-based. Once normalized correctly, the residual FK gaps became much
smaller and more sensible.

After the indexes in `010_performance_indexes.py`, the remaining uncovered foreign keys are:

- `jam_room_events.user_id`
- `jam_room_invites.created_by`
- `playlist_invites.created_by`
- `playlist_members.invited_by`
- `user_affinity_cache.user_b_id`

These were intentionally **not** added in the first performance migration because the current code
does not show hot lookup paths that filter on those columns alone:

- `jam_room_events` is queried by `room_id`, which is already indexed.
- `jam_room_invites` is resolved by `token` and secondarily by `room_id`, not by `created_by`.
- `playlist_invites` is looked up by `token` and `playlist_id`, not by `created_by`.
- `playlist_members` is queried by `(playlist_id, user_id)` and by `user_id`, not by `invited_by`.
- `user_affinity_cache` is read and upserted by the normalized pair `(user_a_id, user_b_id)`, not by
  `user_b_id` alone.

In other words: these are schema-level FK gaps, but not compelling performance gaps today.

By contrast, the app-facing FK coverage that *did* matter is now covered by `010`, including:

- `favorites.user_id`
- `playlists.user_id`
- `playlists.managed_by_user_id`
- `scan_results.task_id`
- `user_saved_albums.album_id`
- `user_liked_tracks.track_id`
- `user_show_reminders.show_id`
- `user_track_stats.track_id`

## Recommended Cleanup

These should be removed in a cleanup migration once confirmed:

- `idx_albums_artist_name`
- one of `idx_lib_tracks_album` / `idx_tracks_album_id`
- `idx_users_email`
- `idx_users_google_id`
- `idx_playlist_members_composite`

Potential follow-up cleanup after validation:

- `idx_sessions_last_seen`

## Prioritized Implementation Plan

### Phase 1: high-confidence, low-risk

1. Add expression indexes:
   - `library_artists (LOWER(name))`
   - `library_albums (LOWER(artist))`
   - `library_albums (LOWER(artist), LOWER(name))`
2. Add weight-aware genre indexes:
   - `artist_genres (artist_name, weight DESC)`
   - `album_genres (album_id, weight DESC)`
3. Add `play_history (played_at DESC)`
4. Add `shows` case-insensitive browse indexes
5. Add radio seed/support indexes:
   - `user_liked_tracks (user_id, created_at DESC)`
   - `user_saved_albums (user_id, created_at DESC)`
   - `radio_feedback (user_id, created_at DESC)`
6. Remove exact duplicate indexes

### Phase 2: measured improvements

1. Add one new `sessions` partial/composite index
2. Add `artist_similarities` lower-expression indexes
3. Add `new_releases` lifecycle/match indexes
4. Add `library_tracks (LOWER(artist), LOWER(title))` if fallback resolution remains hot
5. Add `library_albums (LOWER(artist), id)` if radio/bliss artist-side filtering remains hot

### Phase 2.5: radio/bliss correctness fixes

Before deeper radio optimisation, fix the data path:

1. Replace `play_events` usage in radio seed resolution with the correct source, likely `user_play_events`.
2. Re-run `EXPLAIN` on the real radio seed queries after that fix.

### Phase 3: structural fix, not just indexing

Longer term, the biggest performance win will not come from adding more indexes. It will come from reducing text-name joins:

- `library_albums.artist` joining to `library_artists.name`
- `artist_genres.artist_name` joining to `library_artists.name`
- `shows.artist_name` joining to artist names
- `new_releases.artist_name` and `album_title` matching into library by `LOWER(...)`

As long as those joins remain text-based, the system will continue to need compensating expression indexes.

### Phase 4: real vector indexing for radio and music paths

If radio and pathfinding are strategic surfaces, the current storage model should evolve.

Recommended direction:

1. Add a new shadow column:

```sql
bliss_embedding vector(20)
```

2. Backfill it from the existing 20-dim `bliss_vector` arrays.
3. Move distance queries from `float8[]` arithmetic to pgvector operators.
4. Add an ANN index, likely:
   - `HNSW`
   - or `IVFFLAT`

At that point, the costly distance queries in `bliss.py` and `paths.py` can stop doing full-library scans for each nearest-neighbour request.

Without that change, the best we can do is prefilter candidates better before computing distance. Useful, yes. Transformative, no.

Important note:

- This should **not** require a full re-analysis of tracks.
- The local database already shows that all non-null `bliss_vector` values have the expected 20 dimensions.
- So the migration path should be:
  1. add `bliss_embedding vector(20)`
  2. backfill from existing `bliss_vector`
  3. switch queries
  4. let the existing bliss pipeline continue filling only the tracks that were already `NULL`

In other words: this is a schema/backfill migration, not a full recomputation project.

Because there are production bugs to fix first, this vector migration should be treated as a follow-up phase and implemented as a safe shadow rollout:

1. add the new column without removing `bliss_vector`
2. backfill in batches
3. deploy query changes behind a narrow surface
4. validate radio and paths in production
5. only then consider retiring the old column

## Recommendation

The right next step is not "add a ton of indexes."

The right next step is:

1. remove obvious duplicates
2. add a focused first migration for expression and composite indexes that match real hot queries
3. run representative `EXPLAIN (ANALYZE, BUFFERS)` against:
   - user presence/session queries
   - release browsing
   - shows browsing
   - artist/album lookup flows
   - playlist and home/discovery reads
   - radio seed queries
   - bliss/path nearest-neighbour queries
4. only then add the second wave

That will improve latency without turning the schema into an index graveyard.
