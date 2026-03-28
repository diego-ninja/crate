# Similarity & Recommendation System — Deep Analysis

**Date**: 2026-03-28
**Status**: Analysis / Roadmap

---

## 1. Current State

### 1.1 Bliss Vectors (Song DNA)

Each track can have a `bliss_vector` — a `DOUBLE PRECISION[]` column on `library_tracks` containing 20 floats computed by the `grooveyard-bliss` Rust CLI (wrapping the [bliss-rs](https://github.com/Polochon-street/bliss-rs) library).

The 20 dimensions encode:
- **Tempo** (1 float): BPM-derived tempo feature
- **Spectral centroid** (1 float): brightness/timbral center of mass
- **Spectral flatness** (1 float): noise-like vs tonal character
- **Spectral rolloff** (1 float): frequency below which most energy concentrates
- **Zero crossing rate** (1 float): percussive vs harmonic content
- **MFCC coefficients** (15 floats): Mel-Frequency Cepstral Coefficients — the core timbral fingerprint

The binary supports three modes:
- `--file <path>` — single track analysis, returns JSON with `features: [20 floats]`
- `--dir <path>` — batch analysis of a directory
- `--similar-to <path> --dir <lib>` — find N similar tracks (not used in production; DB query is used instead)

**Storage**: Vectors are written to DB via `bliss.store_vectors()`, which only writes to tracks where `bliss_vector IS NULL` (idempotent).

**Coverage**: Computed during `process_new_content` pipeline and via the bulk `compute_bliss` task. Coverage depends on whether the binary is available (x86_64 only in Docker; compiled for linux/amd64).

### 1.2 Artist Radio Algorithm

**Endpoint**: `GET /api/artist-radio/{name}?limit=50`
**Implementation**: `bliss.generate_artist_radio()`

Current algorithm:

1. **Fetch artist tracks**: Get all tracks from the artist that have bliss vectors
2. **Compute centroid**: Average all bliss vectors into a single 20-float centroid (the "sound" of the artist)
3. **Find nearest neighbors**: SQL query computing Euclidean distance from centroid to ALL other tracks in the library (excluding the artist), ordered by distance ASC
4. **Mix**: 40% artist tracks (randomly sampled) + 60% similar tracks (closest by distance)
5. **Interleave**: Simple pattern — every 3rd track is an artist track, rest are similar

The SQL for similarity is:
```sql
SQRT(
    (SELECT SUM(POW(x - y, 2))
     FROM UNNEST(t.bliss_vector, %s::float8[]) AS v(x, y))
) AS distance
```

This is a full table scan computing Euclidean distance in 20D space for every track with a bliss vector.

### 1.3 Track-Level Similarity

**Endpoint**: `GET /api/similar-tracks/{filepath}?limit=20`
**Implementation**: `bliss.get_similar_from_db()`

Same Euclidean distance approach but from a single track's vector (not a centroid). Returns nearest 20 tracks. Currently only used by the API — no UI button exposes this yet.

### 1.4 Similar Artists (Enrichment-based)

Similar artists come from two sources during enrichment:

1. **Last.fm `artist.getsimilar`**: Returns up to 30 similar artists with a `match` score (0.0-1.0). Stored in `library_artists.similar_json`.
2. **Spotify `get_related_artists`**: Returns up to 20 related artists. Used as fallback if Last.fm returns nothing.

Both are persisted to `library_artists.similar_json` during `enrich_artist()`. The enrichment endpoint (`/api/artist/{name}/enrichment`) serves this data to the UI, reconstructing it from DB columns or cache.

**Key issue**: Similar artists are stored as a flat JSON array on each artist row. There is no dedicated relationship table, no bidirectional indexing, and no way to query "which artists consider X as similar" without scanning all rows.

### 1.5 Network Graph

The `ArtistNetworkGraph` component uses `react-force-graph-2d` (D3 force simulation).

**Data flow**:
1. Center artist's `mergedSimilar` (from enrichment cache) provides level-1 nodes
2. For each level-1 node, `prefetchNode()` calls `/api/artist/{name}/enrichment` to get THAT artist's similar list
3. Cross-links are built: if artist A lists B as similar AND both are in the graph, draw a link
4. Node expansion: clicking a node fetches its similar artists and adds well-connected candidates (score >= 1, max 6 new nodes)
5. Node size = popularity (from Last.fm listeners or Spotify popularity)
6. Node color = cyan (center), white (in library), gray (not in library), orange ring (has upcoming shows)

**Prefetch strategy**: Staggered 200ms delays between enrichment fetches to avoid API hammering. Results cached in a module-level `Map` that survives navigation.

### 1.6 Audio Analysis Data Available Per Track

From `library_tracks` columns:

| Column | Type | Source | Notes |
|--------|------|--------|-------|
| `bpm` | `DOUBLE PRECISION` | Essentia/librosa | Beats per minute |
| `audio_key` | `TEXT` | Essentia/librosa | e.g., "C", "F#" |
| `audio_scale` | `TEXT` | Essentia/librosa | "major" or "minor" |
| `energy` | `DOUBLE PRECISION` | PANNs CNN14 | 0.0-1.0 |
| `danceability` | `DOUBLE PRECISION` | PANNs CNN14 | 0.0-1.0 |
| `valence` | `DOUBLE PRECISION` | PANNs CNN14 | 0.0-1.0 (positive/negative mood) |
| `acousticness` | `DOUBLE PRECISION` | PANNs CNN14 | 0.0-1.0 |
| `instrumentalness` | `DOUBLE PRECISION` | PANNs CNN14 | 0.0-1.0 |
| `loudness` | `DOUBLE PRECISION` | Essentia/librosa | LUFS |
| `dynamic_range` | `DOUBLE PRECISION` | Essentia/librosa | dB |
| `spectral_complexity` | `DOUBLE PRECISION` | Essentia/librosa | |
| `mood_json` | `JSONB` | PANNs CNN14 | Top mood labels with scores |
| `bliss_vector` | `DOUBLE PRECISION[]` | grooveyard-bliss | 20-float feature vector |
| `genre` | `TEXT` | Audio tags (mutagen) | Tag-sourced genre |
| `rating` | `INTEGER` | User | 0-5 stars |

Additionally, `artist_genres` and `album_genres` tables provide weighted genre associations.

### 1.7 Related Albums

The `api_related_albums` endpoint already implements a multi-signal approach:
1. Same artist (other albums)
2. Same genre + similar decade (genre_ids IN + year +-5)
3. Similar audio profile (energy + danceability + valence distance)

This is a good template for the track-level similarity we want to build.

---

## 2. Problems with Artist Radio

### 2.1 Centroid Averaging Destroys Signal

The artist's "sound" is reduced to a single centroid (mean of all bliss vectors). This is problematic:

- An artist with both acoustic ballads and heavy tracks gets a centroid that sounds like neither
- The centroid is a point in 20D space that may not correspond to any real track's sound
- Artists with diverse discographies (e.g., Radiohead, Deafheaven) get useless centroids
- **Fix**: Use medoid (actual track closest to centroid) or multiple cluster centroids (K-means on the artist's tracks, then query around each cluster center)

### 2.2 Euclidean Distance in 20D Space

- **Curse of dimensionality**: In high dimensions, distances between points converge — the ratio of nearest-to-farthest neighbor approaches 1.0. At 20D this is borderline; the effect is noticeable but not catastrophic
- **Unweighted dimensions**: All 20 features contribute equally. The 15 MFCC coefficients dominate simply by outnumbering tempo/spectral features (15/20 = 75% of distance weight). This biases similarity toward timbral similarity and underweights tempo, brightness, and noisiness
- **No normalization**: Bliss-rs outputs raw feature values. If one dimension has higher variance, it dominates distance calculations. Library-wide z-score normalization would equalize contributions
- **No indexing**: Full table scan on ~48K tracks. Not slow yet (sub-second) but won't scale if the library grows 10x

### 2.3 No Genre/Mood Filtering

The algorithm finds the closest tracks by raw audio fingerprint regardless of genre. A jazz track with similar timbral qualities to a post-punk track will be recommended. Users expect genre coherence in a radio feature.

### 2.4 No Tempo/Key Awareness

- Two tracks at 80 BPM and 160 BPM might have similar bliss vectors (BPM is only 1/20 of the distance)
- Key compatibility is ignored entirely — DJ-style mixing benefits from harmonic compatibility (Camelot wheel)
- No energy arc: the playlist jumps randomly between high and low energy

### 2.5 No Leveraging of Similar Artists

The algorithm searches the ENTIRE library. It doesn't prioritize tracks from known similar artists. A track from a Last.fm-similar artist that's slightly farther in bliss space is probably a better pick than a random track from an unrelated artist that happens to be closer.

### 2.6 Cold Start Problem

- Tracks without bliss vectors are invisible to the radio
- New imports don't get bliss vectors until `process_new_content` or `compute_bliss` runs
- The bliss binary is x86_64-only; ARM dev environments can't compute vectors
- If an artist has 0 bliss vectors, the radio returns a 404 error with "No bliss data available"

### 2.7 Interleaving is Naive

The current interleave pattern (`i % 3 == 0 → artist track`) produces a predictable pattern. Real radio should feel organic — vary density based on how well similar tracks match, and ensure smooth transitions in energy/tempo.

---

## 3. Opportunities

### 3.A Improved Artist Radio (Multi-Signal)

Replace the single-signal bliss-centroid approach with a weighted multi-signal scorer.

**Scoring formula for each candidate track**:

```
score = w_bliss * bliss_similarity(track, artist_centroid_or_medoid)
      + w_bpm   * bpm_proximity(track.bpm, artist_avg_bpm)
      + w_key   * key_compatibility(track.key, artist_common_keys)
      + w_mood  * mood_similarity(track.mood, artist_mood_profile)
      + w_genre * genre_overlap(track.genre, artist_genres)
      + w_known * similar_artist_bonus(track.artist in similar_artists)
```

**Suggested weights** (tunable):
- `w_bliss = 0.35` — still the strongest signal for timbral similarity
- `w_genre = 0.25` — genre coherence is critical for perceived quality
- `w_known = 0.20` — huge signal; if Last.fm says they're similar, trust it
- `w_bpm = 0.08` — soft constraint, not a dealbreaker
- `w_mood = 0.07` — energy/valence alignment
- `w_key = 0.05` — nice for transitions, low weight

**Two-level similar artists**: Include tracks from artists similar to similar artists (2-hop). If the center artist is "Converge", and "Botch" is similar, and "Coalesce" is similar to "Botch", then Coalesce tracks should be candidates with a reduced `w_known` bonus.

**Session coherence**: After scoring, sort the final playlist by energy curve:
- Start near the artist's average energy
- Allow gentle drift (+/- 0.1 energy per track)
- Optionally support user-defined arcs (building up, winding down)

**Implementation approach**: This can be done entirely in Python — fetch candidates with a broadened SQL query (top 200 by bliss distance), then re-rank in Python with the multi-signal scorer. No need for complex SQL.

### 3.B Similar Artists Graph in DB

**Problem**: Similar artists are stored as JSON arrays on each artist row. No indexing, no bidirectionality, no way to traverse the graph efficiently.

**Solution**: Dedicated `artist_similarities` table.

```sql
CREATE TABLE artist_similarities (
    artist_a TEXT NOT NULL REFERENCES library_artists(name) ON DELETE CASCADE,
    artist_b TEXT NOT NULL REFERENCES library_artists(name) ON DELETE CASCADE,
    score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'lastfm',  -- lastfm, spotify, bliss, manual
    updated_at TEXT NOT NULL,
    PRIMARY KEY (artist_a, artist_b)
);
CREATE INDEX idx_artist_sim_b ON artist_similarities(artist_b);
CREATE INDEX idx_artist_sim_score ON artist_similarities(score DESC);
```

**Population**: During `enrich_artist()`, after fetching Last.fm similar artists, insert/update rows. Store both directions (A→B and B→A) with possibly different scores, OR store only one direction (alphabetical order) and query both sides.

**Advantages**:
- Instant queries: "Give me all artists similar to X" is an indexed lookup, not a JSON parse
- 2-hop traversal: `SELECT * FROM artist_similarities WHERE artist_a IN (SELECT artist_b FROM artist_similarities WHERE artist_a = 'Converge')` — similar-of-similar in one query
- Graph analytics: most connected artists, community detection, isolated nodes
- Network graph data comes from DB instead of N+1 enrichment API calls
- The UI's `ArtistNetworkGraph` could be rewritten to use a single `/api/artist/{name}/network` endpoint that returns pre-computed nodes + links

**Migration**: Backfill from existing `similar_json` on all enriched artists (~900 artists, each with up to 30 similar = ~27K potential rows, likely ~8-12K after deduplication).

### 3.C Track-Level "Find Similar" in UI

The endpoint already exists (`/api/similar-tracks/{filepath}`) but there's no UI for it.

**Improved algorithm**: Replace pure bliss distance with multi-signal:

```sql
-- Phase 1: Broad candidates (top 200 by bliss distance)
SELECT t.*,
    SQRT((SELECT SUM(POW(x-y,2)) FROM UNNEST(bliss_vector, %s::float8[]) AS v(x,y))) AS bliss_dist
FROM library_tracks t
WHERE bliss_vector IS NOT NULL AND path != %s
ORDER BY bliss_dist ASC LIMIT 200;
```

Then in Python:
```python
for track in candidates:
    score = 0
    score += 0.35 * (1 - normalize(track.bliss_dist))       # Bliss similarity
    score += 0.20 * bpm_proximity(track.bpm, source.bpm)     # BPM within +-10%
    score += 0.15 * key_compat(track.key, source.key)        # Camelot wheel
    score += 0.15 * (1 - abs(track.energy - source.energy))  # Energy match
    score += 0.15 * genre_overlap(track.genre, source.genre)  # Genre match
```

**UI**: Button on each track row (or in the context menu) that opens a side panel or modal showing similar tracks with play buttons. Each result shows the similarity score breakdown (timbral, tempo, key, genre).

### 3.D Smart Playlists / Session Builder

**Concept**: User describes a vibe, system builds a playlist.

**Types**:

1. **Energy curve**: "Start energetic, end chill" or "Build up then drop"
   - Sort library tracks by energy, pick tracks that follow the curve
   - Parameters: duration (1h, 2h), start_energy, end_energy, genre_filter

2. **BPM range**: "Running playlist: 140-160 BPM"
   - `SELECT * FROM library_tracks WHERE bpm BETWEEN 140 AND 160`
   - Optionally sort by energy or shuffle

3. **Genre-locked**: "2 hours of post-hardcore"
   - Join through `album_genres` or `artist_genres`, filter by genre
   - Weight by genre relevance score

4. **Key-compatible transitions** (Camelot wheel):
   - Start from a seed track, find next track in compatible key
   - Camelot neighbors: same number (e.g., 8A→8B), +1/-1 (7A→8A→9A)
   - Build a chain of harmonically compatible tracks

5. **Mood-based**: "Chill and acoustic"
   - Filter by valence range, acousticness threshold
   - Combine with energy and genre

**Schema** (already partially exists):
```sql
-- playlists table already has is_smart + smart_rules_json
-- smart_rules_json could store:
{
    "type": "energy_curve",
    "duration_minutes": 120,
    "start_energy": 0.8,
    "end_energy": 0.3,
    "genre": "post-punk",
    "bpm_range": [100, 140]
}
```

The `playlists` table already has `is_smart` and `smart_rules_json` columns. The backend just needs a generator that interprets the rules and fills the playlist.

### 3.E Bliss Vector Enhancements

1. **Per-library normalization**: Compute mean and stddev for each of the 20 dimensions across all tracks. Store as a settings row. When computing distance, use z-scored vectors:
   ```python
   normalized = (vector - mean) / stddev
   ```
   This prevents high-variance dimensions from dominating distance.

2. **Dimension weighting by use case**:
   - For "sounds like" (timbral): weight MFCCs heavily (dims 5-19)
   - For "DJ transition": weight tempo + spectral centroid (dims 0-2)
   - For "mood match": combine bliss with energy/valence from PANNs

3. **Cosine similarity instead of Euclidean**: For high-dimensional sparse-ish data, cosine similarity often works better because it measures direction (shape of the sound) rather than magnitude. In SQL:
   ```sql
   (SELECT SUM(x*y) FROM UNNEST(a, b) AS v(x,y)) /
   (SQRT(SELECT SUM(x*x) FROM UNNEST(a) AS v(x)) * SQRT(SELECT SUM(y*y) FROM UNNEST(b) AS v(y)))
   ```

4. **Approximate nearest neighbor index**: For future scale, consider pgvector extension — supports IVFFlat and HNSW indexes for vector similarity. Would require converting `DOUBLE PRECISION[]` to `vector(20)` type. At 48K tracks this is premature, but worth noting for 500K+ scale.

---

## 4. Recommended Implementation Plan

### Phase 1: Artist Similarities Table + Network API (Low effort, high impact)

**Effort**: 1 session (~3-4 hours)
**Dependencies**: None

1. Add `artist_similarities` table to `init_db()` migration
2. Add `populate_artist_similarities()` function in `db/library.py` that reads `similar_json` from all enriched artists and inserts rows
3. Update `enrich_artist()` to write similarities as part of enrichment
4. New endpoint: `GET /api/artist/{name}/network` — returns nodes + links for the network graph in one call (no N+1)
5. Backfill migration: run on existing data
6. Update `ArtistNetworkGraph` to use the new endpoint (eliminates the staggered enrichment prefetching)

**Impact**: Network graph loads instantly instead of fetching N enrichment endpoints. Enables 2-hop traversal for radio.

### Phase 2: Multi-Signal Artist Radio (Medium effort, high impact)

**Effort**: 1 session (~3-4 hours)
**Dependencies**: Phase 1 (for similar artists lookup)

1. Rewrite `generate_artist_radio()` to use multi-signal scoring
2. Broad candidate selection: bliss top 200 + all tracks from similar artists (1-hop and 2-hop)
3. Score each candidate with the weighted formula
4. Energy-based ordering for session coherence
5. Fallback: if no bliss vectors, use genre + similar artists + BPM to build a radio (solves cold start)

**Impact**: Dramatically better radio quality. Genre-coherent, tempo-aware, leverages editorial knowledge from Last.fm.

### Phase 3: Track-Level "Find Similar" UI (Low effort, medium impact)

**Effort**: 1 session (~2-3 hours)
**Dependencies**: None (existing endpoint works, just needs UI + scoring upgrade)

1. Add "Find Similar" to track context menu
2. Side panel or modal showing results with score breakdown
3. Upgrade `get_similar_from_db()` to multi-signal scoring (same as radio but from single track)
4. Play button on each result, "Add all to queue" button

**Impact**: Discovery feature users will actually use. Low effort since the backend endpoint exists.

### Phase 4: Smart Playlist Generator (Medium effort, medium impact)

**Effort**: 2 sessions (~6-8 hours)
**Dependencies**: None

1. Backend: `_handle_generate_smart_playlist()` worker handler
2. Rule interpreter: parse `smart_rules_json` and build SQL queries
3. Energy curve generator: sort/pick tracks to follow a target energy curve
4. Camelot wheel key compatibility logic
5. UI: Smart playlist creation form in the playlists page
6. Auto-refresh: re-generate smart playlists periodically or on library change

**Impact**: Power feature for engaged users. The Camelot wheel / energy curve stuff is genuinely useful for DJ-style listening.

### Phase 5: Bliss Normalization (Low effort, low-medium impact)

**Effort**: 0.5 session (~1-2 hours)
**Dependencies**: None

1. Compute global mean/stddev for each bliss dimension
2. Store in settings table
3. Apply normalization in distance queries
4. Re-evaluate cosine vs Euclidean after normalization

**Impact**: Subtle quality improvement in all similarity features. Easy to A/B test.

---

## 5. Database Schema Proposals

### 5.1 Artist Similarities

```sql
CREATE TABLE IF NOT EXISTS artist_similarities (
    artist_a TEXT NOT NULL,
    artist_b TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'lastfm',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (artist_a, artist_b),
    FOREIGN KEY (artist_a) REFERENCES library_artists(name) ON DELETE CASCADE,
    FOREIGN KEY (artist_b) REFERENCES library_artists(name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artist_sim_b ON artist_similarities(artist_b);
CREATE INDEX IF NOT EXISTS idx_artist_sim_score ON artist_similarities(score DESC);
```

**Notes**:
- Store both directions: if Last.fm says A→B with score 0.8, also insert B→A with score 0.8 (or a discounted score like 0.6 if B doesn't reciprocally list A)
- `source` allows tracking where the relationship came from (lastfm, spotify, manual, bliss-computed)
- FK constraints ensure cleanup when artists are deleted
- For artist_b that don't exist in library_artists: skip the FK or store without FK and add a `in_library BOOLEAN` flag

**Alternative (for artists not in library)**:
```sql
CREATE TABLE IF NOT EXISTS artist_similarities (
    id SERIAL PRIMARY KEY,
    artist_a TEXT NOT NULL,  -- always a library artist
    artist_b TEXT NOT NULL,  -- may or may not be in library
    artist_b_in_library BOOLEAN DEFAULT FALSE,
    score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'lastfm',
    updated_at TEXT NOT NULL,
    UNIQUE(artist_a, artist_b, source)
);
CREATE INDEX IF NOT EXISTS idx_artist_sim_a ON artist_similarities(artist_a);
CREATE INDEX IF NOT EXISTS idx_artist_sim_b ON artist_similarities(artist_b);
CREATE INDEX IF NOT EXISTS idx_artist_sim_in_lib ON artist_similarities(artist_b_in_library) WHERE artist_b_in_library = TRUE;
```

This is more practical since most similar artists from Last.fm/Spotify won't be in the local library. The `artist_b_in_library` flag enables fast queries like "which similar artists do I already have?"

### 5.2 Bliss Normalization Stats

```sql
-- Store as a single settings row
-- key: 'bliss_normalization'
-- value: {"mean": [20 floats], "stddev": [20 floats], "computed_at": "2026-03-28T...", "track_count": 48000}
```

No new table needed — use the existing `settings` table.

### 5.3 Smart Playlist Rules (already exists)

The `playlists` table already has `is_smart BOOLEAN` and `smart_rules_json JSONB`. No schema changes needed, just define the rule format:

```json
{
    "version": 1,
    "rules": [
        {"type": "genre", "value": "post-punk", "operator": "contains"},
        {"type": "bpm", "min": 120, "max": 160},
        {"type": "energy", "min": 0.5, "max": 1.0},
        {"type": "year", "min": "2015", "max": "2026"},
        {"type": "key", "value": "8A", "mode": "camelot_compatible"}
    ],
    "ordering": "energy_desc",
    "limit": 50,
    "duration_target_minutes": 120
}
```

---

## 6. Summary

| Feature | Effort | Impact | Dependencies |
|---------|--------|--------|--------------|
| Artist similarities table + network API | Low (3-4h) | High | None |
| Multi-signal artist radio | Medium (3-4h) | High | Phase 1 |
| Track "Find Similar" UI | Low (2-3h) | Medium | None |
| Smart playlist generator | Medium (6-8h) | Medium | None |
| Bliss normalization | Low (1-2h) | Low-Medium | None |

**Recommended order**: Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 4

Phase 1 and 2 together transform the radio from "technically works" to "genuinely useful". Phase 3 is a quick win. Phase 5 is a small tweak that improves all similarity calculations. Phase 4 is the biggest build but can wait since it's a new feature rather than fixing an existing one.
