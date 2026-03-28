# Crate Listen — Design Document

Date: 2026-03-28
Status: Approved

---

## What We're Building

A polished, consumer-facing PWA for music streaming and discovery. Crate Listen is the "Spotify experience" on top of Crate's self-hosted music library. While `admin.lespedants.org` manages the library (enrichment, tasks, health), `listen.lespedants.org` is where users play music, build playlists, discover new releases, and check upcoming shows.

Target: 5-50 users in a community sharing a music library (900+ artists, 4400+ albums, 48K+ tracks, 1.2TB).

---

## Architecture

```
listen.lespedants.org (crate-listen)    admin.lespedants.org (crate-ui)
         │                                        │
         └──────────── crate-api ────────────────┘
                          │
                    ┌─────┼─────┐
                    │     │     │
              PostgreSQL Redis Navidrome
                                │
                          /music (1.2TB)
```

- **`app/listen/`** — New React 19 + Tailwind 4 + shadcn PWA
- **Same API** (`crate-api`) — no new backend, same endpoints
- **Navidrome** — invisible streaming engine (Subsonic API proxy)
- **`crate-listen`** Docker service — nginx serving static build, Traefik label for `listen.${DOMAIN}`

---

## Layout Decision

**Adaptive: Sidebar on desktop, Bottom Tabs on mobile.**

### Desktop (>=768px)
```
┌──────┬─────────────────────────────────────┐
│ ICON │  Search bar                         │
│ SIDE │─────────────────────────────────────│
│ BAR  │                                     │
│      │  Main Content Area                  │
│ Home │  (Browse / Artist / Album /         │
│ Srch │   Playlist / Shows)                 │
│ Lib  │                                     │
│ Show │                                     │
│      │                                     │
│ ──── │                                     │
│ User │                                     │
├──────┴─────────────────────────────────────┤
│ ▶ Now Playing Bar (full width)             │
└────────────────────────────────────────────┘
```

### Mobile (<768px)
```
┌────────────────────────┐
│ Header + Search        │
├────────────────────────┤
│                        │
│  Main Content Area     │
│  (scrollable)          │
│                        │
│                        │
├────────────────────────┤
│ ▶ Mini Now Playing     │
├────────────────────────┤
│ Home  Explore  Lib  Cal│
└────────────────────────┘
```

### Fullscreen Player (tap now-playing)
- Large album art with background gradient from dominant color
- WebGL visualizer (reuse from admin)
- Controls: shuffle, prev, play/pause, next, repeat
- Progress bar (waveform style)
- Tabs: Queue | Lyrics
- Swipe down to dismiss

---

## Design System

### Colors
```
Background:     #0a0a0f (near-black)
Surface:        #0f0f17 (sidebar, cards)
Surface-2:      #12121a (input backgrounds, hover)
Border:         #1a1a2e
Text Primary:   #ffffff
Text Secondary: #a1a1aa
Text Muted:     #555555
Accent:         #06b6d4 (cyan-500)
Accent Hover:   #0891b2 (cyan-600)
Accent Subtle:  #06b6d420 (cyan with 12% opacity)
Success:        #10b981
Error:          #ef4444
```

### Typography
- System font stack (same as admin)
- Headings: 700 weight, tight letter-spacing
- Body: 400 weight, 1.5 line-height
- Monospace for metadata (BPM, key, format)

### Component Library
- shadcn/ui as base (same as admin)
- Custom: PlayerBar, NowPlaying, TrackRow, AlbumCard, ArtistCard, ShowCard, PlaylistCard
- Icons: lucide-react (same as admin)

---

## Pages & Navigation

### Primary Navigation (4 items)

| Tab | Mobile Icon | Desktop Label | Page |
|-----|------------|---------------|------|
| Home | House | Home | Personalized feed: recently played, recommendations, new releases, upcoming shows |
| Explore | Search | Explore | Search + browse by genre, mood, decade. Smart radio. |
| Library | Grid | Library | User's playlists, liked songs, artists, albums |
| Shows | Calendar | Shows | Upcoming concerts calendar (Ticketmaster data) |

### Pages

| Route | Description |
|-------|-------------|
| `/` | Home feed — personalized content |
| `/explore` | Search + genre/mood browsers |
| `/library` | User playlists + favorites |
| `/shows` | Concert calendar |
| `/artist/:name` | Artist profile: bio, albums, similar, shows |
| `/album/:artist/:album` | Album detail: tracks, info, play all |
| `/playlist/:id` | Playlist detail: tracks, edit, play |
| `/radio/:seed` | Auto-generated radio from seed track/artist |
| `/player` | Fullscreen now playing (also accessible via tap) |
| `/login` | Auth page |
| `/profile` | User settings, playback preferences |

---

## Core Features (MVP)

### 1. Home Feed
- **Now Playing hero** (if something is playing)
- **Recently Played** (horizontal scroll of albums)
- **New in Library** (recently added albums/artists)
- **Your Playlists** (quick access cards)
- **Upcoming Shows** (next 3-5 shows near user)
- **Recommended** (based on listening history + similarity)

### 2. Player
Reuse and evolve from admin's FloatingPlayer + PlayerContext:
- Full playback controls (play/pause, skip, seek, volume)
- Queue management (add, remove, reorder, save as playlist)
- Shuffle + repeat modes
- Lyrics (synced from lrclib.net, auto-scroll)
- Star rating (1-5, synced with Navidrome)
- WebGL visualizer (3D icospheres, reuse existing)
- Media Session API for OS lock screen controls
- Keyboard shortcuts (space=play, N=next, etc.)
- Gapless playback (preload next track)

### 3. Search & Explore
- Unified search: artists, albums, tracks
- Genre browser (grid of genre cards with track counts)
- Mood/Energy browser (filter by audio analysis data)
- Smart Radio: pick a seed track → auto-generate queue from similar tracks (bliss vectors)
- BPM range filter for workout/DJ playlists

### 4. Library
- **Playlists** — create, edit, smart playlists with rule builder
- **Liked Songs** — starred tracks
- **Artists** — followed/favorited artists
- **Albums** — saved albums
- **Recently Played** — persistent history (not just 10 in localStorage)

### 5. Shows Calendar
- Monthly/weekly calendar view
- Show cards with artist, venue, city, date
- Filter by city/country
- "Interested" toggle per show
- Link to ticket purchase

### 6. News Feed
- New releases detected by Crate's `check_new_releases` task
- New albums added to library
- Show announcements for followed artists
- Chronological, filterable by type

---

## API Endpoints Used

All existing — no new backend needed for MVP:

| Feature | Endpoints |
|---------|-----------|
| Browse | `/api/browse/*`, `/api/artist/*`, `/api/album/*` |
| Stream | `/api/navidrome/stream/{id}`, `/api/stream/{path}` |
| Search | `/api/navidrome/search`, `/api/browse/search` |
| Playlists | `/api/playlists/*` |
| Covers | `/api/cover/{artist}/{album}` |
| Lyrics | External: `lrclib.net` API |
| Shows | `/api/shows/*` |
| Ratings | `/api/track/rate`, `/api/track-info/*` |
| Scrobble | `/api/navidrome/scrobble` |
| Similar | `/api/similar-tracks`, `/api/artist/{name}/similar` |
| New Releases | `/api/releases/*` |
| Auth | `/api/auth/login`, `/api/auth/me` |
| Radio | `/api/radio/*` (artist radio), `/api/similar-tracks` |

### New Endpoints Needed (Phase 2)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/feed` | Personalized feed (new releases + shows + recommendations) |
| `GET /api/history` | Persistent play history per user |
| `POST /api/history` | Record play event |
| `GET /api/recommendations` | ML-based recommendations from listening patterns |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Routing | React Router 7 |
| State | React Context (player) + hooks |
| Icons | lucide-react |
| Charts | None (listen app doesn't need analytics) |
| Toasts | sonner |
| Build | Vite |
| PWA | vite-plugin-pwa (Workbox) |
| Mobile | Capacitor (future phase) |

---

## PWA Configuration

```json
{
  "name": "Crate Listen",
  "short_name": "Listen",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#0a0a0f",
  "background_color": "#0a0a0f",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192" },
    { "src": "/icon-512.png", "sizes": "512x512" }
  ]
}
```

- Service worker for offline shell (app loads without network)
- Cache album covers aggressively (long TTL, stale-while-revalidate)
- Background sync for scrobbles when offline
- Media Session API for native OS controls

---

## Docker Integration

```yaml
# In docker-compose.yaml
crate-listen:
  build: ./app/listen
  container_name: crate-listen
  restart: unless-stopped
  depends_on:
    - crate-api
  networks:
    - crate
  labels:
    traefik.enable: true
    traefik.docker.network: crate
    traefik.http.routers.listen.rule: Host(`listen.${DOMAIN}`)
    traefik.http.routers.listen.entryPoints: websecure
    traefik.http.services.listen.loadbalancer.server.port: 80
    traefik.http.routers.listen.tls: true
    traefik.http.routers.listen.tls.certresolver: letsencrypt
```

Dockerfile: same pattern as `app/ui/Dockerfile` (Node build → nginx serve).

nginx.conf: same SPA config (try_files, proxy /api to crate-api).

---

## Project Structure

```
app/listen/
  src/
    components/
      layout/
        Shell.tsx           # Main layout (sidebar/bottom nav adaptive)
        Sidebar.tsx         # Desktop sidebar
        BottomNav.tsx       # Mobile bottom tabs
        SearchBar.tsx       # Unified search
      player/
        PlayerBar.tsx       # Bottom persistent player
        FullscreenPlayer.tsx  # Fullscreen now playing
        QueuePanel.tsx      # Queue management
        Lyrics.tsx          # Synced lyrics
        Visualizer.tsx      # WebGL visualizer (from admin)
      cards/
        AlbumCard.tsx
        ArtistCard.tsx
        PlaylistCard.tsx
        TrackRow.tsx
        ShowCard.tsx
      ui/                   # shadcn/ui components
    pages/
      Home.tsx
      Explore.tsx
      Library.tsx
      Shows.tsx
      Artist.tsx
      Album.tsx
      Playlist.tsx
      Radio.tsx
      Login.tsx
      Profile.tsx
    contexts/
      PlayerContext.tsx      # Audio state + queue (fork from admin)
      AuthContext.tsx        # User session
    hooks/
      use-api.ts            # API fetching (from admin)
      use-media-session.ts  # OS media controls
      use-breakpoint.ts     # Responsive breakpoint detection
    lib/
      api.ts                # API client (from admin)
      utils.ts              # Utilities (from admin)
    App.tsx
    main.tsx
  public/
    manifest.json
    icon-192.png
    icon-512.png
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  tailwind.config.ts
  Dockerfile
  nginx.conf
```

---

## Implementation Phases

### Phase 1: Scaffold + Player (Core)
- [ ] Initialize Vite + React 19 + Tailwind 4 project
- [ ] Set up shadcn/ui
- [ ] Adaptive Shell layout (sidebar desktop / bottom tabs mobile)
- [ ] Port PlayerContext from admin
- [ ] PlayerBar (bottom persistent)
- [ ] FullscreenPlayer (tap to expand)
- [ ] Basic routing (Home, Explore, Library, Shows, Artist, Album)
- [ ] Auth (login page, JWT/cookie session)
- [ ] Docker + Traefik config
- [ ] PWA manifest + service worker basics

### Phase 2: Browse + Search
- [ ] Home feed (recently played, new in library, playlists)
- [ ] Album page (track list, play all, cover art)
- [ ] Artist page (bio, albums, similar)
- [ ] Search with results (artists, albums, tracks)
- [ ] Genre browser
- [ ] AlbumCard, ArtistCard, TrackRow components

### Phase 3: Playlists + Library
- [ ] Playlist CRUD (create, edit, delete)
- [ ] Smart playlist builder (rule-based)
- [ ] Liked Songs
- [ ] Save queue as playlist
- [ ] Playlist sync to Navidrome

### Phase 4: Shows + Feed
- [ ] Shows calendar page
- [ ] Show cards with venue/date/lineup
- [ ] News feed (new releases, library additions, show announcements)
- [ ] Feed API endpoint (backend)

### Phase 5: Radio + Discovery
- [ ] Smart Radio (seed track → similar queue)
- [ ] "Play Similar" from any track context menu
- [ ] Mood/energy-based exploration
- [ ] Autoplay when queue ends

### Phase 6: PWA + Capacitor
- [ ] Offline shell caching
- [ ] Album cover precaching
- [ ] Background scrobble sync
- [ ] Media Session API (lock screen controls)
- [ ] Capacitor iOS/Android builds
- [ ] Push notifications (new releases, shows)

---

## Shared Code from Admin

Copy and evolve (not symlink — they'll diverge):

| File | Purpose | Changes needed |
|------|---------|---------------|
| `PlayerContext.tsx` | Audio state | Add Media Session, persistent history |
| `use-api.ts` | API fetching | Same |
| `api.ts` | API client | Same |
| `utils.ts` | Utilities | Same |
| `visualizer/*` | WebGL 3D vis | Same |
| `components/ui/*` | shadcn base | Same |

---

## What Listen Does NOT Have

- No task management (that's admin)
- No enrichment controls
- No library health/repair
- No worker status
- No file management (delete/move/retag)
- No Tidal/Soulseek acquisition
- No analytics dashboards
- No user management (admin creates accounts)
