# Admin Smart Playlists Overhaul

## Summary
System playlists need to move from a lightweight admin listing to a full editorial tool. Right now there are four structural problems:

- smart system playlists cannot be meaningfully edited after creation, even though the backend already accepts updated `smart_rules`
- newly created smart playlists are not generated immediately, so they start life empty
- playlist covers are supported in the backend, but admin has no real cover-management UX
- `listen` pays an expensive cold path for curated playlists because the curation endpoints have no backend caching and the current serialization shape still does per-playlist follow/count/artwork work

The recommended direction is to split the work into two complementary tracks:

1. turn `admin` playlists into a powerful editorial surface for both smart and static playlists
2. rebuild the public curation read path so `listen` loads curated playlists quickly and predictably

## Current state
### Admin
- `app/ui/src/pages/Playlists.tsx` can create static and smart system playlists
- the smart rule builder only exists in the create flow
- the editor for an existing playlist only exposes basic metadata
- there is no preview flow for smart rules
- there is no admin UX to set, replace or remove playlist covers
- static system playlists do not have real manual track curation yet

### Backend
- `app/crate/api/system_playlists.py` already accepts `smart_rules` and `cover_data_url` on update
- `app/crate/api/playlist_utils.py` already supports manual cover persistence and deletion
- `app/crate/db/playlists.py` already stores system playlists in the shared `playlists` table
- smart generation currently runs inline in the request path through `execute_smart_rules()` + `replace_playlist_tracks()`
- there is no generation metadata on playlists such as last run, current status, or last error
- there is no dedicated scheduler task for smart system playlist refresh

### Listen / curation
- `/api/curation/playlists` and `/api/curation/playlists/category/{category}` list system playlists directly from `list_system_playlists()`
- `/api/curation/playlists/{id}` loads full tracks for one playlist
- unlike `home`, curation endpoints currently have no backend cache
- the curation serialization path still does avoidable per-playlist work for followers and follow-state
- admin system-playlist mutations do not currently invalidate the `curation` frontend/backend cache scope

## Product decisions
### Admin editing surface
- Keep `/playlists` as the inventory view for filtering, status, counts, and quick actions.
- Add a dedicated editor route at `/playlists/:playlistId` for deep playlist editing.
- Do not try to make the current inline expand surface carry all advanced editing flows.

### Smart playlist lifecycle
- Newly created smart playlists must enqueue initial generation immediately.
- Editing smart rules must regenerate the playlist automatically after save.
- Editing only editorial metadata or cover must not regenerate.
- Every smart system playlist gets its own `auto_refresh_enabled` toggle.
- Daily regeneration is controlled by one global scheduled task, but eligibility is decided per playlist.

### Cover behavior
- Manual cover always wins over auto-collage artwork.
- Removing a manual cover returns the playlist to collage/fallback rendering.

### Cover persistence (filesystem write decision)
> **Decision:** Worker task. API never writes to `/music` directly.
>
> Flow:
> 1. `PUT /api/admin/system-playlists/{id}` receives cover as base64 in the request body
> 2. API writes to `/tmp/cover-staging/{playlist_id}.jpg` (ephemeral, not /music)
> 3. API enqueues task `persist_playlist_cover` with `{playlist_id, staging_path}`
> 4. Worker reads from staging, writes to `/music/.covers/playlists/{id}.jpg`, cleans staging
> 5. Worker updates `playlists.cover_path` in DB
> 6. API response returns `cover_status: "processing"` until worker completes
>
> This aligns with the project rule: "API mounts /music as read-only. All filesystem writes go through worker tasks."

---

## Implementation plan

### 1. Smart rule schema (typed contract — backwards compatible)

> **Decision:** Keep the existing persistence shape (`match`, `rules[]`, `limit`, `sort`) and type it. No `rule_groups` nesting — the current flat structure covers all real use cases. Existing playlists require zero data migration. New fields (`deduplicate_artist`, `max_per_artist`) have defaults and are additive.

Type the existing shape with Pydantic validation:

```python
class SmartRuleOperator(str, Enum):
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    CONTAINS = "contains"
    NOT_CONTAINS = "not_contains"
    GT = "gt"
    LT = "lt"
    GTE = "gte"
    LTE = "lte"
    BETWEEN = "between"
    IN = "in"
    NOT_IN = "not_in"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"

class SmartRuleField(str, Enum):
    GENRE = "genre"
    ARTIST = "artist"
    ALBUM = "album"
    TITLE = "title"
    YEAR = "year"
    FORMAT = "format"
    BPM = "bpm"
    ENERGY = "energy"
    DANCEABILITY = "danceability"
    VALENCE = "valence"
    ACOUSTICNESS = "acousticness"
    INSTRUMENTALNESS = "instrumentalness"
    LOUDNESS = "loudness"
    DYNAMIC_RANGE = "dynamic_range"
    RATING = "rating"
    BIT_DEPTH = "bit_depth"
    SAMPLE_RATE = "sample_rate"
    DURATION = "duration"
    POPULARITY = "popularity"

class SmartRule(BaseModel):
    field: SmartRuleField
    operator: SmartRuleOperator
    value: str | float | list[str] | list[float] | None = None

class SmartSortStrategy(str, Enum):
    RANDOM = "random"
    RECENT = "recent"
    POPULAR = "popular"
    ALPHABETICAL = "alphabetical"
    BPM = "bpm"
    ENERGY = "energy"
    RATING = "rating"

class SmartPlaylistConfig(BaseModel):
    """Matches the existing persisted shape — no migration needed."""
    match: Literal["all", "any"] = "all"
    rules: list[SmartRule]
    limit: int = Field(50, ge=1, le=500)
    sort: SmartSortStrategy = SmartSortStrategy.RANDOM
    deduplicate_artist: bool = True      # new, defaults safe
    max_per_artist: int = Field(3, ge=1, le=20)  # new, defaults safe
```

Frontend mirror: `app/ui/src/lib/smart-rules.ts` with matching TypeScript types.

The rule builder UI component renders a list of `SmartRule` rows with add/remove buttons. The top-level `match` toggle ("All" / "Any") controls how rules combine. Each row has field dropdown → operator dropdown → value input, with operator options filtered by field type.

Field-to-operator compatibility:
- Text fields (genre, artist, album, title, format): equals, not_equals, contains, not_contains, in, not_in
- Numeric fields (bpm, energy, year, etc.): equals, gt, lt, gte, lte, between
- Nullable fields: is_null, is_not_null (for checking "has rating" vs "unrated")

### 2. Data model and API contract
- Extend `playlists` with:
  - `last_generated_at TIMESTAMPTZ NULL`
  - `generation_status TEXT NOT NULL DEFAULT 'idle'` — idle | queued | running | failed
  - `generation_error TEXT NULL`
  - `auto_refresh_enabled BOOLEAN NOT NULL DEFAULT TRUE`
- Extend system playlist responses to expose those fields in both summary and detail payloads.
- Add admin endpoints for:
  - `POST /api/admin/system-playlists/{id}/preview` — dry-run with stats (see section 3)
  - `POST /api/admin/system-playlists/{id}/generate` — enqueue regeneration task
  - `POST /api/admin/system-playlists/{id}/tracks` — add tracks (static playlists)
  - `DELETE /api/admin/system-playlists/{id}/tracks/{entry_id}` — remove track
  - `POST /api/admin/system-playlists/{id}/reorder` — reorder tracks
  - `POST /api/admin/system-playlists/{id}/duplicate` — duplicate playlist
- Keep `PUT /api/admin/system-playlists/{id}` as the main update endpoint for metadata, cover and rules.

### 3. Preview with distribution stats

The preview endpoint executes smart rules as a dry-run without persisting tracks, returning rich stats so the editor can show the impact of rule changes before saving:

```python
class SmartPlaylistPreview(BaseModel):
    total_matching: int              # tracks matching rules (before limit)
    tracks: list[TrackSummary]       # first N tracks of the result
    genre_distribution: dict[str, int]    # {"rock": 12, "metal": 8, ...}
    artist_distribution: dict[str, int]   # {"Birds In Row": 4, ...}
    format_distribution: dict[str, int]   # {"flac": 30, "mp3": 5}
    duration_total_sec: int          # total duration of matched tracks
    avg_year: int | None             # average year of matched tracks
    year_range: tuple[int, int] | None  # min/max year
```

The editor shows this as:
- A summary line: "142 tracks match · 5h 23m · 2018–2024"
- Genre/artist distribution as horizontal bar charts or pill clouds
- A scrollable track preview table (first 20 tracks)

### 4. Generation history

Track the outcome of each smart playlist generation so editors can see trends and debug failures:

```sql
CREATE TABLE playlist_generation_log (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
    rule_snapshot_json JSONB,                -- smart_rules at time of generation
    track_count INTEGER,
    duration_sec INTEGER,
    error TEXT,
    triggered_by TEXT DEFAULT 'manual'       -- manual | scheduler | rule_change | creation
);
CREATE INDEX idx_playlist_gen_log ON playlist_generation_log(playlist_id, started_at DESC);
```

The editor shows "Last 5 generations" with:
- Timestamp + trigger reason
- Track count delta ("+3 tracks" or "−5 tracks" vs previous)
- Duration
- Error message if failed
- Expandable rule diff (compare current rules vs snapshot)

Retention: keep last 20 entries per playlist, auto-prune older ones.

### 5. Admin playlists UX

#### Inventory view (`/playlists`)
- Table/grid with columns:
  - Name + artwork thumbnail
  - Type badge: `smart` / `static` / `curated`
  - Active/inactive toggle
  - Category
  - Track count
  - Follower count
  - Last generated (relative time)
  - Generation status badge (idle/running/failed)
- Quick actions per row:
  - Generate now
  - Duplicate
  - Toggle active
  - Delete
- Bulk actions:
  - Activate/deactivate selected
  - Regenerate all smart in category
  - Change category for selected

#### Editor page (`/playlists/:id`)
Three tabs:

**Editorial tab:**
- Name, description (rich text or plain)
- Category (dropdown)
- Featured rank (number input)
- Active toggle
- Curated toggle
- Auto-refresh toggle (smart only)

**Cover tab:**
- Current cover preview (manual or collage)
- Upload/replace button (crop to square)
- Remove button (returns to collage)
- Collage preview of what auto-generated would look like

**Content tab (smart):**
- Rule builder (groups of rules, add/remove, field/operator/value)
- Sort strategy dropdown
- Limit input
- Deduplicate artist toggle + max per artist
- "Preview" button → shows SmartPlaylistPreview inline
- "Save & Generate" button → saves rules + enqueues generation

**Content tab (static):**
- Track search input (searches library)
- Track list with drag & drop reorder (@dnd-kit/core)
- Remove button per track
- Add from search results (with duplicate detection)

**Sidebar (always visible):**
- Generation status badge
- Last generated timestamp
- Track count + total duration
- Follower count
- Generation history (collapsible, last 5)

### 6. Smart playlist generation model
- Stop doing smart generation only as an inline admin action.
- Introduce a worker task `generate_system_playlist` for one system playlist generation:
  - load playlist + rules
  - set `generation_status = running`
  - log to `playlist_generation_log` (started)
  - execute rules via `execute_smart_rules()`
  - replace playlist tracks atomically
  - update track count, duration, `last_generated_at`
  - clear `generation_error`
  - set `generation_status = idle`
  - log completion
  - send Telegram notification
- On failure:
  - keep existing tracks
  - set `generation_status = failed`
  - persist `generation_error`
  - log failure
  - send Telegram failure notification
- Creating a smart system playlist must:
  - create the playlist row
  - optionally persist the cover
  - enqueue the initial generation task
  - return the playlist with `generation_status = queued`

### 7. Playlist duplication
- `POST /api/admin/system-playlists/{id}/duplicate`
- Copies: name (+ " (Copy)"), description, category, smart_rules, generation_mode, is_curated, auto_refresh_enabled
- Does NOT copy: tracks (for smart — they'll be generated), followers, cover (starts fresh)
- For static playlists: copies tracks too (duplicates the playlist_tracks rows)
- Returns the new playlist; admin navigates to its editor

### 8. Static/editorial playlist curation
- Add track search and add/remove/reorder flows to the dedicated admin editor for static playlists.
- Use `playlist_tracks.id` as the editing identity for removals and ordering, not `position`.
- Preserve `position` only as the stored playback order.
- Drag & drop reorder via `@dnd-kit/core` (already used in listen queue panel).
- Support large playlists without rendering all rows at once (virtualized list above 200 tracks).

### 9. Listen performance and cache strategy
- Rewrite `list_system_playlists()` so the base query already returns:
  - follower count (subquery or LEFT JOIN aggregate)
  - follow state for the current user (correlated EXISTS subquery)
- Remove serializer-level N+1 calls for:
  - `get_playlist_followers_count()`
  - `is_playlist_followed()`
- Replace per-playlist artwork fetching with one batch query for all requested playlist IDs.
- Add backend cache for:
  - `/api/curation/playlists` — TTL 300s
  - `/api/curation/playlists/category/{category}` — TTL 300s
  - `/api/curation/playlists/{id}` — TTL 300s
- Track pagination is **opt-in, not default** (backwards compatible):
  - `GET /api/curation/playlists/{id}` → returns ALL tracks (listen depends on this for queue/shuffle/offline)
  - `GET /api/curation/playlists/{id}?limit=50&offset=0` → paginated (admin editor can use this for large playlists)
  - Response always includes `total_tracks` count regardless of pagination
- Extend cache invalidation so admin playlist mutations invalidate:
  - `curation` scope (clears list cache)
  - `playlist:{id}` scope (clears detail cache)
- Ensure backend cache prefix clearing includes `curation:` keys.

### 10. Scheduled regeneration
- Add worker task `refresh_system_smart_playlists`.
- Register it in the scheduler defaults at a 24-hour interval.
- The daily refresh job should only consider playlists where:
  - `scope = 'system'`
  - `generation_mode = 'smart'`
  - `is_active = TRUE`
  - `auto_refresh_enabled = TRUE`
  - `last_generated_at` is null or older than 24 hours
- The refresh job should enqueue individual `generate_system_playlist` tasks rather than doing the whole refresh in one long-running transaction.
- Each generation task logs to `playlist_generation_log` with `triggered_by = 'scheduler'`.
- Expose this schedule in admin `Settings > Schedules` with a clear label such as `Refresh Smart Playlists`.

### 11. Telegram notifications for generation
Connect smart playlist generation to the existing Telegram notification infrastructure:

**On generation complete:**
```
🎶 Smart Playlist "Dark & Heavy" regenerated
50 tracks · 3h 12m · 15 genres
Triggered by: scheduler
```

**On generation failure:**
```
❌ Smart Playlist "Dark & Heavy" generation failed
Error: No tracks match the current rules
```

**New command: `/playlists`**
```
🎵 System Playlists (12 active)

Smart (8):
  • Dark & Heavy — 50 tracks · ✅ 2h ago
  • Shoegaze Essentials — 40 tracks · ✅ 1d ago
  • Fresh Finds — 30 tracks · ❌ failed

Static (4):
  • Staff Picks — 25 tracks
  • Weekend Chill — 18 tracks
```

---

## Important interface changes
- `playlists` table gains generation metadata, `auto_refresh_enabled`, and generation history table
- `smart_rules` becomes a typed schema (`SmartPlaylistConfig`) with validated fields and operators
- system playlist API responses expose generation metadata
- admin system playlist editing adds preview, track-curation, duplicate, and bulk action endpoints
- static system playlist editing uses playlist entry IDs rather than positional deletion
- curation read path becomes paginated and cached
- preview endpoint returns distribution stats alongside track list

## Validation and test plan
### API and data
- create smart playlist enqueues initial generation
- update smart rules regenerates
- update metadata only does not regenerate
- preview returns deterministic shape and does not persist tracks
- preview distribution stats are accurate (genre/artist/format counts match)
- failed generation preserves previous track set and captures error state
- generation log captures rule snapshot and can be diffed
- cover upload, replace and remove behave correctly
- duplicate copies rules/tracks but not followers/cover

### Admin UX
- create smart playlist → redirected editor shows queued/running state
- edit smart rules → preview → save → regeneration status updates
- static playlist supports add/remove/reorder correctly (drag & drop)
- manual cover overrides collage and can be removed
- generation history shows last 5 runs with track count delta
- bulk activate/deactivate works from inventory view
- duplicate creates a copy and navigates to the new editor

### Listen performance
- curated playlist list endpoint no longer does per-item follower/follow lookups
- category view uses the same optimized read path
- detail view is cached and invalidated correctly
- detail view tracks are paginated (offset/limit)
- admin mutations invalidate curated playlist list/detail cache

### Scheduler
- daily refresh only targets eligible smart playlists
- inactive or auto-refresh-disabled playlists are skipped
- playlists already regenerated in the last 24h are skipped
- each generation logs to history with `triggered_by = 'scheduler'`
- Telegram notification sent on completion/failure

## Assumptions and defaults
- The target editor model is a dedicated playlist route, not an inline expander.
- Smart playlists are system/editorial objects only in this scope; personal smart playlists are not being redesigned here.
- Creating a smart system playlist should immediately queue generation.
- `auto_refresh_enabled` defaults to `true` for new smart system playlists.
- Metadata-only saves do not regenerate.
- Cover persistence uses worker task (API → staging → worker → /music). See "Cover persistence" decision above.
- Smart rule schema keeps the current flat shape (`match` + `rules[]`). No `rule_groups` nesting. Zero data migration needed.
- Curation detail endpoint returns all tracks by default (backwards compatible). Pagination is opt-in via query params.
- Generation history retains last 20 entries per playlist.
- Track pagination in admin editor defaults to 50 per page.
