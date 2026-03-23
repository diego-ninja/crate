# Unified Acquisition — Tidal + Soulseek Integration

## Overview

Rename "Tidal" to "Acquisition". Unified search hits both Tidal and Soulseek in parallel. Downloads queue to either source transparently. Quality filter for Soulseek configurable in Settings.

## Architecture

```
UI (Acquisition page)
  ↓ POST /api/acquisition/search
  ↓
API → parallel:
  ├─ Tidal search (existing tidal.py)
  └─ Soulseek search (new soulseek.py → slskd API)
  ↓
Consolidated results:
  - Group by album (artist + album name)
  - Each result shows: source badge, quality badge, availability
  - User picks source per album or uses "Best Available"
  ↓
POST /api/acquisition/download
  ├─ source=tidal → existing tidal download flow
  └─ source=soulseek → slskd download API → watcher picks up → process_new_content
```

## Backend

### New: `app/musicdock/soulseek.py`

slskd client:
- `search(query, quality_filter)` → POST /api/v0/searches + poll responses
- `download(username, files)` → POST /api/v0/transfers/downloads/{user}
- `get_downloads()` → GET /api/v0/transfers/downloads
- `get_status()` → GET /api/v0/application (connection state)
- Quality filtering: parse filename/extension/bitDepth/sampleRate from results

### New: `app/musicdock/api/acquisition.py`

Unified router replacing tidal-specific endpoints:
- `POST /api/acquisition/search` → parallel Tidal + Soulseek
- `POST /api/acquisition/download` → route to correct source
- `GET /api/acquisition/queue` → merged download queue
- `GET /api/acquisition/status` → both source statuses

### Modify: existing tidal endpoints

Keep `/api/tidal/*` working for backward compat, but acquisition page uses new unified endpoints.

## Settings

New in Settings → Processing tab:
- **Soulseek Quality Filter**: dropdown (FLAC only, FLAC + 320k, Any)
- **Soulseek Min Bitrate**: number input (default 320)
- **Soulseek Preferred Source**: when both have result (Tidal first, Soulseek first, Best quality)
- **slskd URL**: text input (default http://slskd:5030)

## Search Result Consolidation

```typescript
interface AcquisitionResult {
  artist: string;
  album: string;
  year?: string;
  sources: {
    tidal?: { id: string; quality: string; tracks: number };
    soulseek?: { username: string; quality: string; files: SoulseekFile[]; speed: number; freeSlot: boolean };
  };
  bestSource: "tidal" | "soulseek";
  inLibrary: boolean;
}
```

Group Soulseek results by album (parse path: `Artist/Album/track.flac`).
Score sources by: quality > speed > free slots.

## UI

### Acquisition page (replaces Download.tsx)

Tabs: Search | Queue | Wishlist | History (same structure)

Search results:
```
┌─ Converge — Jane Doe ─────────────────────────────────┐
│ [TIDAL] FLAC 16/44.1 · 11 tracks     [Download]      │
│ [SLSK]  FLAC 24/96  · Burningman · 5MB/s [Download]  │
│ [SLSK]  FLAC 16/44  · user2 · 2MB/s       [Download] │
│ Already in library: No                                 │
└────────────────────────────────────────────────────────┘
```

Queue: unified view of Tidal + Soulseek downloads with progress.

### Sidebar

"Tidal" → "Acquisition" with Download icon.

## Docker

Uncomment slskd in docker-compose.yaml, add to musicdock network.
Add SLSKD_URL env var to api + worker.

## Implementation order

1. Backend: soulseek.py client
2. Backend: acquisition.py unified API
3. Settings: quality filter + slskd URL
4. UI: rename + unified search + consolidated results
5. Docker: uncomment slskd
