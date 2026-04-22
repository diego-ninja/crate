# Quickstart — Deploy to Production

Get Crate running on your server in under 5 minutes.

## Prerequisites

- A Linux server (VPS, home server, NAS — anything that runs Docker)
- Docker and Docker Compose v2 installed
- A directory containing your music library (FLAC, MP3, AAC, OGG, etc.)
- A domain name pointing to your server (for HTTPS via Traefik)

## 1. Clone and configure

```bash
git clone https://github.com/diego-ninja/crate.git
cd crate
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Required
MUSIC_DIR=/path/to/your/music          # Absolute path to your music library
DOMAIN=your-domain.com                 # Domain for HTTPS certificates
TZ=Europe/Madrid                       # Your timezone
CF_DNS_API_TOKEN=your-cloudflare-token # Cloudflare API token (for Let's Encrypt DNS challenge)

# Ports (defaults work for most setups)
TRAEFIK_HTTP_PORT=80
TRAEFIK_HTTPS_PORT=443
```

## 2. Start the stack

```bash
docker network create crate
docker compose up -d
```

This starts the full production stack:

| Service | Role |
|---------|------|
| **traefik** | Reverse proxy — automatic HTTPS via Let's Encrypt |
| **crate-api** | FastAPI backend — library indexing, API, streaming |
| **crate-worker** | Background jobs — enrichment, analysis, downloads |
| **crate-ui** | Admin web app — manage, curate, analyze your library |
| **crate-listen** | Listening app — playback, radio, discovery, social |
| **crate-postgres** | PostgreSQL 15 — all persistent data |
| **crate-redis** | Redis 7 — cache, job broker, real-time SSE |

Your services will be available at:

| URL | App |
|-----|-----|
| `https://admin.your-domain.com` | Admin dashboard |
| `https://listen.your-domain.com` | Listening app |
| `https://api.your-domain.com` | API (+ Subsonic at `/rest`) |

## 3. Run the setup wizard

Open `https://admin.your-domain.com` in your browser. On first launch, Crate shows a four-step setup wizard:

### Step 1 — Create Admin Account

Enter your name, email, and password. This is your administrator login.

### Step 2 — API Keys (optional)

Crate enriches your library from multiple external sources. Each key is optional — skip any you don't need and add them later in Settings.

| Service | What it unlocks | Get your key |
|---------|----------------|--------------|
| **Last.fm** | Artist bios, similar artists, tags, popularity | [last.fm/api](https://www.last.fm/api/account/create) |
| **Ticketmaster** | Upcoming shows for library artists | [developer.ticketmaster.com](https://developer.ticketmaster.com/) |
| **Spotify** | Artist images (Client ID + Secret) | [developer.spotify.com](https://developer.spotify.com/dashboard) |
| **Fanart.tv** | High-quality artist backgrounds | [fanart.tv](https://fanart.tv/get-an-api-key/) |
| **Setlist.fm** | Concert setlists and probable setlists | [api.setlist.fm](https://api.setlist.fm/docs/1.0/index.html) |

### Step 3 — Library Scan

Click "Start Scan". Crate will index every file in your music directory, read tags, and build the library database. This runs in the background — you can start using Crate immediately.

### Step 4 — Done

The admin dashboard shows scan progress and library stats. Once indexing finishes, background enrichment kicks in automatically.

## 4. Start listening

Open `https://listen.your-domain.com` and sign in. This is the listening app — browse your library, play music, use radio, discover with Music Paths, follow artists.

**Android:** Download the APK from [GitHub Releases](https://github.com/diego-ninja/crate/releases/latest/download/crate.apk).

**iPhone:** Open the listen URL in Safari → Share → Add to Home Screen.

## 5. Subsonic clients

Crate is Subsonic-compatible. Point any client at `https://api.your-domain.com/rest`:

- Symfonium, DSub, Ultrasonic (Android)
- play:Sub (iOS)
- Submariner (macOS)

## What happens automatically

After setup, Crate runs these background tasks on a schedule:

| Task | Interval | What it does |
|------|----------|-------------|
| Artist enrichment | 24h | Bios, photos, similar artists, discographies |
| Genre indexing | On new content | Maps tags to curated taxonomy (60+ canonical nodes) |
| Audio analysis | Continuous | BPM, key, loudness, energy, mood, danceability |
| Bliss vectors | Continuous | 20-float acoustic DNA for similarity radio and Music Paths |
| Popularity | 24h | Last.fm listeners and playcount |
| New releases | 12h | MusicBrainz release monitoring |
| Shows | 24h | Ticketmaster upcoming shows |

No manual intervention needed. Check progress at any time in the admin Tasks page.

## Updating

```bash
cd /path/to/crate
git pull
docker compose up -d --build
```

Or if using pre-built GHCR images:

```bash
docker compose pull
docker compose up -d
```
