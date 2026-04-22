# Music Paths — Acoustic Route Planning

**Date:** 2026-04-22
**Status:** Draft
**Scope:** New feature — navigable listening routes through bliss vector space

## Concept

Music Paths is a GPS for musical taste. The user picks an origin and a
destination (genre, artist, album, or track) and Crate computes a
listening route that transitions gradually through the acoustic space
between them. Each track in the path is a natural stepping stone.

Example: "Start at NY Hardcore, end at Crank Wave" produces a playlist
that drifts from Madball → Trapped Under Ice → Defeater → Refused →
Squid → Scowl, with each track acoustically bridging to the next.

## Data Model

```
music_paths
  id            serial primary key
  user_id       int references users(id)
  name          text                        -- "NYHC → Crank Wave"
  origin_type   text                        -- "genre" | "artist" | "album" | "track"
  origin_value  text                        -- slug, id, or path
  dest_type     text
  dest_value    text
  waypoints     jsonb default '[]'          -- [{type, value}, ...]
  step_count    int default 20
  tracks        jsonb                       -- computed [{track_id, storage_id, ...}]
  created_at    timestamptz
  updated_at    timestamptz
```

## Algorithm

### 1. Resolve endpoints to bliss vectors

Each endpoint (origin, destination, waypoints) resolves to a
representative bliss vector:

- **Track** → its own bliss_vector
- **Album** → centroid of all track vectors in the album
- **Artist** → centroid of top N tracks by popularity/playcount
- **Genre** → centroid of tracks with highest artist_genres weight

```python
def resolve_bliss_centroid(type: str, value: str) -> list[float]:
    if type == "track":
        return get_track_bliss_vector(value)
    if type == "album":
        vectors = get_album_track_vectors(value)
        return centroid(vectors)
    if type == "artist":
        vectors = get_artist_top_track_vectors(value, limit=20)
        return centroid(vectors)
    if type == "genre":
        vectors = get_genre_representative_vectors(value, limit=30)
        return centroid(vectors)
```

### 2. Build waypoint chain

If the user added waypoints, the path is segmented:

```
origin → waypoint_1 → waypoint_2 → ... → destination
```

Each segment gets `step_count / num_segments` steps.

### 3. Interpolate and search

For each step within a segment:

```python
progress = step_index / segment_steps  # 0.0 → 1.0
target_vector = lerp(segment_start, segment_end, progress)

# Find nearest track to target_vector, excluding already-used tracks
track = nearest_neighbor(
    target_vector,
    exclude=used_track_ids,
    limit=1,
)
used_track_ids.add(track.id)
```

The `nearest_neighbor` query uses PostgreSQL's existing vector distance:

```sql
SELECT id, storage_id, title, artist, album,
       bliss_vector <-> :target AS distance
FROM library_tracks
WHERE bliss_vector IS NOT NULL
  AND id NOT IN :exclude
ORDER BY bliss_vector <-> :target
LIMIT 1
```

### 4. Optional: weighted search with genre affinity

For better transitions, weight the distance by genre proximity:

```python
# Boost tracks that share genres with the current segment's endpoints
effective_distance = bliss_distance * (1 + genre_penalty)
```

This prevents wild genre jumps even if a track is acoustically close.

## API Endpoints

```
POST   /api/paths                    Create + compute a path
GET    /api/paths                    List user's paths
GET    /api/paths/:id               Get path with tracks
PATCH  /api/paths/:id               Update waypoints, recompute
DELETE /api/paths/:id               Delete path
POST   /api/paths/:id/regenerate    Recompute with fresh tracks
POST   /api/paths/preview           Preview without saving (returns tracks)
```

### POST /api/paths request

```json
{
  "name": "NYHC → Crank Wave",
  "origin": { "type": "genre", "value": "nyhc" },
  "destination": { "type": "genre", "value": "crank-wave" },
  "waypoints": [
    { "type": "genre", "value": "post-hardcore" }
  ],
  "step_count": 20
}
```

### Response

```json
{
  "id": 42,
  "name": "NYHC → Crank Wave",
  "origin": { "type": "genre", "value": "nyhc", "label": "NY Hardcore" },
  "destination": { "type": "genre", "value": "crank-wave", "label": "Crank Wave" },
  "waypoints": [...],
  "step_count": 20,
  "tracks": [
    {
      "step": 0,
      "progress": 0.0,
      "track_id": 1234,
      "title": "Don't Forget to Breathe",
      "artist": "Madball",
      "album": "Set It Off",
      "genre": "nyhc",
      "distance": 0.0
    },
    ...
  ]
}
```

## UI (Listen App)

### Creation flow

1. User taps "New Path" from explore or library
2. Picks origin (search for genre/artist/album/track)
3. Picks destination
4. Optional: add waypoints
5. Preview generates a path (POST /api/paths/preview)
6. User can save, play, or adjust

### Playback

- Path renders as a playlist with a visual route indicator
- Current track highlighted on the path
- Can convert to regular playlist or re-generate

### Admin App

- Path management (list, delete, stats)
- System-generated paths as discovery features (e.g. "Weekly path: Jazz → Metal")

## Implementation Phases

### Phase 1 — Backend core

- Alembic migration for `music_paths` table
- `resolve_bliss_centroid()` for all 4 types
- `compute_path()` with lerp + nearest-neighbor
- POST /api/paths and GET /api/paths/:id endpoints
- POST /api/paths/preview for stateless preview

### Phase 2 — Listen UI

- "New Path" entry point in explore
- Origin/destination picker (reuse existing search)
- Path preview with route visualization
- Playback integration (path as queue source)

### Phase 3 — Waypoints

- Waypoint UI (add/remove/reorder)
- Segmented path computation
- Genre affinity weighting

### Phase 4 — Polish

- Regeneration with track exclusion
- Sharing (paths as shareable entities)
- Admin management UI
- System-generated discovery paths

## Risks

- **Sparse library regions**: If the user's library doesn't cover the
  acoustic space between origin and destination, transitions will jump.
  Mitigation: show a "coverage warning" when path density is low.

- **Linear interpolation**: lerp in bliss space may not follow natural
  musical transitions. Alternative: A* over a precomputed similarity
  graph. Start with lerp, measure quality, upgrade if needed.

- **Performance**: nearest-neighbor scan on 48K tracks per step ×20
  steps = 960K distance comparisons. PostgreSQL handles this fine
  without an index; pgvector could add ANN if needed later.
