# Enrichment Pipeline

Crate enriches artist and album metadata from multiple external sources through a unified pipeline.

## Pipeline Flow

When new content arrives (Tidal download, Soulseek download, or filesystem watcher detection):

```
process_new_content task
  |
  1. Reorganize folders (Artist/Year/Album structure)
  2. Artist enrichment (6 sources)
  3. Album genre indexing (from audio tags)
  4. Album MBID lookup (MusicBrainz fuzzy match)
  5. Audio analysis (PANNs + Essentia)
  6. Bliss vectors (Rust CLI)
  7. Popularity (Last.fm listeners/playcount)
  8. Cover art (6 sources)
```

## Artist Enrichment Sources

All sources are called through `enrich_artist()` in `enrichment.py`:

### 1. Last.fm
- **Data**: Bio (HTML stripped), top tags, similar artists (up to 15), listener count, playcount
- **Auth**: API key (`LASTFM_APIKEY`)
- **Caching**: Results persisted to `library_artists` columns; cache expires but DB data survives

### 2. Spotify
- **Data**: Popularity score (0-100), Spotify ID, follower count
- **Auth**: Client ID + Secret (`SPOTIFY_ID`, `SPOTIFY_SECRET`)
- **Note**: Currently returns 403 (requires Premium account)

### 3. MusicBrainz
- **Data**: MBID, country, area, formation year, dissolution year, members (JSON array), external URLs (Wikipedia, Discogs, Wikidata, etc.)
- **Auth**: None (rate-limited to 1 req/sec)
- **Matching**: Fuzzy search with `thefuzz`, minimum score threshold of 80 to prevent false matches

### 4. Setlist.fm
- **Data**: Probable setlist (most commonly played songs, weighted by frequency)
- **Auth**: API key (`SETLISTFM_API_KEY`)
- **Display**: Artist page "Setlist" tab with library track matching

### 5. Fanart.tv
- **Data**: Artist backgrounds (panoramic 1920x1080), artist thumbnails
- **Auth**: API key (`FANART_API_KEY`)
- **Selection**: Multiple images scored by aspect ratio; random pick on each page load

### 6. Deezer
- **Data**: Artist photos (square, fallback source)
- **Auth**: None (scraping via search API)

## Artist Photo Resolution

The photo endpoint tries sources in priority order:

1. **Manual upload on disk** (`artist.jpg`) - highest priority
2. **Fanart.tv thumbnails** (random pick if `?random=true`)
3. **Last.fm / Fanart.tv / Deezer / Spotify** via `get_best_artist_image()`
4. **First album cover** (last resort)

## Background Image Resolution

1. **Manual upload on disk** (`background.jpg`) - highest priority
2. **Fanart.tv backgrounds** (panoramic, random pick)
3. **Last.fm scraped backgrounds** (scored by aspect ratio)
4. **Deezer artist image**
5. **Spotify artist image**
6. **Artist photo on disk** (last resort)

## Album MBID Matching

For each album, Crate searches MusicBrainz for the best matching release:

1. Search by artist + album name (fuzzy)
2. Score results by string similarity (`thefuzz.fuzz.ratio`)
3. Reject matches below 80% to prevent false positives
4. Auto-apply tags when score >= 95% (configurable threshold)
5. Lower scores shown in UI for manual review

Applied data: `musicbrainz_albumid`, `musicbrainz_releasegroupid`, genre tags, track-level MBIDs.

## Cover Art Sources

Checked in order for each album:

1. **Cover Art Archive** (by MBID, if available)
2. **Embedded audio** (FLAC/MP3 APIC tag)
3. **Deezer** (search by artist + album)
4. **iTunes** (search API)
5. **Last.fm** (album info)
6. **MusicBrainz search** (secondary MBID lookup)

Covers saved as `cover.jpg` in the album directory. Manual upload via UI also supported (with crop).

## Scheduled Enrichment

| Task | Default Interval | Description |
|------|-----------------|-------------|
| `library_pipeline` | 30 min | Health check + repair + sync |
| `enrich_artists` | 24 hours | Full re-enrichment of all artists |
| `compute_analytics` | 1 hour | Recompute stats and charts |
| `check_new_releases` | 6 hours | Check Tidal for monitored artists |
| `cleanup_incomplete_downloads` | 48 hours | Remove partial Soulseek downloads |

All intervals are configurable from Settings > Schedules.

## Data Persistence

Enrichment data is persisted directly to `library_artists` columns:

```
bio, tags_json, similar_json, spotify_id, mbid, country, area,
formed, ended, members_json, urls_json, listeners, lastfm_playcount,
spotify_followers, enriched_at, has_photo
```

This means enrichment data survives cache expiration. The `enriched_at` timestamp controls when re-enrichment is needed.

## Cache Strategy

- **Don't cache partial results**: Only cache enrichment results that include Last.fm or Spotify data
- **Prefix-based invalidation**: `delete_cache_prefix("enrichment:")` clears all enrichment cache
- **Per-artist reset**: Settings page or `POST /api/manage/artist/{name}/reset` clears all caches for one artist and re-enriches
