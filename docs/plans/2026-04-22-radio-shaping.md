# Radio with Live Shaping

**Date:** 2026-04-22
**Status:** Approved
**Scope:** Seeded radio, Discovery radio, Pandora-style like/dislike shaping

## Modes

### Seeded Radio
- User provides a seed (track, artist, album, genre)
- Computes outward from the seed using hybrid scoring (bliss + affinity + genres + shared members)
- No destination — infinite, generates more tracks on demand

### Discovery Radio
- No explicit seed — system picks based on user behavior
- Seed priority: recent likes centroid → followed artists → recent plays → instance trending
- Button appears only when enough data exists (5 likes OR 3 follows OR 20 plays)

### Live Shaping (all modes)
- Thumbs up: track vector blends into the session target, steering future picks toward that sound
- Thumbs down: track vector added to exclusion zone, penalizing acoustically similar tracks
- Session state lives in Redis (TTL 24h), ephemeral

## Data Model

Session state in Redis (key: `radio:session:{session_id}`):

```json
{
  "id": "uuid",
  "user_id": 1,
  "mode": "seeded",
  "seed_type": "artist",
  "seed_value": "7",
  "seed_label": "Converge",
  "initial_target": [0.26, -0.74, ...],
  "current_target": [0.28, -0.71, ...],
  "liked_vectors": [[...], [...]],
  "disliked_vectors": [[...], [...]],
  "used_track_ids": [123, 456, ...],
  "used_titles": ["converge::dark horse", ...],
  "recent_artists": ["Converge", "Trapped Under Ice"],
  "track_count": 15,
  "created_at": "2026-04-22T..."
}
```

## Algorithm

### Target computation

```
if liked_vectors:
    like_centroid = centroid(liked_vectors)
    target = lerp(initial_target, like_centroid, 0.4 * len(liked_vectors) / 10)
else:
    target = initial_target
```

The blend weight grows with the number of likes (capped at 40% influence).

### Dislike exclusion

```
for candidate in pool:
    for dv in disliked_vectors:
        if distance(candidate, dv) < 0.08:
            candidate.score *= 5.0  # heavy penalty
```

### Discovery seed resolution

```python
def resolve_discovery_seed(user_id):
    # 1. Recent likes (last 30 days)
    liked = get_recent_liked_tracks(user_id, limit=10)
    if len(liked) >= 5:
        return centroid(liked_bliss_vectors)

    # 2. Followed artists
    follows = get_followed_artists(user_id)
    if len(follows) >= 3:
        return centroid(top_tracks_of_followed(follows))

    # 3. Recent plays
    plays = get_recent_plays(user_id, limit=20)
    if len(plays) >= 10:
        return centroid(play_bliss_vectors)

    # 4. Instance trending (fallback)
    return centroid(most_played_tracks(limit=30))
```

## API

```
POST /api/radio/start
  { mode: "seeded"|"discovery", seed_type?, seed_value? }
  → { session_id, tracks: [...first 5...] }

POST /api/radio/next
  { session_id, count: 5 }
  → { tracks: [...next 5...] }

POST /api/radio/feedback
  { session_id, track_id, action: "like"|"dislike" }
  → { status: "ok" }

GET /api/radio/session/{session_id}
  → { session state summary }

DELETE /api/radio/session/{session_id}
  → { status: "ended" }
```

## UI

### Discovery Radio button
- In Shell sidebar/bottom nav or as a floating action
- Only visible when `hasEnoughData`
- Click → immediate playback, no configuration screen
- Subtle pulsing glow animation

### Player integration
- Like/dislike buttons in PlayerBar when radio is active
- Visual feedback: thumbs up turns primary, thumbs down dims the track
- Toast: "Radio shaped — more like this" / "Got it — less like this"
- Small "Radio" badge on the PlayerBar showing mode

### Radio page (/radio)
- Shows current session state
- History of liked/disliked tracks
- "Start new" button with optional seed picker

## Implementation phases

### Phase 1 — Backend
- Redis session management (start, store, retrieve, expire)
- Seeded radio: compute initial batch, serve next batches
- Reuse Music Paths hybrid scoring (bliss + affinity + genres + members)
- Feedback endpoint: update session target/exclusions

### Phase 2 — Discovery seed
- resolve_discovery_seed from likes/follows/plays/trending
- hasEnoughData check endpoint

### Phase 3 — Listen UI
- Like/dislike buttons in PlayerBar (radio mode only)
- Discovery Radio button in Shell
- Radio badge on player
- /radio page

### Phase 4 — Polish
- Fade-out disliked track (skip after 2s fade)
- Session resume on app reload
- "Why this track?" tooltip showing affinity signals
