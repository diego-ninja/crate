# Crate

Self-hosted music library manager with enrichment, audio analysis, streaming, and acquisition from Tidal and Soulseek.

Crate indexes your music collection, enriches it with metadata from multiple sources, analyzes audio characteristics using ML models, and provides a modern web UI for browsing, discovering, and playing your library.

## Features

**Library Management**
- Automatic filesystem scanning and indexing (watchdog)
- Health check and repair pipeline (orphans, stale records, duplicates, naming)
- ID3 tag editor (album-level and per-track) with genre badge picker
- Folder organizer with pattern-based renaming
- Duplicate detection and resolution
- Album art manager (6 sources: Cover Art Archive, embedded, Deezer, iTunes, Last.fm, MusicBrainz)
- Manual image upload with crop (cover art, artist photo, background)

**Enrichment Pipeline**
- Last.fm: bio, tags, similar artists, listeners, playcount
- MusicBrainz: MBID, discography, country, members, formation dates, URLs
- Fanart.tv: artist backgrounds and thumbnails
- Setlist.fm: probable concert setlists
- Spotify: popularity score
- Deezer: artist photos (fallback)

**Audio Analysis**
- Hybrid PANNs CNN14 + Essentia analysis engine
- PANNs (AudioSet 527 classes): genre-based mood classification (aggressive, dark, electronic, acoustic)
- Essentia: BPM, key, loudness (EBU R128), dynamic range, danceability
- Signal heuristics for tonal moods (happy, sad, valence from key/tempo)
- Batch processing with 4-track PANNs inference (~4s/track)
- Bliss-rs: 20-float song similarity vectors for radio mode and transition playlists

**Acquisition**
- Tidal integration (search, download, HiRes/FLAC/Normal quality)
- Soulseek integration via slskd (progressive search, quality filtering, alternate peer retry)
- Unified acquisition page with download queue management
- Automatic post-download pipeline: sync, enrich, analyze, covers

**Player**
- Web audio player with direct file streaming
- 4 real-time visualizer modes (bars, wave, radial, glow) via Web Audio API
- Queue management, shuffle, repeat, playback speed, sleep timer
- Playlist export (.m3u), save to playlist, scrobble to Navidrome
- Synced lyrics from lrclib.net

**Smart Playlists**
- Composable rules: genre, BPM, energy, danceability, valence, year, key, artist, format, popularity
- Match all/any conditions
- Auto-sync to Navidrome

**Discovery**
- Discography completeness (local vs MusicBrainz)
- Artist network graph (similar artists visualization)
- Genre explorer with auto-generated playlists
- Timeline view (albums by release year)
- Probable concert setlist with library track matching

**Insights**
- 15+ interactive charts (Nivo): format distribution, decades, genres, BPM, moods, loudness, energy vs danceability, key distribution, artist popularity, country distribution
- Quality report (corrupt files, low bitrate, mixed formats)

**System**
- Multi-user auth (JWT + Google OAuth)
- Scheduled tasks with configurable intervals
- Docker stack management from UI (containers, logs, restart)
- Audit log for destructive operations
- Redis cache (L1 in-memory, L2 Redis, L3 PostgreSQL)

## Architecture

```
                    Traefik (reverse proxy + TLS)
                              |
              +---------------+---------------+
              |               |               |
          crate-ui        crate-api       crate-worker
         (React SPA)     (FastAPI)        (Python)
          nginx proxy    /music:ro        /music:rw
              |               |               |
              +-------+-------+-------+-------+
                      |               |
                  PostgreSQL        Redis
                                  (cache)
```

| Service | Tech | Role |
|---------|------|------|
| **crate-api** | FastAPI + Uvicorn | REST API, audio streaming, SSE events |
| **crate-worker** | Python ThreadPoolExecutor (5 slots) | Background tasks, filesystem writes, analysis |
| **crate-ui** | React 19 + Vite + Tailwind 4 | SPA with nginx reverse proxy to API |
| **PostgreSQL 15** | | Persistent storage |
| **Redis 7** | | Multi-tier cache (256MB, allkeys-lru) |
| **Navidrome** | Subsonic API | Streaming backend, top tracks, playlist sync |
| **slskd** | | Soulseek client (REST API) |

The API container mounts the music library as **read-only**. All filesystem modifications (tag writes, file moves, downloads) go through the worker via the task queue.

## Tech Stack

**Backend**: Python 3.13, FastAPI, psycopg2, mutagen, Essentia, PANNs (PyTorch), librosa, musicbrainzngs, tiddl, Pillow, Redis

**Frontend**: React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Nivo charts, react-easy-crop, cmdk, lucide-react, sonner

**Audio Analysis**: Essentia (signal processing), PANNs CNN14 (AudioSet classification), bliss-rs (Rust, song similarity vectors)

**Infrastructure**: Docker Compose, Traefik, Navidrome, slskd, Redis, PostgreSQL

## Quick Start

### Development

```bash
# Start backend services (PostgreSQL + Redis + API + Worker)
make dev

# Start frontend dev server (separate terminal)
cd app/ui && API_URL=http://localhost:8585 npm run dev
```

Dev uses 3 test artists (Birds In Row, High Vis, Rival Schools) in `test-music/`.

### Production

```bash
# Configure
cp .env.example .env
# Edit .env with your API keys, passwords, and paths

# Deploy
make deploy
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MEDIA_DIR` | Yes | Path to your music library |
| `DATA_DIR` | Yes | Path for persistent data |
| `LASTFM_APIKEY` | Yes | Last.fm API key |
| `FANART_API_KEY` | No | Fanart.tv API key |
| `SETLISTFM_API_KEY` | No | Setlist.fm API key |
| `SPOTIFY_ID` / `SPOTIFY_SECRET` | No | Spotify API credentials |
| `SLSKD_API_KEY` | No | slskd API key (for Soulseek) |
| `JWT_SECRET` | Yes | Secret for JWT tokens |
| `NAVIDROME_PASSWORD` | Yes | Navidrome admin password |

## Makefile Commands

```bash
make dev              # Start dev environment
make dev-rebuild      # Rebuild and restart dev
make dev-reset        # Reset dev (delete data)
make dev-logs         # Follow dev logs

make deploy           # Full deploy (sync + build + restart)
make deploy-sync      # Sync files only
make deploy-restart   # Restart services only
make deploy-logs      # Follow production logs
make deploy-ps        # Service status
make deploy-shell s=X # Shell into service X
```

## Project Structure

```
app/
  musicdock/              Python backend
    api/                  FastAPI routers (one per domain)
    db/                   Database functions + schema
    worker.py             42 task handlers + worker loop
    enrichment.py         Unified enrichment pipeline
    audio_analysis.py     PANNs + Essentia hybrid engine
    bliss.py              Rust CLI integration
    tidal.py              Tidal auth/search/download
    soulseek.py           slskd REST API client
    library_sync.py       Filesystem to DB sync
    library_watcher.py    Watchdog filesystem watcher
    scheduler.py          Periodic task scheduler
    health_check.py       Library integrity checks
    repair.py             Auto-repair pipeline
  ui/
    src/
      pages/              20+ page components (lazy-loaded)
      components/         Shared UI components
      contexts/           React contexts (Player, Auth)
      hooks/              Custom hooks (useApi, useFavorites, etc.)
  scripts/
    download_models.sh    Essentia + PANNs model downloader
  Dockerfile
  requirements.txt

tools/
  grooveyard-bliss/       Rust CLI for audio similarity (bliss-rs)

docs/
  architecture.md         System architecture
  audio-analysis.md       Audio analysis pipeline
  enrichment.md           Enrichment sources and pipeline
  api.md                  API reference

docker-compose.yaml       Production stack (12 services)
docker-compose.dev.yaml   Development stack
Makefile                  Dev, deploy, utilities
```

## Audio Analysis Pipeline

Crate uses a three-tier hybrid approach for audio analysis:

1. **PANNs CNN14** (primary, production): Classifies audio into 527 AudioSet categories. Weighted label groups map to mood dimensions (aggressive, dark, happy, electronic, etc.). Batch inference processes 4 tracks simultaneously.

2. **Essentia** (signal processing): Extracts BPM, musical key, loudness (EBU R128), dynamic range, spectral complexity. Runs on all tracks regardless of PANNs availability.

3. **Heuristics** (fallback): When PANNs is not available (ARM/dev), derives mood from signal features (key major/minor for happy/sad, spectral centroid for aggressive, etc.).

The hybrid approach uses PANNs for genre-based moods (where it excels) and signal heuristics for tonal moods (where key detection is more reliable than AudioSet labels).

## Bliss Song Similarity

The `grooveyard-bliss` Rust CLI computes a 20-dimensional feature vector per track using [bliss-rs](https://github.com/Polochon-street/bliss-rs). These vectors encode tempo, timbre, loudness, chroma, and spectral characteristics into a compact representation that enables:

- **Artist Radio**: Find the N most similar tracks to a seed track
- **Transition playlists**: Order tracks by smooth transitions
- **Similar track discovery**: Cross-artist similarity based on actual audio content

## License

Private project. Not licensed for redistribution.
