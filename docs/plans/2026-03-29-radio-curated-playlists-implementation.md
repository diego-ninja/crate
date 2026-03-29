# Radio and Curated Playlists Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement radio based on Bliss similarity and curated playlists system (mood/genre/fresh) with follow/unfollow capabilities for end users.

**Architecture:** 
- **Radio**: Bliss similarity API with NumPy cosine distance, PlayerContext state for auto-add queue management, UI integration in PlayerBar and context menus
- **Curated Playlists**: New tables `curated_playlists` and `user_followed_playlists`, smart playlists with `user_id=NULL` for public visibility, admin CRUD + listen follow/unfollow endpoints
- **User Playlists**: Reuse existing APIs with drag & drop + context menu for track management

**Tech Stack:**
- Backend: Python 3.12, FastAPI, NumPy (bliss similarity), PostgreSQL (psycopg2)
- Frontend Admin: React 19 + TypeScript + shadcn/ui (crate-ui)
- Frontend Listen: React 19 + TypeScript + Tailwind CSS 4 (app/listen)
- Task System: ThreadPoolExecutor with `create_task()` for async playlist regeneration

---

## Phase 1: Backend Core - Bliss Similarity API

### Task 1.1: Create Bliss API module

**Files:**
- Create: `app/crate/api/bliss.py`

**Step 1: Create the module file with router**

```python
from fastapi import APIRouter, Request
from crate.api.auth import _require_auth
from crate.db import get_db_ctx, get_track_by_path
import numpy as np

router = APIRouter(prefix="/api/bliss", tags=["bliss"])

@router.get("/similar/{track_path}")
def get_similar(request: Request, track_path: str, limit: int = 10, threshold: float = 0.7):
    """Get tracks similar to given track using bliss vectors."""
    _require_auth(request)
    
    seed = get_track_by_path(track_path)
    if not seed or not seed.get("bliss_vector"):
        return []
    
    seed_vec = np.array(seed["bliss_vector"])
    
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT path, title, artist, album, bliss_vector 
            FROM library_tracks 
            WHERE bliss_vector IS NOT NULL 
            AND path != %s
        """, (track_path,))
        tracks = cur.fetchall()
    
    similar = []
    for t in tracks:
        if not t["bliss_vector"]:
            continue
        vec = np.array(t["bliss_vector"])
        similarity = np.dot(seed_vec, vec) / (np.linalg.norm(seed_vec) * np.linalg.norm(vec))
        if similarity >= threshold:
            similar.append({**t, "similarity": float(similarity)})
    
    similar.sort(key=lambda x: x["similarity"], reverse=True)
    return similar[:limit]
```

**Step 2: Register router in API**

File: `app/crate/api/__init__.py`

Add at the end of the file:

```python
from crate.api import bliss as bliss_api
app.include_router(bliss_api.router)
```

**Step 3: Test the endpoint manually**

Run: `curl http://localhost:8585/api/bliss/similar/some/track/path.flac?limit=5&threshold=0.7`
Expected: JSON array of similar tracks with similarity score

**Step 4: Commit**

```bash
git add app/crate/api/bliss.py app/crate/api/__init__.py
git commit -m "feat(api): add bliss similarity endpoint"
```

---

### Task 1.2: Add get_track_by_path to db module

**Files:**
- Modify: `app/crate/db/core.py`

**Step 1: Find where playlist_tracks functions are defined**

Search for: `def add_playlist_tracks` in `app/crate/db/core.py`

**Step 2: Add get_track_by_path function after add_playlist_tracks**

```python
def get_track_by_path(path: str) -> dict | None:
    """Get a single track by path, including bliss vector."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT path, title, artist, album, bliss_vector 
            FROM library_tracks 
            WHERE path = %s
        """, (path,))
        row = cur.fetchone()
    return dict(row) if row else None
```

**Step 3: Test the function manually**

Run: `python3 -c "from crate.db import get_track_by_path; print(get_track_by_path('some/track/path.flac'))"`
Expected: Track dict or None

**Step 4: Commit**

```bash
git add app/crate/db/core.py
git commit -m "feat(db): add get_track_by_path helper"
```

---

## Phase 2: Backend - Curated Playlists Schema

### Task 2.1: Create curated_playlists table migration

**Files:**
- Modify: `app/crate/db/core.py` (in `init_db()` function)

**Step 1: Find init_db function and locate playlists table creation**

Search for: `CREATE TABLE IF NOT EXISTS playlists` in `app/crate/db/core.py`

**Step 2: Add curated_playlists table after playlist_tracks table**

```python
cur.execute("""
    CREATE TABLE IF NOT EXISTS curated_playlists (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL CHECK (category IN ('mood', 'genre', 'fresh')),
        type TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TEXT NOT NULL DEFAULT datetime.datetime.now().isoformat(),
        updated_at TEXT NOT NULL DEFAULT datetime.datetime.now().isoformat()
    )
""")
```

**Step 3: Run migration manually**

Run: `python3 -c "from crate.db import init_db; init_db()"`
Expected: No errors, table created

**Step 4: Verify table exists**

Run: `psql -U crate -d crate -c "\d curated_playlists"`
Expected: Table schema displayed

**Step 5: Commit**

```bash
git add app/crate/db/core.py
git commit -m "feat(db): add curated_playlists table"
```

---

### Task 2.2: Add curated_id to playlists table

**Files:**
- Modify: `app/crate/db/core.py`

**Step 1: Find playlists table creation**

Search for: `CREATE TABLE IF NOT EXISTS playlists` in `app/crate/db/core.py`

**Step 2: Add curated_id column after smart_rules_json**

```python
cur.execute("""
    ALTER TABLE playlists 
    ADD COLUMN IF NOT EXISTS curated_id INTEGER REFERENCES curated_playlists(id)
""")
```

**Step 3: Run migration manually**

Run: `python3 -c "from crate.db import init_db; init_db()"`
Expected: No errors, column added

**Step 4: Verify column exists**

Run: `psql -U crate -d crate -c "\d playlists"`
Expected: curated_id column shown

**Step 5: Commit**

```bash
git add app/crate/db/core.py
git commit -m "feat(db): add curated_id to playlists"
```

---

### Task 2.3: Create user_followed_playlists table

**Files:**
- Modify: `app/crate/db/core.py`

**Step 1: Add table after curated_playlists**

```python
cur.execute("""
    CREATE TABLE IF NOT EXISTS user_followed_playlists (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        playlist_id INTEGER REFERENCES curated_playlists(id) ON DELETE CASCADE,
        followed_at TEXT NOT NULL DEFAULT datetime.datetime.now().isoformat(),
        PRIMARY KEY (user_id, playlist_id)
    )
""")
```

**Step 2: Create index for performance**

```python
cur.execute("CREATE INDEX IF NOT EXISTS idx_user_followed ON user_followed_playlists(user_id)")
```

**Step 3: Run migration manually**

Run: `python3 -c "from crate.db import init_db; init_db()"`
Expected: No errors, table created

**Step 4: Verify table exists**

Run: `psql -U crate -d crate -c "\d user_followed_playlists"`
Expected: Table schema displayed

**Step 5: Commit**

```bash
git add app/crate/db/core.py
git commit -m "feat(db): add user_followed_playlists table"
```

---

## Phase 3: Backend - Curated Playlists Admin APIs

### Task 3.1: Create curated playlists API module

**Files:**
- Create: `app/crate/api/curated_playlists.py`

**Step 1: Create the module with router and basic CRUD**

```python
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from crate.api.auth import _require_admin, _require_auth
from crate.db import get_db_ctx, create_task

router = APIRouter(prefix="/api/admin/curated-playlists", tags=["admin"])

class CreateCuratedRequest(BaseModel):
    name: str
    description: str = ""
    category: str  # mood, genre, fresh
    type: str

class UpdateCuratedRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None

@router.get("")
def list_curated(request: Request):
    _require_admin(request)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id, name, description, category, type, is_active, 
                   created_at, updated_at 
            FROM curated_playlists 
            ORDER BY created_at DESC
        """)
        return cur.fetchall()

@router.post("")
def create_curated(request: Request, body: CreateCuratedRequest):
    _require_admin(request)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Name required")
    if body.category not in ["mood", "genre", "fresh"]:
        raise HTTPException(status_code=422, detail="Invalid category")
    
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO curated_playlists (name, description, category, type)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (body.name.strip(), body.description, body.category, body.type))
        row = cur.fetchone()
    
    return {"id": row["id"]}

@router.get("/{curated_id}")
def get_curated(request: Request, curated_id: int):
    _require_admin(request)
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT * FROM curated_playlists WHERE id = %s
        """, (curated_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row

@router.put("/{curated_id}")
def update_curated(request: Request, curated_id: int, body: UpdateCuratedRequest):
    _require_admin(request)
    updates = []
    params = []
    
    if body.name is not None:
        updates.append("name = %s")
        params.append(body.name.strip())
    if body.description is not None:
        updates.append("description = %s")
        params.append(body.description)
    if body.is_active is not None:
        updates.append("is_active = %s")
        params.append(body.is_active)
    
    if not updates:
        return {"ok": True}
    
    params.append(curated_id)
    
    with get_db_ctx() as cur:
        cur.execute(f"""
            UPDATE curated_playlists 
            SET {', '.join(updates)}, updated_at = datetime.datetime.now().isoformat()
            WHERE id = %s
        """, params)
    
    return {"ok": True}

@router.delete("/{curated_id}")
def delete_curated(request: Request, curated_id: int):
    _require_admin(request)
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM curated_playlists WHERE id = %s", (curated_id,))
    return {"ok": True}

@router.post("/{curated_id}/activate")
def activate_curated(request: Request, curated_id: int):
    _require_admin(request)
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE curated_playlists 
            SET is_active = TRUE, updated_at = datetime.datetime.now().isoformat()
            WHERE id = %s
        """, (curated_id,))
    return {"ok": True}

@router.post("/{curated_id}/deactivate")
def deactivate_curated(request: Request, curated_id: int):
    _require_admin(request)
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE curated_playlists 
            SET is_active = FALSE, updated_at = datetime.datetime.now().isoformat()
            WHERE id = %s
        """, (curated_id,))
    return {"ok": True}

@router.post("/{curated_id}/regenerate")
def regenerate_curated(request: Request, curated_id: int):
    _require_admin(request)
    task_id = create_task("regenerate_curated_playlist", {"curated_id": curated_id})
    return {"task_id": task_id}
```

**Step 2: Register router in API**

File: `app/crate/api/__init__.py`

Add:
```python
from crate.api import curated_playlists as curated_api
app.include_router(curated_api.router)
```

**Step 3: Test list endpoint**

Run: `curl http://localhost:8585/api/admin/curated-playlists -H "Cookie: session=..." -v`
Expected: JSON array of curated playlists

**Step 4: Commit**

```bash
git add app/crate/api/curated_playlists.py app/crate/api/__init__.py
git commit -m "feat(api): add curated playlists admin endpoints"
```

---

### Task 3.2: Add curated playlists listener APIs

**Files:**
- Modify: `app/crate/api/curated_playlists.py`

**Step 1: Add public endpoints after admin routes**

```python
# Public endpoints for app/listen

@router.get("/public", prefix="/api/curated-playlists", tags=["curated"])
def list_public_curated():
    """List active curated playlists for all users."""
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id, name, description, category, type 
            FROM curated_playlists 
            WHERE is_active = TRUE
            ORDER BY category, name
        """)
        return cur.fetchall()

@router.get("/public/{category}", prefix="/api/curated-playlists", tags=["curated"])
def list_curated_by_category(category: str):
    """List active curated playlists by category."""
    if category not in ["mood", "genre", "fresh"]:
        raise HTTPException(status_code=422, detail="Invalid category")
    
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id, name, description, type 
            FROM curated_playlists 
            WHERE is_active = TRUE AND category = %s
            ORDER BY name
        """, (category,))
        return cur.fetchall()

@router.post("/{curated_id}/follow", prefix="/api/curated-playlists", tags=["curated"])
def follow_curated(request: Request, curated_id: int):
    """Follow a curated playlist."""
    user = _require_auth(request)
    
    # Verify curated playlist exists and is active
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id FROM curated_playlists 
            WHERE id = %s AND is_active = TRUE
        """, (curated_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Not found")
    
    # Add follow record (ignore if already follows)
    with get_db_ctx() as cur:
        cur.execute("""
            INSERT INTO user_followed_playlists (user_id, playlist_id)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
        """, (user["id"], curated_id))
    
    return {"ok": True}

@router.delete("/{curated_id}/follow", prefix="/api/curated-playlists", tags=["curated"])
def unfollow_curated(request: Request, curated_id: int):
    """Unfollow a curated playlist."""
    user = _require_auth(request)
    
    with get_db_ctx() as cur:
        cur.execute("""
            DELETE FROM user_followed_playlists 
            WHERE user_id = %s AND playlist_id = %s
        """, (user["id"], curated_id))
    
    return {"ok": True}

@router.get("/me/followed", prefix="/api/curated-playlists", tags=["curated"])
def list_followed(request: Request):
    """List curated playlists followed by current user."""
    user = _require_auth(request)
    
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT cp.id, cp.name, cp.description, cp.category, cp.type, ufp.followed_at
            FROM user_followed_playlists ufp
            JOIN curated_playlists cp ON ufp.playlist_id = cp.id
            WHERE ufp.user_id = %s AND cp.is_active = TRUE
            ORDER BY ufp.followed_at DESC
        """, (user["id"],))
        return cur.fetchall()
```

**Step 2: Register public router separately**

File: `app/crate/api/__init__.py`

Add after admin router:
```python
# Public curated playlists endpoints (for app/listen)
app.include_router(curated_api.router, prefix="/api/curated-playlists")
```

**Step 3: Test public list endpoint**

Run: `curl http://localhost:8585/api/curated-playlists/public -v`
Expected: JSON array of active curated playlists

**Step 4: Commit**

```bash
git add app/crate/api/curated_playlists.py app/crate/api/__init__.py
git commit -m "feat(api): add curated playlists public endpoints"
```

---

## Phase 4: Backend - Task Handler

### Task 4.1: Add regenerate_curated_playlist task handler

**Files:**
- Modify: `app/crate/worker.py`

**Step 1: Find TASK_HANDLERS dict**

Search for: `TASK_HANDLERS = {` in `app/crate/worker.py`

**Step 2: Import necessary functions**

Add at top of worker.py after existing imports:
```python
from crate.api.playlists import _execute_smart_rules
from crate.db import get_db_ctx, add_playlist_tracks
```

**Step 3: Add handler function before TASK_HANDLERS**

```python
def _handle_regenerate_curated_playlist(task_id: str, params: dict, config: dict) -> dict:
    """Regenerate tracks for a curated playlist based on its smart rules."""
    from crate.db import update_task, get_playlist
    
    curated_id = params.get("curated_id")
    if not curated_id:
        return {"error": "curated_id required"}
    
    update_task(task_id, json.dumps({"phase": "fetching", "done": 0, "total": 3}))
    
    # Get curated playlist and associated smart playlist
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT * FROM curated_playlists WHERE id = %s
        """, (curated_id,))
        curated = cur.fetchone()
        
        if not curated:
            return {"error": "Curated playlist not found"}
        
        cur.execute("""
            SELECT * FROM playlists 
            WHERE curated_id = %s AND is_smart = TRUE
        """, (curated_id,))
        playlist = cur.fetchone()
    
    if not playlist:
        return {"error": "Associated smart playlist not found"}
    
    update_task(task_id, json.dumps({"phase": "generating", "done": 1, "total": 3}))
    
    # Execute smart rules
    rules = playlist["smart_rules_json"]
    tracks = _execute_smart_rules(rules)
    
    update_task(task_id, json.dumps({"phase": "updating", "done": 2, "total": 3}))
    
    # Replace tracks in playlist_tracks
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s", (playlist["id"],))
    
    if tracks:
        add_playlist_tracks(playlist["id"], tracks)
    
    # Update playlist metadata
    total_duration = sum(t.get("duration", 0) for t in tracks)
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE playlists
            SET updated_at = %s, track_count = %s, total_duration = %s
            WHERE id = %s
        """, (
            datetime.datetime.now().isoformat(),
            len(tracks),
            total_duration,
            playlist["id"]
        ))
    
    update_task(task_id, json.dumps({"phase": "complete", "done": 3, "total": 3}))
    
    # Schedule next regeneration in 6 hours
    create_task("regenerate_curated_playlist", {"curated_id": curated_id}, delay=6*3600)
    
    return {"track_count": len(tracks)}
```

**Step 4: Register handler in TASK_HANDLERS**

Add to TASK_HANDLERS dict:
```python
"regenerate_curated_playlist": _handle_regenerate_curated_playlist,
```

**Step 5: Restart worker to load new handler**

Run: `docker-compose restart crate-worker`
Expected: Worker restarts without errors

**Step 6: Commit**

```bash
git add app/crate/worker.py
git commit -m "feat(worker): add regenerate_curated_playlist handler"
```

---

## Phase 5: Backend - Smart Rules Extension

### Task 5.1: Add bliss similarity to smart rules

**Files:**
- Modify: `app/crate/api/playlists.py`

**Step 1: Find _execute_smart_rules function**

Search for: `def _execute_smart_rules` in `app/crate/api/playlists.py`

**Step 2: Add bliss_similarity case in rule loop**

Find the `for rule in rule_list:` loop and add this case:

```python
elif field == "bliss_similarity" and op == "gt":
    seed_path = rule.get("seed_track_path") or rule.get("value")
    if seed_path:
        from crate.db import get_track_by_path
        seed_track = get_track_by_path(seed_path)
        if seed_track and seed_track.get("bliss_vector"):
            # Store for post-filtering with NumPy
            bliss_rules.append((seed_path, value))
```

Add this before the loop (initialize list):
```python
bliss_rules = []  # Will store (seed_path, threshold) for post-filtering
```

**Step 3: Add post-filtering after SQL query**

Find the line: `return [dict(r) for r in rows]` and replace with:

```python
    # Apply Bliss similarity post-filtering if any bliss rules
    if bliss_rules and rows:
        import numpy as np
        from crate.db import get_track_by_path
        
        filtered_rows = []
        for row in rows:
            row_dict = dict(row)
            keep_row = True
            
            for seed_path, threshold in bliss_rules:
                seed_track = get_track_by_path(seed_path)
                if not seed_track or not seed_track.get("bliss_vector"):
                    keep_row = False
                    break
                
                if not row_dict.get("bliss_vector"):
                    keep_row = False
                    break
                
                seed_vec = np.array(seed_track["bliss_vector"])
                row_vec = np.array(row_dict["bliss_vector"])
                similarity = np.dot(seed_vec, row_vec) / (
                    np.linalg.norm(seed_vec) * np.linalg.norm(row_vec)
                )
                
                if similarity < float(threshold):
                    keep_row = False
                    break
            
            if keep_row:
                filtered_rows.append(row_dict)
        
        return filtered_rows
    
    return [dict(r) for r in rows]
```

**Step 4: Commit**

```bash
git add app/crate/api/playlists.py
git commit -m "feat(playlists): add bliss similarity to smart rules"
```

---

## Phase 6: Frontend Listen - PlayerContext Radio

### Task 6.1: Add radio state to PlayerContext

**Files:**
- Modify: `app/listen/src/contexts/PlayerContext.tsx`

**Step 1: Add RadioState interface after PlaySource interface**

```tsx
export interface RadioState {
  active: boolean;
  seedTracks: Track[];
  threshold: number;
  autoAddThreshold: number;
}
```

**Step 2: Add radio state to PlayerActionsValue interface**

Add to PlayerActionsValue interface:
```tsx
radio: RadioState;
startRadio: (track: Track) => void;
stopRadio: () => void;
fetchRadioSuggestions: (excludeIds: string[]) => Promise<void>;
```

**Step 3: Add radio state initialization**

Find: `const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);`
Add after:
```tsx
const [radio, setRadio] = useState<RadioState>({
  active: false,
  seedTracks: [],
  threshold: 0.7,
  autoAddThreshold: 2,
});
```

**Step 4: Add radio to actionsValue useMemo**

Find actionsValue useMemo and add to it:
```tsx
const actionsValue = useMemo<PlayerActionsValue>(
  () => ({
    // ... existing actions ...
    radio,
    startRadio,
    stopRadio,
    fetchRadioSuggestions,
  }),
  [
    // ... existing dependencies ...
    radio, startRadio, stopRadio, fetchRadioSuggestions,
  ],
);
```

**Step 5: Commit**

```bash
git add app/listen/src/contexts/PlayerContext.tsx
git commit -m "feat(player): add radio state to context"
```

---

### Task 6.2: Implement startRadio function

**Files:**
- Modify: `app/listen/src/contexts/PlayerContext.tsx`

**Step 1: Find reorderQueue function and add startRadio after it**

```tsx
const startRadio = useCallback((track: Track) => {
  // Warm up AudioContext
  try {
    const w = window as unknown as Record<string, AudioContext>;
    if (!w.__crateAudioCtx) w.__crateAudioCtx = new AudioContext();
    if (w.__crateAudioCtx.state === "suspended") w.__crateAudioCtx.resume();
  } catch { /* ok */ }
  
  setRadio({
    active: true,
    seedTracks: [track],
    threshold: 0.7,
    autoAddThreshold: 2,
  });
  
  play(track, { type: "radio", name: "Radio" });
}, [play]);
```

**Step 2: Commit**

```bash
git add app/listen/src/contexts/PlayerContext.tsx
git commit -m "feat(player): implement startRadio"
```

---

### Task 6.3: Implement stopRadio function

**Files:**
- Modify: `app/listen/src/contexts/PlayerContext.tsx`

**Step 1: Add stopRadio after startRadio**

```tsx
const stopRadio = useCallback(() => {
  setRadio({
    active: false,
    seedTracks: [],
    threshold: 0.7,
    autoAddThreshold: 2,
  });
}, []);
```

**Step 2: Commit**

```bash
git add app/listen/src/contexts/PlayerContext.tsx
git commit -m "feat(player): implement stopRadio"
```

---

### Task 6.4: Implement fetchRadioSuggestions function

**Files:**
- Modify: `app/listen/src/contexts/PlayerContext.tsx`

**Step 1: Add fetchRadioSuggestions after stopRadio**

```tsx
const fetchRadioSuggestions = useCallback(async (excludeIds: string[] = []) => {
  if (!radio.active || radio.seedTracks.length === 0) return;
  
  const seedTrack = radio.seedTracks[0];
  if (!seedTrack) return;
  
  try {
    const tracks = await api<Track[]>(`/api/bliss/similar/${encodeURIComponent(seedTrack.id)}`, undefined, {
      limit: 10,
      threshold: radio.threshold,
    });
    
    tracks.forEach(t => {
      if (!queue.some(q => q.id === t.id)) {
        addToQueue(t);
      }
    });
  } catch (e) {
    console.warn("Failed to fetch radio suggestions", e);
  }
}, [radio.active, radio.seedTracks, radio.threshold, queue, addToQueue]);
```

**Step 2: Commit**

```bash
git add app/listen/src/contexts/PlayerContext.tsx
git commit -m "feat(player): implement fetchRadioSuggestions"
```

---

### Task 6.5: Add auto-add effect for radio

**Files:**
- Modify: `app/listen/src/contexts/PlayerContext.tsx`

**Step 1: Find the audio event listeners useEffect and add radio auto-add effect after it**

```tsx
// Radio auto-add effect
useEffect(() => {
  if (!radio.active) return;
  
  // Add suggestions when queue is below threshold
  if (queue.length < radio.autoAddThreshold) {
    const excludeIds = queue.slice(0, currentIndex).map(t => t.id);
    fetchRadioSuggestions(excludeIds);
  }
}, [queue.length, currentIndex, radio.active, radio.autoAddThreshold, fetchRadioSuggestions]);
```

**Step 2: Commit**

```bash
git add app/listen/src/contexts/PlayerContext.tsx
git commit -m "feat(player): add radio auto-add effect"
```

---

## Phase 7: Frontend Listen - Radio UI

### Task 7.1: Add start radio to context menu

**Files:**
- Modify: `app/listen/src/components/player/PlayerBar.tsx`

**Step 1: Find the context menu options array in PlayerBar**

Search for: `{ icon: Radio, label: "Go to track radio", action: ... }`

**Step 2: Replace the placeholder with actual start radio action**

```tsx
{ icon: Radio, label: "Go to track radio", action: () => {
  const { startRadio } = usePlayerActions();
  startRadio(currentTrack);
  toast.success("Radio started");
}},
```

**Step 3: Import startRadio from context**

Add to imports:
```tsx
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
```

**Step 4: Test manually**

Open app, play a track, right-click menu, select "Go to track radio"
Expected: Radio starts, tracks added to queue

**Step 5: Commit**

```bash
git add app/listen/src/components/player/PlayerBar.tsx
git commit -m "feat(player): add start radio to context menu"
```

---

### Task 7.2: Add radio indicator to PlayerBar

**Files:**
- Modify: `app/listen/src/components/player/PlayerBar.tsx`

**Step 1: Add radio state to player hook**

Find: `const { currentTime, duration, isPlaying, volume } = usePlayer();`
Replace with:
```tsx
const { currentTime, duration, isPlaying, volume } = usePlayer();
const { currentTrack, shuffle, repeat, playSource, queue, currentIndex, radio, stopRadio } = usePlayerActions();
```

**Step 2: Find playSource display and add radio indicator after it**

Search for: `<p className="text-[10px] text-white/30 truncate leading-tight mt-0.5">Playing from: {playSource.name}</p>`
Replace with:
```tsx
{playSource && (
  <p className="text-[10px] text-white/30 truncate leading-tight mt-0.5">
    {radio.active ? `Radio: ${radio.seedTracks[0]?.title || "Radio"}` : `Playing from: ${playSource.name}`}
  </p>
)}
```

**Step 3: Add stop radio button to action buttons**

Find the action buttons section (after volume) and add before extended player button:
```tsx
{radio.active && (
  <button
    onClick={stopRadio}
    className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-primary"
    title="Stop Radio"
  >
    <Radio size={16} />
  </button>
)}
```

**Step 4: Commit**

```bash
git add app/listen/src/components/player/PlayerBar.tsx
git commit -m "feat(player): add radio indicator and stop button"
```

---

## Phase 8: Frontend Listen - Curated Playlists UI

### Task 8.1: Create Explore page

**Files:**
- Create: `app/listen/src/pages/Explore.tsx`

**Step 1: Create the page component**

```tsx
import { useState, useEffect } from "react";
import { useApi } from "@/hooks/use-api";
import { Music, Radio, TrendingUp } from "lucide-react";

interface CuratedPlaylist {
  id: number;
  name: string;
  description: string;
  category: "mood" | "genre" | "fresh";
  type: string;
}

const CATEGORIES = [
  { key: "mood", label: "Moods", icon: Music },
  { key: "genre", label: "Genres", icon: Radio },
  { key: "fresh", label: "Fresh", icon: TrendingUp },
];

function categoryGradient(category: string): string {
  switch (category) {
    case "mood": return "linear-gradient(135deg, rgba(6,182,212,0.3), rgba(59,130,246,0.1))";
    case "genre": return "linear-gradient(135deg, rgba(239,68,68,0.3), rgba(217,70,239,0.1))";
    case "fresh": return "linear-gradient(135deg, rgba(234,179,8,0.3), rgba(34,197,94,0.1))";
    default: return "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))";
  }
}

export function Explore() {
  const [activeCategory, setActiveCategory] = useState<"mood" | "genre" | "fresh">("mood");
  const { data: playlists, loading } = useApi<CuratedPlaylist[]>(`/api/curated-playlists/public/${activeCategory}`);

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="text-2xl font-bold">Explore</h1>

      {/* Category Tabs */}
      <div className="flex gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key as any)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeCategory === cat.key
                ? "bg-primary text-primary-foreground"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            <cat.icon size={18} className="inline mr-2" />
            {cat.label}
          </button>
        ))}
      </div>

      {/* Playlists Grid */}
      {loading ? (
        <div className="text-center py-12 text-white/50">Loading...</div>
      ) : playlists && playlists.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              className="rounded-xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer group"
              style={{ background: categoryGradient(pl.category) }}
            >
              <div className="aspect-square flex flex-col justify-end p-4">
                <h3 className="font-bold text-lg text-white">{pl.name}</h3>
                <p className="text-sm text-white/70 mt-1">{pl.description}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-white/50">No playlists found</div>
      )}
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

File: `app/listen/src/App.tsx`

Find: `<Route path="shows" element={<Shows />} />`
Add after:
```tsx
<Route path="explore" element={<Explore />} />
```

**Step 3: Test manually**

Navigate to /explore, click tabs, see playlists
Expected: Playlists display correctly with category colors

**Step 4: Commit**

```bash
git add app/listen/src/pages/Explore.tsx app/listen/src/App.tsx
git commit -m "feat(listen): add Explore page"
```

---

### Task 8.2: Add Featured Playlists to Home

**Files:**
- Modify: `app/listen/src/pages/Home.tsx`

**Step 1: Add curated playlists state and fetch**

Find: `const { data: playlists, loading: playlistsLoading } = useApi<Playlist[]>("/api/playlists");`
Add after:
```tsx
const { data: featuredPlaylists, loading: featuredLoading } =
  useApi<{ id: number; name: string; description: string; category: string }[]>("/api/curated-playlists/public");
```

**Step 2: Add Featured Playlists section before Recently Played**

Add this section:
```tsx
{/* Featured Playlists */}
{featuredLoading ? (
  <div className="space-y-3">
    <h2 className="text-lg font-bold px-1">Featured Playlists</h2>
    <SectionLoading />
  </div>
) : featuredPlaylists && featuredPlaylists.length > 0 ? (
  <Section title="Featured Playlists">
    {featuredPlaylists.slice(0, 6).map((pl) => (
      <button
        key={pl.id}
        className="flex-shrink-0 w-[160px] rounded-xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98]"
        style={{ background: categoryGradient(pl.category) }}
      >
        <div className="aspect-square flex flex-col justify-end p-3">
          <ListMusic size={24} className="text-white/40 mb-2" />
          <div className="text-sm font-bold text-white truncate">{pl.name}</div>
          <div className="text-xs text-white/50">{pl.description}</div>
        </div>
      </button>
    ))}
  </Section>
) : null}
```

Add helper function after playlistGradient:
```tsx
function categoryGradient(category: string): string {
  switch (category) {
    case "mood": return "linear-gradient(135deg, rgba(6,182,212,0.3), rgba(59,130,246,0.1))";
    case "genre": return "linear-gradient(135deg, rgba(239,68,68,0.3), rgba(217,70,239,0.1))";
    case "fresh": return "linear-gradient(135deg, rgba(234,179,8,0.3), rgba(34,197,94,0.1))";
    default: return "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))";
  }
}
```

**Step 3: Commit**

```bash
git add app/listen/src/pages/Home.tsx
git commit -m "feat(listen): add Featured Playlists to Home"
```

---

### Task 8.3: Add Followed Playlists to Library

**Files:**
- Modify: `app/listen/src/pages/Library.tsx`

**Step 1: Read current Library page to understand structure**

Run: `cat app/listen/src/pages/Library.tsx`
Expected: See current implementation

**Step 2: Add followed playlists state and fetch**

Find where playlists are fetched and add:
```tsx
const { data: followedPlaylists, loading: followedLoading } =
  useApi<{ id: number; name: string; description: string; category: string; followed_at: string }[]>("/api/curated-playlists/me/followed");
```

**Step 3: Add Followed Playlists section**

Add this section after Your Playlists section:
```tsx
{/* Followed Playlists */}
{followedLoading ? (
  <div className="space-y-3">
    <h2 className="text-lg font-bold px-1">Followed Playlists</h2>
    <div className="flex items-center justify-center py-8">
      <Loader2 size={20} className="text-primary animate-spin" />
    </div>
  </div>
) : followedPlaylists && followedPlaylists.length > 0 ? (
  <Section title="Followed Playlists">
    {followedPlaylists.map((pl) => (
      <div
        key={pl.id}
        className="flex-shrink-0 w-[160px] rounded-xl overflow-hidden transition-transform hover:scale-[1.02] active:scale-[0.98] relative group"
        style={{ background: categoryGradient(pl.category) }}
      >
        <button className="aspect-square flex flex-col justify-end p-3 w-full">
          <ListMusic size={24} className="text-white/40 mb-2" />
          <div className="text-sm font-bold text-white truncate">{pl.name}</div>
          <div className="text-xs text-white/50">{pl.description}</div>
        </button>
        <button
          onClick={() => handleUnfollow(pl.id)}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          title="Unfollow"
        >
          <X size={14} className="text-white" />
        </button>
      </div>
    ))}
  </Section>
) : null}
```

Add unfollow handler:
```tsx
async function handleUnfollow(curatedId: number) {
  try {
    await api(`/api/curated-playlists/${curatedId}/follow`, "DELETE");
    toast.success("Removed from library");
    // Refetch followed playlists
    window.location.reload();
  } catch (e) {
    toast.error("Failed to unfollow");
  }
}
```

Add categoryGradient function if not exists (same as in Home.tsx)

**Step 4: Commit**

```bash
git add app/listen/src/pages/Library.tsx
git commit -m "feat(listen): add Followed Playlists to Library"
```

---

## Phase 9: Frontend Admin - Curated Playlists

### Task 9.1: Create CuratedPlaylists admin page

**Files:**
- Create: `app/ui/src/pages/CuratedPlaylists.tsx`

**Step 1: Create the admin page component**

```tsx
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Sparkles, Loader2, RefreshCw, Power } from "lucide-react";
import { toast } from "sonner";

interface CuratedPlaylist {
  id: number;
  name: string;
  description: string;
  category: "mood" | "genre" | "fresh";
  type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const TEMPLATES = [
  { category: "mood", type: "high_energy", name: "High Energy", description: "Energetic tracks for workouts" },
  { category: "mood", type: "chill", name: "Chill", description: "Relaxing tracks" },
  { category: "mood", type: "focus", name: "Focus", description: "Concentration-boosting music" },
  { category: "mood", type: "party", name: "Party", description: "Dance floor hits" },
  { category: "genre", type: "rock", name: "Rock Mix", description: "Best rock tracks" },
  { category: "genre", type: "electronic", name: "Electronic Mix", description: "Electronic bangers" },
  { category: "genre", type: "hip_hop", name: "Hip-Hop Mix", description: "Hip-hop classics" },
  { category: "fresh", type: "top_50", name: "Top 50 2025", description: "Most popular this year" },
  { category: "fresh", type: "new_releases", name: "New Releases", description: "Fresh tracks" },
  { category: "fresh", type: "trending", name: "Trending", description: "Rising tracks" },
];

export function CuratedPlaylists() {
  const [playlists, setPlaylists] = useState<CuratedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPlaylists = async () => {
    try {
      const data = await api<CuratedPlaylist[]>("/api/admin/curated-playlists");
      setPlaylists(data);
    } catch (e) {
      toast.error("Failed to load playlists");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlaylists(); }, []);

  async function handleRegenerate(id: number) {
    try {
      const { task_id } = await api<{ task_id: string }>(`/api/admin/curated-playlists/${id}/regenerate`, "POST");
      toast.success("Regenerating playlist...");
      // Poll task status
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            toast.success("Playlist regenerated");
            fetchPlaylists();
          } else if (task.status === "failed") {
            clearInterval(poll);
            toast.error("Regeneration failed");
          }
        } catch { /* polling */ }
      }, 2000);
    } catch (e) {
      toast.error("Failed to regenerate");
    }
  }

  async function handleToggleActive(id: number, active: boolean) {
    try {
      const endpoint = active ? "activate" : "deactivate";
      await api(`/api/admin/curated-playlists/${id}/${endpoint}`, "POST");
      toast.success(active ? "Playlist activated" : "Playlist deactivated");
      fetchPlaylists();
    } catch (e) {
      toast.error("Failed to update playlist");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this curated playlist?")) return;
    try {
      await api(`/api/admin/curated-playlists/${id}`, "DELETE");
      toast.success("Playlist deleted");
      fetchPlaylists();
    } catch (e) {
      toast.error("Failed to delete");
    }
  }

  async function activateTemplate(template: typeof TEMPLATES[0]) {
    try {
      await api("/api/admin/curated-playlists", "POST", {
        name: template.name,
        description: template.description,
        category: template.category,
        type: template.type,
      });
      toast.success(`Activated "${template.name}"`);
      fetchPlaylists();
    } catch (e) {
      toast.error("Failed to activate template");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Curated Playlists</h1>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus size={18} className="mr-2" />
          Create
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <Card className="p-4">
          <CreateForm onCreated={() => { setShowCreate(false); fetchPlaylists(); }} onCancel={() => setShowCreate(false)} />
        </Card>
      )}

      {/* Templates */}
      <div>
        <h2 className="text-lg font-bold mb-3">Templates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {TEMPLATES.map((tpl) => (
            <Card key={`${tpl.category}-${tpl.type}`} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold">{tpl.name}</h3>
                  <p className="text-sm text-muted-foreground">{tpl.description}</p>
                  <Badge variant="outline" className="mt-2">{tpl.category}</Badge>
                </div>
                <Button size="sm" onClick={() => activateTemplate(tpl)}>
                  Activate
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Active Playlists */}
      <div>
        <h2 className="text-lg font-bold mb-3">Active Playlists</h2>
        {playlists.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No curated playlists yet</div>
        ) : (
          <div className="space-y-2">
            {playlists.map((pl) => (
              <Card key={pl.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{pl.name}</h3>
                      <Badge variant={pl.is_active ? "default" : "secondary"}>
                        {pl.is_active ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{pl.category}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{pl.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleRegenerate(pl.id)}>
                      <RefreshCw size={14} className="mr-1" />
                      Regenerate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleToggleActive(pl.id, !pl.is_active)}>
                      <Power size={14} className="mr-1" />
                      {pl.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(pl.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"mood" | "genre" | "fresh">("mood");
  const [type, setType] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/admin/curated-playlists", "POST", {
        name: name.trim(),
        description,
        category,
        type: type || category,
      });
      onCreated();
    } catch (e) {
      toast.error("Failed to create playlist");
    } finally {
      setSaving(false);
    }
  }

  const typesForCategory = {
    mood: ["high_energy", "chill", "focus", "party", "sleep", "workout"],
    genre: ["rock", "metal", "electronic", "hip_hop", "indie", "jazz"],
    fresh: ["top_50", "new_releases", "trending"],
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        Create Curated Playlist
      </h3>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" />
        <div className="flex gap-3">
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value as any); setType(""); }}
            className="flex-1 px-3 py-2 rounded-md border bg-background"
          >
            <option value="mood">Mood</option>
            <option value="genre">Genre</option>
            <option value="fresh">Fresh</option>
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md border bg-background"
          >
            <option value="">Select type...</option>
            {typesForCategory[category]?.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
          Create
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

File: `app/ui/src/App.tsx`

Find routes and add:
```tsx
<Route path="curated-playlists" element={<CuratedPlaylists />} />
```

**Step 3: Test manually**

Navigate to /curated-playlists, create playlist, activate template
Expected: UI works, API calls succeed

**Step 4: Commit**

```bash
git add app/ui/src/pages/CuratedPlaylists.tsx app/ui/src/App.tsx
git commit -m "feat(admin): add Curated Playlists page"
```

---

## Summary

This implementation plan covers:
- **Phase 1-2**: Backend bliss similarity API and DB schema
- **Phase 3-5**: Admin curated playlists APIs, task handler, smart rules extension
- **Phase 6-7**: Listen frontend radio integration (PlayerContext + UI)
- **Phase 8**: Listen frontend curated playlists UI (Explore, Home, Library)
- **Phase 9**: Admin frontend curated playlists management

Total: **24 tasks** (each 2-5 minutes)
Estimated time: **2-3 hours** for complete implementation
