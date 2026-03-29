# Radio y Curated Playlists - Diseño

**Fecha**: 2026-03-29
**Estado**: Aprobado para implementación

## Resumen

Implementación de dos funcionalidades principales:
1. **Radio basada en Bliss**: Stream infinito de música similar usando similitud coseno en bliss vectors
2. **Curated Playlists**: Playlists predefinidas (mood/genre/fresh) que usuarios pueden seguir, estilo Spotify/Tidal

---

## 1. Radio basada en Bliss

### Propósito

Generar un stream infinito de música similar basado en la pista actual o tracks semilla, usando los 20-float bliss vectors almacenados en `library_tracks.bliss_vector`.

### Backend

#### API: `/api/bliss/similar/{track_path}` (nuevo archivo `app/crate/api/bliss.py`)

```python
GET /api/bliss/similar/{track_path}?limit=10&threshold=0.7
```

- Retorna tracks similares al track especificado
- Calcula similitud coseno: `dot(a,b) / (norm(a) * norm(b))`
- Filtra tracks con `bliss_vector IS NOT NULL`
- Excluye track semilla
- Ordena por similitud descendente
- Limita a N tracks (default: 10, threshold: 0.7)

#### API: `/api/bliss/similar/playlist/{playlist_id}` (opcional futuro)

- Calcula vector promedio de tracks en playlist
- Busca tracks similares al blend

#### PlayerContext Extensiones

Nuevo estado en `src/contexts/PlayerContext.tsx`:

```tsx
interface RadioState {
  active: boolean;
  seedTracks: Track[];
  threshold: number;
  autoAddThreshold: number; // añadir cuando queue < este valor
}

const [radio, setRadio] = useState<RadioState>({
  active: false,
  seedTracks: [],
  threshold: 0.7,
  autoAddThreshold: 2,
});
```

Nuevas acciones:

```tsx
const startRadio = useCallback((track: Track) => {
  setRadio({
    active: true,
    seedTracks: [track],
    threshold: 0.7,
    autoAddThreshold: 2,
  });
  play(track, { type: "radio", name: "Radio" });
  fetchRadioSuggestions([track.id]);
}, []);

const stopRadio = useCallback(() => {
  setRadio({
    active: false,
    seedTracks: [],
    threshold: 0.7,
    autoAddThreshold: 2,
  });
}, []);

const fetchRadioSuggestions = useCallback(async (excludeIds: string[]) => {
  if (!radio.active) return;
  
  try {
    const tracks = await api<Track[]>(`/api/bliss/similar/${radio.seedTracks[0]?.id}`, undefined, {
      limit: 10,
      threshold: radio.threshold,
    });
    
    tracks.forEach(t => addToQueue(t));
  } catch (e) {
    console.warn("Failed to fetch radio suggestions", e);
  }
}, [radio.active, radio.seedTracks, radio.threshold, addToQueue]);
```

#### Auto-Add Logic

Effect que monitorea queue length:

```tsx
useEffect(() => {
  if (!radio.active) return;
  
  if (queue.length < radio.autoAddThreshold) {
    const excludeIds = queue.slice(0, currentIndex).map(t => t.id);
    fetchRadioSuggestions(excludeIds);
  }
}, [queue.length, currentIndex, radio.active, radio.autoAddThreshold, fetchRadioSuggestions]);
```

### Frontend UI

#### PlayerBar (`src/components/player/PlayerBar.tsx`)
- Indicador "Radio: [seed track]" cuando `radio.active`
- Botón "Stop Radio" en menú del player (únicamente cuando radio está activa)

#### Context Menu (tracks, albums, artists)
- Nuevo item "Start Radio" que llama `startRadio(track)`

### Data Flow

1. Usuario hace clic en "Start Radio" en un track
2. PlayerContext activa radio, reproduce track semilla
3. Effect detecta queue.length < 2
4. Fetch suggestions desde `/api/bliss/similar/{track_path}`
5. Tracks añadidos al queue con `addToQueue()`
6. Loop:每当 queue baja de umbral, fetch más tracks

---

## 2. Curated Playlists

### Propósito

Playlists predefinidas (curated) que los usuarios pueden seguir, con categorías por mood/genre/freshness, similares a las "Featured" playlists de Spotify/Tidal.

### Backend

#### Schema DB

**Nueva tabla `curated_playlists`**:

```sql
CREATE TABLE curated_playlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,  -- 'mood', 'genre', 'fresh'
  type TEXT NOT NULL,      -- 'high_energy', 'chill', 'rock', 'electronic', 'top_50', etc
  is_active BOOLEAN DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Nueva tabla `user_followed_playlists`**:

```sql
CREATE TABLE user_followed_playlists (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  playlist_id INTEGER REFERENCES curated_playlists(id) ON DELETE CASCADE,
  followed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, playlist_id)
);
```

**Extensiones a tabla existente `playlists`**:

- Añadir columna: `curated_id INTEGER REFERENCES curated_playlists(id)`
- Smart playlists con `user_id = NULL` indican que son curated (públicas)

#### API Endpoints (Admin - crate-ui)

```
GET    /api/admin/curated-playlists    Listar todas (admin-only)
POST   /api/admin/curated-playlists    Crear nueva (admin-only)
PUT    /api/admin/curated-playlists/:id Actualizar nombre/descripción/activo (admin-only)
DELETE /api/admin/curated-playlists/:id Eliminar (admin-only)
POST   /api/admin/curated-playlists/:id/regenerate Regenerar tracks (admin-only)
POST   /api/admin/curated-playlists/:id/activate Activar (admin-only)
POST   /api/admin/curated-playlists/:id/deactivate Desactivar (admin-only)
```

#### API Endpoints (Listen - app/listen)

```
GET    /api/curated-playlists             Listar activas (públicas)
GET    /api/curated-playlists/:category   Listar por categoría (mood|genre|fresh)
POST   /api/curated-playlists/:id/follow  Seguir playlist
DELETE /api/curated-playlists/:id/follow  Dejar de seguir
GET    /api/me/followed-playlists         Playlists seguidas por usuario
GET    /api/curated-playlists/:id/tracks  Tracks (reutiliza endpoint playlists)
```

#### Task Handler: `regenerate_curated_playlist`

```python
def _handle_regenerate_curated_playlist(task_id, params, config):
    curated_id = params["curated_id"]

    # Obtener curated_playlist y su smart playlist asociada
    with get_db_ctx() as cur:
        cur.execute("SELECT * FROM curated_playlists WHERE id = %s", (curated_id,))
        curated = cur.fetchone()

        cur.execute("""
            SELECT * FROM playlists 
            WHERE curated_id = %s AND is_smart = TRUE
        """, (curated_id,))
        playlist = cur.fetchone()

    if not playlist:
        return {"error": "Associated smart playlist not found"}

    # Ejecutar reglas y generar tracks
    rules = playlist["smart_rules_json"]
    tracks = _execute_smart_rules(rules)

    # Reemplazar tracks en playlist_tracks
    with get_db_ctx() as cur:
        cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s", (playlist["id"],))

    if tracks:
        add_playlist_tracks(playlist["id"], tracks)

    # Actualizar metadata
    with get_db_ctx() as cur:
        cur.execute("""
            UPDATE playlists
            SET updated_at = %s, track_count = %s, total_duration = %s
            WHERE id = %s
        """, (datetime.now().isoformat(), len(tracks),
              sum(t["duration"] for t in tracks), playlist["id"]))

    # Programar recálculo en 6 horas
    create_task("regenerate_curated_playlist", {"curated_id": curated_id}, delay=6*3600)

    return {"track_count": len(tracks)}
```

#### Reglas Smart para Curated

Las smart playlists existentes se extienden con Bliss similarity:

```python
elif field == "bliss_similarity" and op == "gt":
    seed_path = rule.get("seed_track_path") or rule.get("value")
    if seed_path:
        from crate.db import get_track_by_path
        seed_track = get_track_by_path(seed_path)
        if seed_track and seed_track.get("bliss_vector"):
            # Filtrado post-query con NumPy
            bliss_rules.append((seed_path, value))
```

Post-filtrado:

```python
def filter_by_bliss(tracks: list, seed_path: str, threshold: float) -> list:
    from crate.db import get_track_by_path
    import numpy as np
    seed = get_track_by_path(seed_path)
    if not seed or not seed.get("bliss_vector"):
        return []
    seed_vec = np.array(seed["bliss_vector"])

    filtered = []
    for t in tracks:
        if not t.get("bliss_vector"):
            continue
        vec = np.array(t["bliss_vector"])
        similarity = np.dot(seed_vec, vec) / (np.linalg.norm(seed_vec) * np.linalg.norm(vec))
        if similarity >= threshold:
            filtered.append(t)
    return filtered
```

### Frontend - Admin (crate-ui)

#### Nueva página: CuratedPlaylists (`app/ui/src/pages/CuratedPlaylists.tsx`)

**Sections**:

1. **Active Curated Playlists**
   - Grid de cards con gradientes por categoría
   - Botones: Regenerate, Deactivate, Edit, Delete

2. **Templates**
   - Lista de pre-built playlists:
     - **Moods**: High Energy, Chill, Focus, Party, Sleep, Workout
     - **Genres**: Rock, Metal, Electronic, Hip-Hop, Indie, Jazz
     - **Fresh**: Top 50 2025, New Releases, Trending
   - Botón "Activate" crea curated playlist y genera tracks
   - Botón "Deactivate" marca is_active = FALSE

3. **Create Curated**
   - Formulario simple:
     - Nombre
     - Descripción
     - Category: mood | genre | fresh
     - Type: (dropdown basado en category)

### Frontend - Listen (app/listen)

#### Home (`src/pages/Home.tsx`)
- Nueva sección "Featured Playlists" encima de Recently Played
- 4-6 cards horizontales de curated destacadas
- Cards con gradientes por categoría:
  - Mood: cian/azul (chill), rojo/naranja (high energy)
  - Genre: colores variados
  - Fresh: dorado/verde
- Badge "Followed" si usuario la sigue

#### Nueva página Explore (`src/pages/Explore.tsx`)
- Tabs: "Moods", "Genres", "Fresh"
- Grid de curated playlists activas por categoría
- Card con:
  - Gradient background
  - Nombre, descripción
  - Botón Follow/Play
  - Badge "Followed" si está seguida

#### Library (`src/pages/Library.tsx`)
- Nueva sección "Followed Playlists"
- Lista de curated playlists seguidas
- Botón Unfollow en cada card
- Mismo estilo que "Your Playlists"

#### Follow/Unfollow
```tsx
async function toggleFollow(curatedId: number) {
  const followed = followedIds.includes(curatedId);
  
  if (followed) {
    await api(`/api/curated-playlists/${curatedId}/follow`, "DELETE");
    setFollowedIds(prev => prev.filter(id => id !== curatedId));
    toast.success("Removed from library");
  } else {
    await api(`/api/curated-playlists/${curatedId}/follow`, "POST");
    setFollowedIds(prev => [...prev, curatedId]);
    toast.success("Added to library");
  }
}
```

---

## 3. Playlists Normales (Usuario)

### Propósito

Gestión de playlists personales del usuario (no smart) en app/listen.

### Backend

Reutilizar APIs existentes sin cambios:
- `POST /api/playlists` con `is_smart: false` (default)
- `GET /api/playlists` - filtrar por `user_id` (ya implementado)
- `GET /api/playlists/{id}/tracks` - tracks normales
- `POST /api/playlists/{id}/tracks` - añadir tracks
- `DELETE /api/playlists/{id}/tracks/{position}` - eliminar track
- `PUT /api/playlists/{id}` - editar nombre/descripción
- `DELETE /api/playlists/{id}` - eliminar playlist

### Frontend - Listen

#### Create Playlist Modal

```tsx
interface CreatePlaylist {
  name: string;
  description?: string;
  tracks?: Track[]; // opcional, crear con tracks preseleccionados
}
```

- Botón "Create Playlist" en Library
- Modal con:
  - Input: nombre (required)
  - Input: descripción (optional)
  - Checkbox: "Add current queue" (optional)
  - Botón Create

#### Añadir Tracks - Método 1: Drag & Drop

- Tracks arrastrables desde cualquier vista (Library, Album, Artist)
- Drop zone en sidebar (Library → playlists list)
- Drop en playlist card específica para añadir directamente
- Visual feedback durante drag

#### Añadir Tracks - Método 2: Context Menu

Click derecho en track/album/artist → menú con:
- "Add to playlist" → submenu con lista de playlists del usuario
- "Add to new playlist" → abre modal de creación

#### Manage Playlist - Playlist Page

Página existente (`src/pages/Playlist.tsx`) con:
- Header:
  - Cover (gradient)
  - Nombre, descripción
  - Botón Play
  - Botón Delete (solo del usuario)
  - Botón Edit (nombre/descripción)
- Track list:
  - Drag & drop para reorder
  - Click derecho en track → Remove
  - Botón "Add tracks" para añadir más

#### Library Reorganization

```
Library Page:
  ├─ Your Playlists (normales del usuario)
  │   ├─ Create Playlist
  │   └─ Lista de playlists con actions
  └─ Followed Playlists (curated que sigue)
      └─ Lista de curated con unfollow button
```

---

## Arquitectura de Implementación

### Fase 1: Backend Core
1. Schema migrations: `curated_playlists`, `user_followed_playlists`, columnas nuevas
2. API: `/api/bliss/similar/{track_path}` (NumPy, cosine similarity)
3. API: `/api/admin/curated-playlists/*` (CRUD, activate/deactivate)
4. API: `/api/curated-playlists/*` (listen: list, follow/unfollow, tracks)
5. Task handler: `regenerate_curated_playlist`

### Fase 2: Backend Extensions
1. Extender `_execute_smart_rules` con Bliss similarity
2. Implementar `filter_by_bliss` con NumPy post-filtrado
3. Testing de similitud coseno con bliss vectors reales

### Fase 3: Admin UI (crate-ui)
1. Nueva página `CuratedPlaylists.tsx`
2. Templates con presets (moods, genres, fresh)
3. Create/Activate/Deactivate flow
4. Test de generación de playlists

### Fase 4: Listen UI - Core
1. PlayerContext: Radio state, startRadio/stopRadio, auto-add effect
2. `/api/bliss/similar` integration
3. PlayerBar: Radio indicator, stop button
4. Context menu: "Start Radio" action

### Fase 5: Listen UI - Curated Playlists
1. Home: Featured Playlists section
2. Nueva página Explore.tsx con tabs
3. Library: Followed Playlists section
4. Follow/Unfollow actions con optimistic UI

### Fase 6: Listen UI - User Playlists
1. Create Playlist modal
2. Drag & drop implementation
3. Context menu integration
4. Playlist page enhancements

---

## Decisiones Técnicas

### Bliss Similarity
- **Backend**: NumPy para cálculo eficiente de cosine distance
- **Threshold**: 0.7 default, configurable
- **Auto-add**: Queue threshold de 2 tracks, batch de 10

### Curated Playlists
- **Storage**: Tabla separada `curated_playlists` + vinculación a smart playlists
- **Visibility**: `user_id = NULL` en playlists indica pública
- **Cache**: Recálculo cada 6 horas vía task scheduler

### Follow System
- **Simplicity**: Follow simple (sin remix), tracks se recalculan server-side
- **Storage**: Tabla `user_followed_playlists` para optimizar queries

### Drag & Drop
- **Library**: HTML5 Drag and Drop API
- **Fallback**: Context menu como alternativa siempre disponible

---

## Métricas de Éxito

- **Radio**: Al menos 10 tracks similares por semilla con threshold 0.7
- **Curated Playlists**: Recálculo < 5s para playlists de 50 tracks
- **Follow**: < 100ms para toggle follow/unfollow
- **User Playlists**: Drag & drop < 50ms latency, reorder smooth
