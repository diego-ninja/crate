# API Reference

Base URL: `/api`

All endpoints require authentication (JWT cookie) unless noted. Admin-only endpoints require `role: admin`.

## Browse & Library

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/artists` | List artists (paginated, filterable by genre/country/decade/format) |
| GET | `/artist/{name}` | Artist detail (albums, stats, enrichment data) |
| GET | `/artist/{name}/photo` | Artist photo (filesystem > fanart.tv > deezer > spotify) |
| GET | `/artist/{name}/background` | Artist background image (filesystem > fanart.tv > lastfm > deezer) |
| GET | `/artist/{name}/track-titles` | All track titles for an artist (lightweight, for setlist matching) |
| GET | `/album/{artist}/{album}` | Album detail (tracks, tags, analysis data) |
| GET | `/album/{artist}/{album}/related` | Related albums (same genre, same era) |
| GET | `/cover/{artist}/{album}` | Album cover art |
| GET | `/stream/{filepath}` | Audio file streaming |
| GET | `/search` | Omnisearch (artists, albums, tracks) |
| GET | `/artist-radio/{name}` | Similar tracks via bliss vectors |
| GET | `/similar-tracks/{filepath}` | Find similar tracks to a given file |
| GET | `/discover/completeness` | Discography completeness per artist |
| GET | `/missing/{artist}` | Missing albums vs MusicBrainz |
| GET | `/favorites` | User favorites |
| POST | `/favorites/add` | Add favorite |
| POST | `/favorites/remove` | Remove favorite |

## Acquisition

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/acquisition/status` | Tidal + Soulseek connection status |
| POST | `/acquisition/search/soulseek` | Start Soulseek search (non-blocking) |
| GET | `/acquisition/search/soulseek/{id}` | Poll search results (progressive) |
| POST | `/acquisition/download` | Download from Tidal or Soulseek |
| GET | `/acquisition/queue` | Unified download queue |
| POST | `/acquisition/queue/clear-completed` | Clear completed Soulseek downloads |
| POST | `/acquisition/queue/clear-errored` | Clear errored Soulseek downloads |
| POST | `/acquisition/queue/cleanup-incomplete` | Remove incomplete album downloads |

## Tidal

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tidal/status` | Auth status |
| GET | `/tidal/search` | Search Tidal catalog |
| POST | `/tidal/download` | Queue download |
| GET | `/tidal/queue` | Download queue |
| DELETE | `/tidal/queue/{id}` | Remove from queue |
| SSE | `/tidal/auth/login` | Interactive login flow |
| POST | `/tidal/auth/refresh` | Refresh token |

## Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analyze/artist/{name}` | Analyze all tracks for an artist |
| POST | `/analyze/album/{artist}/{album}` | Analyze album (audio + bliss) |
| GET | `/analyze/artist/{name}/data` | Get analysis data for artist tracks |

## Enrichment

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/artist/{name}/enrich` | Enrich single artist (all sources) |
| POST | `/tasks/enrich-all` | Bulk enrich all artists |

## Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/tags/{artist}/{album}` | Update album + track tags |
| PUT | `/tags/track/{filepath}` | Update single track tags |

## Artwork

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/artwork/missing` | Albums without covers |
| POST | `/artwork/scan` | Scan and fetch all missing covers |
| POST | `/artwork/apply` | Apply a specific cover |
| POST | `/artwork/upload-cover/{artist}/{album}` | Upload album cover (multipart) |
| POST | `/artwork/upload-artist-photo/{name}` | Upload artist photo (multipart) |
| POST | `/artwork/upload-background/{name}` | Upload artist background (multipart) |

## MusicBrainz Matching

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/match/{artist}/{album}` | Search MusicBrainz for matches |
| POST | `/match/apply` | Apply MusicBrainz tags to album |

## Playlists

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/playlists` | List all playlists |
| POST | `/playlists` | Create playlist (manual or smart) |
| GET | `/playlists/{id}` | Playlist detail with tracks |
| PUT | `/playlists/{id}` | Update playlist |
| DELETE | `/playlists/{id}` | Delete playlist |
| POST | `/playlists/{id}/generate` | Regenerate smart playlist |

## Genres

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/genres` | List all genres with counts |
| GET | `/genres/{slug}` | Genre detail (artists, albums) |
| POST | `/genres/index` | Re-index genres from tags |

## Insights & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/insights` | Full insights dataset (15+ chart datasets) |
| GET | `/analytics` | Legacy analytics |
| GET | `/timeline` | Albums by release year |
| GET | `/stats` | Summary stats |

## Management (admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/manage/health-check` | Run health check |
| GET | `/manage/health-report` | Latest health report |
| POST | `/manage/repair-issues` | Repair selected issues |
| POST | `/manage/rebuild` | Wipe + full rebuild |
| POST | `/manage/wipe` | Wipe library database |
| POST | `/manage/artist/{name}/delete` | Delete artist (DB or full) |
| POST | `/manage/album/{artist}/{album}/delete` | Delete album |
| GET | `/manage/audit-log` | Audit log (paginated) |

## Settings (admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/settings` | Full configuration |
| PUT | `/settings/{section}` | Update section (worker, schedules, enrichment, etc.) |
| POST | `/settings/cache/clear` | Clear cache (all or by type) |

## Tasks (admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | List tasks (filterable) |
| GET | `/tasks/{id}` | Task detail |
| POST | `/tasks/{id}/cancel` | Cancel running task |
| POST | `/tasks/{id}/retry` | Retry failed task |
| POST | `/tasks/cleanup` | Remove old completed tasks |
| SSE | `/events/task/{id}` | Real-time task events |
| SSE | `/events` | Global activity stream |

## Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login (email + password) |
| POST | `/auth/logout` | Logout |
| POST | `/auth/register` | Register new user |
| GET | `/auth/me` | Current user |
| GET | `/auth/verify` | Forward-auth for Traefik |
