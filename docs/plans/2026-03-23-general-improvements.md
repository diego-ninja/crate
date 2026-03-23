# General Improvements — Implementation Plan

## Features
1. Now Playing fullscreen
2. Browse with filters + grid/list
3. Omnisearch (progressive, cache, recents, keyboard)
4. Related Albums + Discover page
5. Notification Center + Progress Toasts
6. Context Menu + Command Palette

## Batch 1 — Backend APIs + Independent UI (parallel)

### Agent A: Backend endpoints
- `GET /api/track-info/{path}` — BPM, key, energy, danceability from library_tracks
- `GET /api/browse/filters` — available genres, countries, decades, formats with counts
- `GET /api/artists` — add query params: genre, country, decade, format, sort (name/popularity/albums/recent)
- `GET /api/album/{artist}/{album}/related` — same genre+decade + same artist + audio similar
- `GET /api/discover/completeness` — per-artist local vs MB album count, missing list

### Agent B: Omnisearch refactor
- Split into useLocalSearch + useTidalSearch with independent debounce (200ms/500ms)
- Show local results immediately, Tidal arrives async
- In-memory cache (Map<string, results>)
- Recent searches in localStorage (shown on focus with empty input)
- Arrow key navigation, Enter to open, Escape to close

### Agent C: Context Menu + Command Palette
- Install cmdk package
- ContextMenu component using @radix-ui/react-context-menu
- Apply to AlbumCard, TrackTable rows
- Items: Play, Play Next, Add to Queue, Add to Playlist, Go to Artist/Album, Enrich, Download
- CommandPalette (Cmd+K): navigation + actions + search
- Register in Shell.tsx with global keydown listener

### Agent D: Notification Center
- NotificationContext: in-memory store of task completions/failures
- NotificationBell component in header (badge with unread count)
- Dropdown with last 10 notifications, click marks as read
- useTaskNotifications hook: subscribes to task completions via polling /api/activity/live
- Progress toasts: useProgressToast hook that takes task_id, uses useTaskEvents SSE to update toast

## Batch 2 — Features that depend on Batch 1

### Agent E: Now Playing fullscreen
- NowPlaying.tsx: fullscreen overlay triggered from player
- Background: album cover blur-3xl + dark overlay
- Center: large cover, title, artist, album
- Audio metadata: BPM, Key, Energy (from /api/track-info)
- Full-width visualizer (reuse existing 4 modes)
- Tabs at bottom: Queue | Lyrics
- Toggle in AudioPlayer.tsx: expanded state

### Agent F: Browse with filters
- Refactor Browse.tsx: filter bar + grid/list toggle
- Fetch filters from /api/browse/filters on mount
- Genre, Country, Decade, Format dropdowns
- Sort: Name, Popularity, Albums, Recently Added
- List view: compact rows with photo, name, albums, tracks, size, genre badges
- URL params sync (?genre=x&sort=y)

### Agent G: Related Albums + Discover page
- RelatedAlbums component at bottom of Album.tsx
- Horizontal scroll of AlbumCards from /api/album/{a}/{b}/related
- New page Discover.tsx at /discover
- Completeness bars per artist, missing albums list
- "Download Missing from Tidal" button per artist
- Add to Sidebar + App.tsx routes

## Packages needed
- cmdk (command palette)
- @radix-ui/react-context-menu (likely already in shadcn)
