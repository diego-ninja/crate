# Tidal Integration — Full Design

## Overview

Grooveyard integrates Tidal search + download natively, replacing Tidarr as a separate service. The integration covers library completion, music discovery, and smart acquisition.

## Data Model

### tidal_downloads

Central table for wishlist, queue, and history:

```sql
CREATE TABLE tidal_downloads (
    id SERIAL PRIMARY KEY,
    tidal_url TEXT NOT NULL,
    tidal_id TEXT NOT NULL,
    content_type TEXT NOT NULL,        -- album, track, artist
    title TEXT NOT NULL,
    artist TEXT,
    cover_url TEXT,
    quality TEXT DEFAULT 'max',
    status TEXT DEFAULT 'wishlist',    -- wishlist, queued, downloading, processing, completed, failed
    priority INTEGER DEFAULT 0,
    source TEXT,                        -- search, missing_albums, discography, similar, new_release, genre_discover, quality_upgrade
    task_id TEXT,
    error TEXT,
    metadata_json JSONB,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
```

### tidal_monitored_artists

```sql
CREATE TABLE tidal_monitored_artists (
    artist_name TEXT PRIMARY KEY REFERENCES library_artists(name) ON DELETE CASCADE,
    tidal_id TEXT,
    last_checked TEXT,
    last_release_id TEXT,
    enabled BOOLEAN DEFAULT TRUE
);
```

## Features

### 1. Search & Download (implemented)

- GET /api/tidal/search — proxy to Tidal API v2
- POST /api/tidal/download — queue download task
- Worker: tidal_download → tiddl → move to library → process_new_content

### 2. Download Missing Albums

- GET /api/tidal/match-missing/{artist} — for each missing album, search Tidal
- POST /api/tidal/download-missing/{artist} — queue all matched missing albums
- UI: Download button per missing album in MissingAlbums page
- "Download All Missing" batch button

### 3. Full Discography Download

- GET /api/tidal/artist-discography/{name} — Tidal artist albums crossed with local
- Returns: [{tidal_id, title, year, tracks, quality, status: local|available|not_found}]
- UI: Modal with checkboxes, "Download Selected"
- Button on Artist page header

### 4. Auto-download New Releases

- Toggle "Monitor" per artist (bell icon on artist page)
- Scheduled task check_new_releases (every 6h)
- Checks Tidal for new releases from monitored artists
- Auto-queues new albums with source: "new_release"
- Dashboard notification

### 5. Quality Upgrade

- Task detect_upgradeable: find lossy tracks available lossless on Tidal
- UI section "Upgradeable" with album list
- Re-download replaces files, preserves DB data (bliss, popularity, etc.)

### 6. Similar Artist Download

- In Similar Artists section, "Add to Library" for artists not in library
- Options: Top 3 albums / Full discography / Pick albums
- Source: "similar"

### 7. Genre Discovery

- "Discover on Tidal" button in genre detail view
- Search Tidal by genre, filter out already-owned artists
- "Add starter pack" (top 3) or "Full discography" per artist

### 8. "Complete My Taste"

- Phase 1: Cross-reference similar_json from all artists, rank by frequency, filter out owned
- Phase 2 (future): Use bliss centroids to find sonically similar unowned artists
- Presents: "You'd probably love X — sounds like [your artists]"

### 9. Wishlist

- Status 'wishlist' in tidal_downloads
- Bookmark button on any Tidal search result
- Wishlist section in Download page
- "Download all" to flush wishlist to queue

### 10. Queue Management

- Active downloads with progress at top of Download page
- Queued items ordered by priority, drag to reorder
- Pause/resume global queue
- Cancel individual items
- Sidebar badge with queue count

### 11. Batch Operations

- Missing Albums: "Download All Missing"
- Discography: checkboxes + "Download Selected"
- Search results: select mode
- Genre discover: "Download top 5 artists"

## Download Pipeline

```
User action → insert tidal_downloads (status: queued)
    ↓
Worker picks next by priority
    ↓
tidal_download task:
  1. tiddl download → /tmp/tidal-processing/{task_id}/
  2. Move files to /music/Artist/Album/
  3. Sync artist in DB
  4. Queue process_new_content:
     a. Artist enrichment (Last.fm, MB, Fanart)
     b. Album genre indexing
     c. Album MBID lookup
     d. Essentia audio analysis
     e. Bliss vector computation
     f. Last.fm popularity
  5. Navidrome scan
  6. Update tidal_downloads status: completed
```

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/tidal/status | Auth check |
| GET | /api/tidal/search | Search Tidal |
| POST | /api/tidal/download | Queue single download |
| GET | /api/tidal/artist-discography/{name} | Discography cross-reference |
| GET | /api/tidal/match-missing/{artist} | Match missing albums on Tidal |
| POST | /api/tidal/download-batch | Queue multiple downloads |
| GET | /api/tidal/queue | Get download queue + wishlist |
| PUT | /api/tidal/queue/{id}/priority | Change priority |
| PUT | /api/tidal/queue/{id}/status | Wishlist → queued, cancel, etc. |
| DELETE | /api/tidal/queue/{id} | Remove from queue/wishlist |
| POST | /api/tidal/monitor/{artist} | Toggle artist monitoring |
| GET | /api/tidal/monitored | List monitored artists |
| GET | /api/tidal/discover/genre/{slug} | Genre-based discovery |
| GET | /api/tidal/discover/taste | "Complete my taste" recommendations |
| GET | /api/tidal/upgradeable | Find quality-upgradeable albums |

## Scheduled Tasks

| Task | Interval | Purpose |
|------|----------|---------|
| check_new_releases | 6h | Monitor Tidal for new releases from followed artists |
| process_tidal_queue | 5min | Pick next queued download and start |

## UI Changes

- Download page: search + queue + wishlist (rewrite current)
- Missing Albums: "Download from Tidal" button per album
- Artist page: "Download Discography" + "Monitor" buttons
- Genre page: "Discover on Tidal" button
- Similar Artists: "Add to Library" per artist
- Sidebar: badge with queue count on "Tidal" nav item
- Dashboard: "New Releases" notification card
