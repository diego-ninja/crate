<p align="center">
  <img src="app/listen/public/icons/logo.svg" alt="Crate logo" width="140">
</p>

<h1 align="center">Crate</h1>

<p align="center"><strong>Own your music.</strong></p>

<p align="center">
  A self-hosted music platform that indexes your library, enriches it with rich metadata, brings in your Bandcamp purchases and uploads, analyzes every track, and streams it to a dedicated listening app — so your collection stays yours.
</p>

---

Crate is a full-stack, self-hosted music system. It watches your filesystem,
syncs/imports user-owned Bandcamp purchases and direct uploads, pulls metadata
from Last.fm / MusicBrainz / Fanart.tv / Setlist.fm / Spotify, analyzes audio
with PANNs + Essentia + bliss-rs, and exposes separate apps on top of a single
FastAPI backend: an **admin** web app for library management and a **Listen**
app (web/PWA/native shells) for playback and discovery. Underneath that, the
backend maintains a snapshot/read-model plane for admin and Listen surfaces.
Every installation is also a federation node: with no peers it is a one-node
network; approved peers extend the same global catalog, taxonomy, human URLs,
playback, imports, user references, and Open Subsonic surface without a mode
switch. Pairing is bilateral, authorization and quotas are owner-side, and the
Go readplane relays remote media without receiving private signing keys.

## Features

**Library management**

- Automatic filesystem scanning and indexing (watchdog + periodic scans)
- Health check and auto-repair pipeline (orphans, stale records, duplicates, naming)
- ID3 tag editor (album-level and per-track) with genre badge picker
- Folder organizer with pattern-based renaming
- Duplicate detection and resolution
- Album art manager (6 sources: Cover Art Archive, embedded, Deezer, iTunes, Last.fm, MusicBrainz)
- Manual image upload with crop (cover art, artist photo, background)
- User contribution tracking for uploads and Bandcamp imports, with portable export and withdrawal controls

**Enrichment pipeline**

- **Last.fm** — bio, tags, similar artists, listeners, playcount, upcoming shows (scraper)
- **MusicBrainz** — MBID, discography, country, members, formation dates, URLs
- **Fanart.tv** — artist backgrounds and thumbnails
- **Setlist.fm** — probable concert setlists matched against library tracks
- **Spotify** — popularity score
- **Discogs** — catalog numbers, labels
- **Deezer / iTunes** — artist photos (fallback)

**Audio analysis**

- Hybrid **PANNs CNN14 + Essentia** engine
- PANNs (AudioSet 527 classes): genre-based mood classification (aggressive, dark, electronic, acoustic)
- Essentia: BPM, key, loudness (EBU R128), dynamic range, danceability
- Signal heuristics for tonal moods (happy / sad / valence from key + tempo)
- Batch PANNs inference (~4 tracks at a time)
- `bliss-rs`: 20-float song similarity vectors powering radio mode and smooth transition playlists

**Genre taxonomy**

- 60+ curated genre graph with parent / related / influenced-by / fusion-of edges
- Mix seeding from a single genre expands to musically adjacent genres via BFS traversal
- Alias matching across library tags
- Signed global taxonomy releases with source-provenanced memberships and local overlays

**Federation**

- Node-first global artist, album, track, genre, and user-reference model
- Bilateral signed pairing, typed least-privilege grants, key rotation, replay protection, and strict HTTPS/SSRF policy
- Snapshot plus durable delta catalog synchronization with resumable checkpoints and tombstones
- Stable human routes across local and remote sources (`/artists/high-vis`)
- Owner-side stream tickets, atomic quotas, revocation, Range support, and a benchmark-gated Go byte relay
- Explicit approved imports with signed manifests, disk reservations, hash verification, provenance, and worker-only publication
- Signed opt-in directories, global likes/playlists/radio, opt-in remote scrobbling, and global Open Subsonic IDs

**Acquisition**

- **Bandcamp** — connect a user Bandcamp account, sync collection / wishlist / following, import owned downloadable purchases, persist artist/album Bandcamp links, and dedupe against the shared instance library
- **Tidal** — search and download via `tiddl`, with artifact repair and best-quality-real-output fallback when a provider-labeled lossless download is not actually lossless
- **Soulseek** — progressive search with quality filtering and alternate peer retry via `slskd`
- **Uploads** — users can upload audio files or ZIP archives into the shared library with contributor attribution
- Unified acquisition UI with download queue, concurrency limits (2 slots) and history
- Automatic post-download pipeline: sync → enrich → analyze → artwork

**Listening (Listen app)**

- Gapless playback and equal-power crossfade powered by Gapless-5
- Fade-in / fade-out on pause and resume
- Network-aware soft interruption with probe-and-resume on reconnect
- WebGL visualizer (spheres mode) with album-palette color extraction
- Synced lyrics from `lrclib.net`
- Queue, shuffle, repeat, smart suggestions, infinite playback
- Upcoming shows near your location (Last.fm + Ticketmaster consolidated)
- Jam sessions (shared playback invites)
- Social layer: follow people, user connections, profile pages
- Bandcamp support CTAs on linked artists/albums and a user library contributions view
- Media session + lock-screen controls + keyboard shortcuts
- PWA + native iOS / Android via Capacitor
- Rich play events, derived listening stats, and async scrobbling

**Smart playlists**

- Composable rules: genre, BPM, energy, danceability, valence, year, key, artist, format, popularity
- Match all / any conditions
- Native generation + refresh

**Discovery**

- Discography completeness (local vs. MusicBrainz)
- Artist network graph (similar artists visualization)
- Genre explorer with auto-generated playlists
- Timeline (albums by release year)
- Probable concert setlist with library track matching
- New releases monitor

**Insights**

- Interactive charts (Nivo): format distribution, decades, genres, BPM, moods, loudness, energy × danceability, key distribution, artist popularity, country distribution
- Quality report (corrupt files, low bitrate, mixed formats)

**System**

- Multi-user auth (persisted sessions + Google/Apple OAuth + bearer auth for native Listen)
- Background scheduler/service loop with configurable recurring work
- Docker stack management from the admin UI (containers, logs, restart)
- Audit log for destructive operations
- Three-tier cache: L1 in-memory, L2 Redis, L3 PostgreSQL
- Snapshot-backed admin/listen surfaces warmed by domain events
- Replayable cache invalidation and home snapshot refreshes for catalog/import changes
- Telegram bot for status, task control, and playback notifications

## Architecture

```
                         Traefik (reverse proxy + TLS)
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
     crate-ui                    crate-listen                  crate-api
    (admin SPA)              (PWA + Capacitor)                (FastAPI)
                                                                   |
                                                        /music read-only
         |                            |                            |
         +----------------------------+--------------+-------------+
                                                   |
                                             crate-readplane
                                          (Go snapshot/read API)
                                                   |
                         +-------------------------+-------------------------+
                         |                                                   |
                    PostgreSQL 15                                        Redis 7
                  (source of truth)                         (cache, broker, SSE, events)
                         |                                                   |
             +-----------+-----------+----------------+----------------------+
             |                       |                |                      |
        crate-worker          crate-projector   analysis/playback      media-worker
     (fast/default tasks,       (snapshots)      maintenance queues   (Go/Rust media)
       service loop)
             |
       /music read-write
```

| Service                      | Tech                                     | Role                                                                              |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| **crate-api**                | FastAPI + Uvicorn                        | REST/control plane, signing, local audio, SSE, federation policy and snapshots    |
| **crate-readplane**          | Go                                       | Low-latency read models and bounded remote federation stream relay                |
| **crate-worker**             | Python + Dramatiq (Redis broker)         | Fast/default background tasks, filesystem writes, imports, scheduler/service loop |
| **crate-projector**          | Python                                   | Redis/domain events → warmed PostgreSQL snapshots/read models                     |
| **crate-maintenance-worker** | Python + Dramatiq                        | Repair, enrichment, sync and maintenance queues                                   |
| **crate-analysis-worker**    | Python + native tools                    | CPU-heavy audio analysis, fingerprints and bliss vectors                          |
| **crate-playback-worker**    | Python + ffmpeg                          | Playback preparation and transcoding work                                         |
| **crate-media-worker**       | Go/Rust-backed service                   | Lightweight media metadata/stream helper service                                  |
| **crate-ui**                 | React 19 + Vite + Tailwind 4             | Admin SPA (desktop-oriented library management)                                   |
| **crate-listen**             | React 19 + Vite + Tailwind 4 + Capacitor | Consumer listening app (PWA + iOS + Android)                                      |
| **crate-postgres**           | PostgreSQL 15                            | Persistent storage                                                                |
| **crate-redis**              | Redis 7                                  | Cache + Dramatiq broker + invalidation replay + domain-event stream               |
| **slskd**                    | Optional                                 | Soulseek client (REST API) for acquisition                                        |
| **proton-vpn**               | Optional                                 | HTTP proxy for scraping/acquisition workloads                                     |
| **traefik**                  | —                                        | Reverse proxy + automatic TLS (Let's Encrypt)                                     |

The API container mounts the music library as **read-only**. All filesystem modifications (tag writes, file moves, downloads) go through the worker via Dramatiq actors.

## Tech Stack

**Backend** — Python 3.13, FastAPI, Dramatiq, SQLAlchemy 2.0, psycopg2, Alembic, mutagen, Essentia, PANNs (PyTorch CPU), librosa, musicbrainzngs, tiddl, Pillow, Redis, BeautifulSoup.

**Frontend** — React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Nivo charts, Gapless-5 (Listen), Capacitor (Listen), Leaflet (admin maps), lucide-react, sonner.

**Frontend apps**

- `app/ui` — admin web app, desktop-oriented, management workflows.
- `app/listen` — consumer listening app. PWA + iOS + Android via Capacitor.

**Audio analysis** — Essentia (signal processing), PANNs CNN14 (AudioSet classification), `bliss-rs` (Rust song similarity vectors).

**Infrastructure** — Docker Compose, GHCR images, Traefik, Redis, PostgreSQL, optional slskd and ProtonVPN.

## Quickstart

### Self-hosted install

Fastest path on a Linux/macOS machine with Docker:

```bash
curl -fsSL https://cratemusic.app/install.sh | bash
```

The installer asks for the install directory, music library path, access mode,
and initial admin password. It writes a small self-hosted stack to your machine,
pulls pre-built GHCR images, and starts Crate with Docker Compose.

After installation:

- Admin: `http://localhost:8580`
- Listen: `http://localhost:8581`
- `cloudflare`: public HTTPS at `https://admin.<domain>` and `https://listen.<domain>`
- `hosts`: local HTTP subdomains via `/etc/hosts`
- `dnsmasq`: local HTTP wildcard subdomains, installing dnsmasq if needed
- `ports`: localhost ports only, no domain routing

Advanced/non-interactive example:

```bash
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_ASSUME_YES=1 \
    CRATE_ACCESS_MODE=cloudflare \
    CRATE_INSTALL_DIR=/opt/crate \
    CRATE_MUSIC_DIR=/srv/music \
    CRATE_DOMAIN=example.com \
    CF_DNS_API_TOKEN=cloudflare-token \
    DEFAULT_ADMIN_PASSWORD=change-me \
    bash
```

Local-domain examples:

```bash
# Explicit entries in /etc/hosts:
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_ACCESS_MODE=hosts CRATE_DOMAIN=crate.local bash

# Wildcard local DNS. The installer checks/installs dnsmasq:
curl -fsSL https://cratemusic.app/install.sh \
  | CRATE_ACCESS_MODE=dnsmasq CRATE_DOMAIN=crate.local bash
```

Set `CRATE_SKIP_START=1` if you only want the installer to write
`docker-compose.yaml`, `.env`, and `config.yaml`.

### Local development

Minimum steps to get the full stack running locally from a fresh clone.

#### Prerequisites

- Docker + Docker Compose
- Node.js 20+ and npm (for the Vite dev servers)
- A music folder on disk (or use `test-music/` which ships with 3 artists for dev)

#### 1. Clone and configure

```bash
git clone https://github.com/thecrateapp/crate.git
cd crate

cp .env.example .env
# Open .env and fill in at least:
#   MEDIA_DIR=./test-music           # or your library path
#   DATA_DIR=./data
#   JWT_SECRET=$(openssl rand -hex 32)
#   LASTFM_APIKEY=<your key>         # https://www.last.fm/api/account/create
#   DEFAULT_ADMIN_PASSWORD=admin
```

Everything else in `.env` is optional and can be filled in later from the admin Settings page.

#### 2. Start the stack

```bash
make dev
```

This brings up the dev containers (Postgres + Redis + API + Worker + Caddy) and spawns Vite dev servers for both frontends:

- **Admin** — <http://localhost:5173>
- **Listen** — <http://localhost:5174>
- **Docs** — <http://localhost:5175>
- **API** — <http://localhost:8585>

When using the local dev domains through Caddy, the equivalent URLs are:

- **Admin** — <https://admin.dev.lespedants.org>
- **Listen** — <https://listen.dev.lespedants.org>
- **Docs** — <https://docs.dev.cratemusic.app>
- **API** — <https://api.dev.lespedants.org>

#### 3. Log in

Default dev credentials:

```
email:    admin@cratemusic.app
password: admin
```

Change them from **Settings → Users** after first login.

#### 4. Index your library

The filesystem watcher picks up new files automatically. To force a full re-scan:

1. Open the admin UI
2. **Command Palette** (`⌘K` / `Ctrl+K`)
3. Type _scan_ → **Scan library**

Enrichment (Last.fm / MusicBrainz / audio analysis) runs automatically after the scan.

#### 5. (Optional) Mobile apps

```bash
make cap-ios       # build + run Listen in iOS Simulator
make cap-android   # build + run Listen in Android Emulator
```

Requires Xcode / Android Studio installed locally.

#### Stopping / resetting

```bash
make dev-down        # stop everything
make dev-reset       # stop + wipe Postgres/Redis volumes
make dev-rebuild     # rebuild images and restart
```

## Environment variables

The `.env` file drives both dev and production. Required unless noted.

| Variable                                                                | Required   | Description                                                                                             |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `MEDIA_DIR`                                                             | Yes        | Path to your music library (mounted into API read-only, worker read-write)                              |
| `DATA_DIR`                                                              | Yes        | Path for persistent state (DB volumes, cache, etc.)                                                     |
| `DOMAIN`                                                                | Yes (prod) | Base domain used by Traefik (`admin.<DOMAIN>`, `listen.<DOMAIN>`, `api.<DOMAIN>`)                       |
| `JWT_SECRET`                                                            | Yes        | Secret for JWT tokens                                                                                   |
| `DEFAULT_ADMIN_PASSWORD`                                                | Yes        | Initial password for the bootstrap admin user                                                           |
| `LASTFM_APIKEY`                                                         | Yes        | Last.fm API key — used for enrichment and upcoming shows                                                |
| `LASTFM_API_SECRET`                                                     | No         | Required only for scrobbling                                                                            |
| `FANART_API_KEY`                                                        | No         | Fanart.tv — artist backgrounds and thumbnails                                                           |
| `SETLISTFM_API_KEY`                                                     | No         | Setlist.fm — probable concert setlists                                                                  |
| `SPOTIFY_ID` / `SPOTIFY_SECRET`                                         | No         | Spotify — popularity score                                                                              |
| `DISCOGS_CONSUMER_KEY` / `DISCOGS_CONSUMER_SECRET`                      | No         | Discogs — catalog numbers and labels                                                                    |
| `TICKETMASTER_API_KEY`                                                  | No         | Ticketmaster — upcoming shows (primary source)                                                          |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                             | No         | Google OAuth login                                                                                      |
| `SLSKD_API_KEY`                                                         | No         | slskd API key (Soulseek integration)                                                                    |
| `SLSKD_SLSK_USERNAME` / `SLSKD_SLSK_PASSWORD`                           | No         | Soulseek network credentials                                                                            |
| `CRATE_CREDENTIAL_KEY`                                                  | No         | Stable Fernet key for encrypted external session material. Defaults to JWT-derived key if unset         |
| `CRATE_USER_INACTIVE_AFTER_DAYS`                                        | No         | Days without login, session or playback activity before the admin label becomes `Inactive` (default 30) |
| `CRATE_BANDCAMP_COLLECTION_SYNC_*`                                      | No         | Bandcamp collection sync backend, timeout, page size and max pages                                      |
| `CRATE_BANDCAMP_DOWNLOAD_*`                                             | No         | Bandcamp purchase download backend and timeout                                                          |
| `CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_*`                                | No         | Optional server-side Bandcamp credential bridge. Disabled by default                                    |
| `PROTONVPN_USER` / `PROTONVPN_PASS`                                     | No         | Proton VPN credentials for the scraping proxy                                                           |
| `CRATE_POSTGRES_USER` / `CRATE_POSTGRES_PASSWORD` / `CRATE_POSTGRES_DB` | Yes        | App-level Postgres role                                                                                 |
| `PUID` / `PGID`                                                         | Yes        | Host UID/GID for file ownership                                                                         |
| `CRATE_IMAGE_OWNER` / `CRATE_IMAGE_REGISTRY`                            | No         | Container image namespace and registry. Defaults to `thecrateapp` / `ghcr.io`                           |
| `TZ`                                                                    | Yes        | Timezone (e.g. `Europe/Madrid`)                                                                         |

## Makefile commands

```bash
# Dev
make dev              # Full dev stack (backend + both frontends)
make dev-back         # Backend only (no frontends)
make dev-admin        # Just the admin Vite server on :5173
make dev-listen       # Just the Listen Vite server on :5174
make dev-down         # Stop everything
make dev-reset        # Stop + wipe volumes
make dev-rebuild      # Rebuild + restart
make dev-logs [s=svc] # Follow dev logs (optionally filter by service)
make dev-test         # Run pytest in the worker container

# Deploy (production)
make deploy           # Deploy an immutable manifest; restart changed services
make deploy-image-rollback DEPLOY_ID=X CONFIRM=rollback-images
make deploy-build     # Deploy with on-server build (fallback)
make deploy-sync      # Sync files only (no restart)
make deploy-restart   # Restart remote services
make deploy-logs      # Follow remote logs
make deploy-ps        # Remote service status
make deploy-shell s=X # Shell into a remote service

# Capacitor (mobile)
make cap-build        # Build Listen for Capacitor
make cap-ios          # Build + run on iOS Simulator
make cap-android      # Build + run on Android Emulator
make cap-ios-open     # Open iOS project in Xcode
make cap-android-open # Open Android project in Android Studio
```

## Project structure

```
app/
  crate/                Python backend (API + Worker)
    api/                FastAPI routers (auth, browse, playlists, shows, ...)
    db/                 PostgreSQL schema + typed query modules
    actors.py           Dramatiq actors (background tasks)
    broker.py           Dramatiq + Redis broker setup
    scheduler.py        Settings-driven recurring task scheduler
    enrichment.py       Last.fm / MusicBrainz / Fanart / Setlist pipeline
    bandcamp/           Bandcamp session, collection sync, download and matching
    audio_analysis.py   PANNs + Essentia hybrid engine
    bliss.py            crate-cli Rust CLI integration
    tidal.py            Tidal search + download orchestration (tiddl)
    soulseek.py         slskd REST client
    library_sync.py     Filesystem → DB sync
    library_watcher.py  Watchdog filesystem watcher
    health_check.py     Library integrity checks
    repair.py           Auto-repair pipeline
    genre_taxonomy.py   60+ genre graph + BFS expansion
    lastfm_events.py    Last.fm events scraper (proxied via ProtonVPN)
  ui/                   Admin SPA (React 19 + Vite)
    src/
      pages/            25+ admin pages (Dashboard, Browse, Health, Shows, ...)
      components/       Shared UI components
  listen/               Listen app (React 19 + Vite + Capacitor)
    src/
      pages/            Home, Library, Album, Artist, Playlist, Shows, Jam, ...
      components/       Player, queue, lyrics, visualizer, show cards
      contexts/         Thin auth/offline facades + player orchestration
      lib/              gapless-player, cache, api client, native/server boundary
    ios/                Capacitor iOS project
    android/            Capacitor Android project
  shared/               Frontend core shared between ui and listen
  scripts/
    download_models.sh  Essentia + PANNs model downloader

tools/
  crate-cli/     Rust CLI for audio similarity (bliss-rs)

docs/
  architecture.md       System architecture
  audio-analysis.md     Audio analysis pipeline
  enrichment.md         Enrichment sources and pipeline
  api.md                API reference
  plans/                Design documents (dated)

docker-compose.yaml       Production stack
docker-compose.dev.yaml   Development stack
Makefile                  Dev, deploy, Capacitor, utilities
```

## Audio analysis pipeline

Crate uses a three-tier hybrid approach:

1. **PANNs CNN14** (primary, x86_64): classifies audio into 527 AudioSet categories. Weighted label groups map to mood dimensions (aggressive, dark, happy, electronic, etc.). Batch inference processes ~4 tracks simultaneously.
2. **Essentia** (signal processing): extracts BPM, musical key, loudness (EBU R128), dynamic range, spectral complexity. Runs on every track.
3. **Heuristics** (fallback): when PANNs is unavailable (ARM / dev), derives mood from signal features (key major/minor for happy/sad, spectral centroid for aggressive, etc.).

The hybrid split uses PANNs for genre-based moods (where it excels) and signal heuristics for tonal moods (where key detection is more reliable than AudioSet labels).

## Bliss song similarity

The `crate-cli` Rust CLI computes a 20-dimensional feature vector per track using [bliss-rs](https://github.com/Polochon-street/bliss-rs). These vectors encode tempo, timbre, loudness, chroma, and spectral characteristics into a compact representation that enables:

- **Artist radio** — find the N most similar tracks to a seed
- **Transition playlists** — order tracks by smooth transitions
- **Cross-artist similarity discovery** — based on actual audio content, not tags

## License

Private project. Not licensed for redistribution.
