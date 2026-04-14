# Shows Consolidation: Last.fm + Ticketmaster

## What We're Building

A unified shows pipeline that combines Ticketmaster (primary) with Last.fm events (enrichment + fallback) into a single `shows` table. Shows are scoped per user's city, with auto-detection from IP and manual override. The system scrapes daily per unique city across all users and consolidates both sources with deduplication.

## Architecture Overview

```
User registers / opens Listen
  → IP geolocation (ip-api.com) → city, country, lat/lon
  → Stored in users table, editable in Listen preferences

Daily scheduler (per unique city):
  ├─ Ticketmaster sync (existing, now city-scoped)
  ├─ Last.fm scrape → JSON intermediates
  └─ Consolidation pass: merge both into `shows` table

shows table:
  - source = 'ticketmaster' | 'lastfm' | 'both'
  - TM data wins on conflicts (price, onsale status)
  - Last.fm fills: attendance_count, alt tickets url, shows TM doesn't have
```

## Implementation Steps

### Step 1: User Location Fields

**DB migration**: add columns to `users` table:
```sql
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN country_code TEXT;
ALTER TABLE users ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN longitude DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN show_radius_km INTEGER DEFAULT 60;
ALTER TABLE users ADD COLUMN show_location_mode TEXT DEFAULT 'fixed';
```

**API endpoint** `GET /api/me/geolocation`:
- Reads client IP from request (X-Forwarded-For / X-Real-IP behind Traefik)
- Calls `http://ip-api.com/json/{ip}?fields=city,country,countryCode,lat,lon`
- Returns `{ city, country, country_code, latitude, longitude }`
- Free tier: 45 req/min, no key needed
- Cache result per IP in Redis (24h TTL)

**API endpoint** `PUT /api/me/location`:
- Body: `{ city, country?, show_radius_km? }`
- If only city provided, geocode via Nominatim to get lat/lon/country
- Updates users table
- Auth required (any user)

**Auto-detect flow**:
- On first login or when city is null, Listen frontend calls `GET /api/me/geolocation`
- Presents result to user: "Detected: Madrid, Spain. Is this right?" with edit option
- Saves via `PUT /api/me/location`

Files:
- `app/crate/db/core.py` — migration
- `app/crate/api/me.py` — two new endpoints
- `app/crate/geolocation.py` — IP detection + Nominatim geocoding (adapted from lastfm-extractor)

### Step 2: Listen Preferences UI

New section in Listen Settings/Preferences page:

**Shows Preferences**:
- Location mode toggle: "Fixed city" vs "Near me (detect from connection)"
- City input with autocomplete (calls Nominatim search on type, debounced 500ms)
- Detected city shown as default with "Change" button
- Radius selector: 20 / 40 / 60 / 100 / 150 / 200 km (default 60)
- Country display (derived from city, read-only)
- Save button → `PUT /api/me/location`

DB field: `users.show_location_mode TEXT DEFAULT 'fixed'` (values: `fixed`, `near_me`)

When `near_me` is active, the city input is disabled/greyed with text "Detected automatically from your connection".

Files:
- `app/listen/src/pages/Settings.tsx` (or wherever Listen preferences live)
- New component: `app/listen/src/components/settings/ShowsPreferences.tsx`

### Step 3: Last.fm Events Scraper Integration

Port the lastfm-extractor into Crate as `app/crate/lastfm_events.py`:

**Adapted from**:
- `lastfm_extractor/scraper.py` → `LastFmEventsScraper` class
- `lastfm_extractor/parsers.py` → `parse_listing_page`, `parse_event_detail`
- `lastfm_extractor/models.py` → dataclasses (simplified, no geocoding model needed)
- `lastfm_extractor/geocoding.py` → already covered by Step 1's Nominatim integration

**Changes from original**:
- Use `requests` instead of `httpx` (consistency with rest of crate)
- Use `crate.db.cache` for geocoding cache instead of file-based
- Add `beautifulsoup4` to requirements.txt
- Rate limiting via existing `time.sleep` pattern
- Returns list of dicts ready for DB insertion, not JSON file

**Key function**:
```python
def scrape_lastfm_events(
    city: str,
    latitude: float,
    longitude: float,
    radius_km: int = 60,
    max_pages: int = 10,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict]:
    """Scrape Last.fm events near a city. Returns list of show dicts."""
```

Each returned dict maps to the `shows` table schema:
```python
{
    "external_id": f"lastfm:{event_id}",
    "artist_name": ...,
    "date": ...,
    "local_time": ...,
    "venue": ...,
    "address_line1": ...,
    "city": ...,
    "country": ...,
    "latitude": None,  # Last.fm doesn't give venue coords
    "longitude": None,
    "url": event_link_url or lastfm_url,
    "image_url": poster_image_url or list_image_url,
    "lineup": [...],
    "status": "onsale" if tickets_url else "announced",
    "source": "lastfm",
    "lastfm_attendance": attendance_count,
    "lastfm_url": ...,
    "tickets_url": ...,  # StubHub/Eventbrite link from detail page
}
```

Files:
- `app/crate/lastfm_events.py` — scraper + parsers (single file, ~400 lines)
- `app/requirements.txt` — add `beautifulsoup4`

### Step 4: Shows Table Schema Update

Add columns to support multi-source consolidation:

```sql
ALTER TABLE shows ADD COLUMN source TEXT DEFAULT 'ticketmaster';
ALTER TABLE shows ADD COLUMN lastfm_event_id TEXT;
ALTER TABLE shows ADD COLUMN lastfm_url TEXT;
ALTER TABLE shows ADD COLUMN lastfm_attendance INTEGER;
ALTER TABLE shows ADD COLUMN tickets_url TEXT;
ALTER TABLE shows ADD COLUMN scrape_city TEXT;  -- which city triggered this show
```

Add unique constraint for dedup:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_lastfm_event
ON shows(lastfm_event_id) WHERE lastfm_event_id IS NOT NULL;
```

Update `upsert_show()` in `db/shows.py` to handle both sources and merge logic.

Files:
- `app/crate/db/core.py` — migration
- `app/crate/db/shows.py` — updated upsert with merge logic

### Step 5: Consolidation Logic

New function in `app/crate/db/shows.py`:

```python
def consolidate_show(lastfm_show: dict) -> str:
    """Insert or merge a Last.fm show with existing Ticketmaster data.
    
    Returns: 'inserted' | 'merged' | 'skipped'
    
    Dedup strategy:
    1. Match by lastfm_event_id (exact, if show already scraped)
    2. Match by (artist_name, date, venue) fuzzy — same show from TM
    3. No match → insert as new show with source='lastfm'
    
    Merge rules when TM show exists:
    - Keep TM: price_range, status, external_id, url
    - Add from LFM: lastfm_attendance, lastfm_url, tickets_url (if TM has none)
    - Update source to 'both'
    - Merge lineup: union of both, TM order preserved
    """
```

Fuzzy venue matching: normalize venue names (lowercase, strip "the ", common abbreviations) and compare. Same artist + same date + similar venue name = same show.

Files:
- `app/crate/db/shows.py` — `consolidate_show()` function

### Step 6: Worker Handlers

**`sync_shows_lastfm` task**:
```python
def _handle_sync_shows_lastfm(task_id, params, config):
    """Scrape Last.fm events for a specific city."""
    city = params["city"]
    latitude = params["latitude"]
    longitude = params["longitude"]
    radius_km = params.get("radius_km", 60)
    
    events = scrape_lastfm_events(city, latitude, longitude, radius_km)
    
    # Optional: write JSON intermediate
    json_path = Path(f"/data/shows/lastfm/{city.lower().replace(' ', '-')}-{date.today()}.json")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(events, indent=2))
    
    # Consolidate into DB
    inserted, merged, skipped = 0, 0, 0
    for event in events:
        result = consolidate_show(event)
        if result == 'inserted': inserted += 1
        elif result == 'merged': merged += 1
        else: skipped += 1
    
    return {"scraped": len(events), "inserted": inserted, "merged": merged, "skipped": skipped}
```

**Updated `sync_shows` scheduler**:
The existing scheduler runs `sync_shows` (Ticketmaster) every 24h. Update it to also schedule `sync_shows_lastfm` for each unique user city:

```python
def _schedule_show_syncs():
    """Schedule show syncs for all unique user cities."""
    cities = get_unique_user_cities()  # SELECT DISTINCT city, latitude, longitude FROM users WHERE city IS NOT NULL
    
    # Ticketmaster: per artist (existing behavior)
    create_task("sync_shows")
    
    # Last.fm: per city
    for city in cities:
        create_task("sync_shows_lastfm", {
            "city": city["city"],
            "latitude": city["latitude"],
            "longitude": city["longitude"],
            "radius_km": 60,
        })
```

Register in `TASK_POOL_CONFIG`:
```python
"sync_shows_lastfm": ("fast", 3, 3600, 0),
```

Files:
- `app/crate/worker_handlers/integrations.py` — new handler
- `app/crate/actors.py` — register task
- `app/crate/scheduler.py` — schedule per city

### Step 7: Admin Settings

Add to admin Settings page:

**Shows Configuration**:
- Active cities (read-only list derived from users)
- "Sync Now" button per city
- Toggle: Last.fm scraping enabled/disabled
- Last sync timestamp per source per city
- JSON intermediate files browser (list files in `/data/shows/`)

Files:
- `app/crate/api/settings.py` — shows config endpoints
- `app/ui/src/pages/Settings.tsx` — Shows tab

### Step 8: API Updates

Update `GET /api/me/upcoming` and `GET /api/shows` to:
- Resolve user location: if `show_location_mode = 'near_me'`, detect from request IP (cached 1h in Redis); if `fixed`, read stored city/lat/lon
- Filter ALL shows (both TM and Last.fm) by user's lat/lon + radius using Haversine distance
- Include `source` field so the UI can show "via Last.fm" / "via Ticketmaster"
- Include `lastfm_attendance` for social proof
- Include `tickets_url` as alternative to TM url

Haversine filtering in SQL (Postgres):
```sql
WHERE (
    6371 * acos(
        cos(radians(%s)) * cos(radians(latitude))
        * cos(radians(longitude) - radians(%s))
        + sin(radians(%s)) * sin(radians(latitude))
    )
) <= %s  -- radius_km
```

Or simpler bounding box pre-filter + Haversine post-filter for performance.

Update show card data to pass through the new fields.

Files:
- `app/crate/api/me.py` — resolve location mode, filter by distance
- `app/crate/db/shows.py` — location-aware queries
- `app/crate/geolocation.py` — IP detection with Redis cache

## Execution Order

1. **Step 1** — User location fields (foundation, everything depends on this)
2. **Step 2** — Listen preferences UI (so users can set their city)
3. **Step 4** — Shows table schema update (needed before scraping)
4. **Step 3** — Last.fm scraper integration
5. **Step 5** — Consolidation logic
6. **Step 6** — Worker handlers + scheduling
7. **Step 8** — API updates (location filtering)
8. **Step 7** — Admin settings (nice to have, can come later)

## Dependencies

- `beautifulsoup4` — add to requirements.txt (HTML parsing for Last.fm)
- `ip-api.com` — free, no key, 45 req/min rate limit
- Nominatim (OpenStreetMap) — free, 1 req/sec, needs User-Agent

## Key Design Decisions

**Ticketmaster is also city-filtered**: TM sync continues fetching by artist (finds all shows for library artists), but the API endpoints filter results by user's city + radius before returning them. A Converge show in Tokyo won't appear for a user in Madrid. Both sources serve the same unified `shows` table, both are filtered the same way at query time.

**"Show me near shows" mode**: In Listen preferences, the user can toggle between:
- **Fixed city** — manually set city, always used (default)
- **Near me** — re-detect city from IP on every session, override the fixed city for show filtering

Implementation: `users.show_location_mode = 'fixed' | 'near_me'`. When `near_me`, the `/api/me/upcoming` endpoint calls IP geolocation on each request (cached per IP in Redis for 1h) instead of reading the stored city. This way a user traveling sees local shows automatically.

The preference UI shows:
```
Location for shows:
  ○ Fixed city: [Madrid, Spain] [Change]
  ● Near me (detect from your connection)
  
Radius: [60 km ▼]
```

**JSON intermediates**: kept for 7 days in `/data/shows/lastfm/`, auto-cleaned by the scrape task.

**Rate limiting**: Last.fm scraping at 0.5s/request, ~3 minutes for 5-6 cities. Runs once daily, well within acceptable limits.
