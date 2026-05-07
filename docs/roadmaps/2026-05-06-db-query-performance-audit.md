# Crate — Database Query Performance Audit

Date: 2026-05-06

Consolidated findings from full codebase analysis. Ordered by severity.

---

## 🔴 P0 — System-Killing Under Load

### P0.1 — Home Discovery: 21-33 queries en cascada por carga fría

**Archivos:**
- `app/crate/db/home_personalized_discovery.py:113-168`
- `app/crate/db/home_context.py:43-77`
- `app/crate/db/home_builder_mix_generation.py:27-119`
- `app/crate/db/home_builder_curated_lists.py:75-104`
- `app/crate/db/home_builder_discovery_queries.py:14-36`

**Problema:** `build_home_discovery_payload()` dispara 21-33 queries para 12 secciones. Cada query abre su propio `read_scope()`. Varias tocan `library_tracks` (48K). Con 10 usuarios concurrentes en cold cache = 200-330 queries simultáneas, PostgreSQL al suelo.

**Desglose por sección:**
| Sección | Queries |
|---------|---------|
| `get_home_context` | 6 |
| `get_home_hero` + genres map | 2 |
| Custom mixes (daily + arrivals + hasta 6 genre) | 2-8 |
| Recommended tracks | 1 |
| Core playlists (1 query × hasta 7 artistas) | 1-7 |
| Recently played (history + artwork) | 2 |
| Recent global artists | 1 |
| Home upcoming (followed artists ×2 + releases + shows + attendance + user) | 5 |
| Replay mix | 1 |

**Fix:**
1. Consolidar `get_home_context` en un solo CTE (actualmente 6 queries)
2. Eliminar la segunda llamada a `get_followed_artists` en `_build_home_upcoming` — reusar contexto ya cargado
3. Batchear `_build_core_playlists` con `WHERE art.id = ANY(:artist_ids)` + `ROW_NUMBER() OVER (PARTITION BY art.id)`
4. Pre-warmear snapshot desde el projector daemon cada 10 min para evitar cold misses

---

### P0.2 — `get_analysis_status()`: 3 full scans de `library_tracks` en cada snapshot de admin

**Archivo:** `app/crate/db/jobs/analysis_status.py:13-154`

**Problema:** Llamada en cada rebuild del ops snapshot (cada 15s por admin viewer). Ejecuta:
1. `COUNT(*) FROM library_tracks` — full scan 48K
2. `GROUP BY pipeline, state FROM track_processing_state`
3. Fallback masivo: `LEFT JOIN library_tracks + track_analysis_features + NOT EXISTS` — 48K rows
4. Segundo fallback: `LEFT JOIN library_tracks + track_bliss_embeddings + NOT EXISTS` — 48K rows

144K filas escaneadas cada 15s por admin. Con 3 admins = 432K filas/minuto solo de esta función.

**Fix:** Mover el cómputo al daemon de análisis. El daemon ya sabe cuántos tracks ha analizado — que persista los contadores en `ops_runtime_state`. El snapshot builder solo lee de ahí. Nunca disparar esta query durante un request HTTP.

---

### P0.3 — 5 queries de distribución escanean `library_tracks` secuencialmente en cada snapshot

**Archivos:**
- `app/crate/db/queries/analytics_overview_distributions.py:8-23` — genre distribution
- `app/crate/db/queries/analytics_overview_distributions.py:41-46` — format distribution
- `app/crate/db/queries/analytics_overview_distributions.py:49-69` — bitrate distribution
- `app/crate/db/queries/analytics_overview_distributions.py:72-77` — sizes by format
- `app/crate/db/queries/analytics_overview_distributions.py:26-38` — decade distribution (albums)

**Problema:** 5 full scans + hash aggregate consecutivos. 48K × 4 + 4.4K = ~196K filas por snapshot. En disco lento, 1-3 segundos solo de I/O.

**Fix:** Consolidar en una sola query con subconsultas:
```sql
SELECT 'genre' AS kind, genre AS label, COUNT(*) AS cnt
FROM library_tracks WHERE genre IS NOT NULL GROUP BY genre
UNION ALL
SELECT 'format', format, COUNT(*) FROM library_tracks WHERE format IS NOT NULL GROUP BY format
UNION ALL ...
```
Un solo scan de `library_tracks` en vez de 4.

---

### P0.4 — `jsonb_each` + `CROSS JOIN LATERAL` sobre 48K tracks en analytics

**Archivo:** `app/crate/db/queries/analytics_audio_feature_queries.py:42-69`

**Problema:** `get_insights_mood_distribution()` expande `mood_json` de cada track vía lateral join. 100K-250K filas intermedias antes del GROUP BY. Disparada en cada carga de `/api/insights`.

**Fix:**
1. Materializar `track_moods(track_id, mood, score)` como tabla separada, actualizada por el pipeline de análisis
2. Short-term: añadir `WHERE bpm IS NOT NULL` para reducir el scan

---

### P0.5 — Home context: 6 queries separadas que deberían ser 1

**Archivo:** `app/crate/db/home_context.py:43-77`

**Problema:** `get_home_context()` dispara secuencialmente: followed_artists, saved_albums, top_artists(90d), top_albums(90d), top_genres(90d), genre_fallback. Todas comparten ventana de 90 días pero son 6 round-trips independientes.

**Fix:** Una sola query con CTEs que devuelva el contexto completo:
```sql
WITH followed AS (...), saved AS (...), top_artists AS (...), top_albums AS (...), top_genres AS (...)
SELECT ... FROM followed, saved, top_artists, top_albums, top_genres
```

---

## 🟠 P1 — Degradación Significativa

### P1.1 — `get_overview_stat_summary()` llamada 2× por snapshot

**Archivos:**
- `app/crate/db/ops_snapshot_stats.py:35` — build_stats
- `app/crate/db/ops_snapshot_stats.py:73` — build_analytics

**Problema:** `SUM(duration)` + `AVG(bitrate)` + `COUNT(bpm)` sobre 48K tracks, ejecutado dos veces en el mismo snapshot. La segunda llamada solo usa 2 campos del resultado.

**Fix:** Computar una vez y pasar a los builders como parámetro.

---

### P1.2 — `get_latest_scan()` llamada 3×, `count_import_queue_items()` llamada 3× por snapshot

**Archivos:**
- `app/crate/db/ops_snapshot_stats.py:31-33`
- `app/crate/db/ops_snapshot_activity.py:88-123`

**Problema:** 4 round-trips redundantes por snapshot.

**Fix:** Reestructurar `build_ops_snapshot_payload()` para computar resultados compartidos una vez:
```python
scan = get_latest_scan()
imports = count_import_queue_items(status="pending")
worker_live = get_worker_live_state()
# Pasar a todos los builders
```

---

### P1.3 — 8 COUNT queries secuenciales para mood presets

**Archivo:** `app/crate/api/browse_media.py:1202-1215`

**Problema:** Itera 8 presets con `SELECT COUNT(*) FROM library_tracks WHERE energy >= X AND danceability >= Y`. 8 full scans de 48K = 384K filas escaneadas.

**Fix:** Un solo scan con `COUNT(*) FILTER (WHERE ...)`:
```sql
SELECT
    COUNT(*) FILTER (WHERE energy >= 0.7 AND danceability >= 0.5) AS energetic,
    COUNT(*) FILTER (WHERE energy <= 0.4 AND valence >= 0.3) AS chill,
    ...  -- 8 presets
FROM library_tracks WHERE bpm IS NOT NULL
```

---

### P1.4 — Core playlists: N+1 queries por artista

**Archivo:** `app/crate/db/home_builder_curated_lists.py:75-104`

**Query real:** `app/crate/db/queries/home_track_artist_core.py:6-49`

**Problema:** Para cada uno de los top 7 artistas, dispara una query a `library_tracks JOIN library_albums JOIN library_artists` con su propio `read_scope()`. Hasta 7 queries separadas, cada una con `ORDER BY COALESCE(t.lastfm_playcount, 0) DESC`.

**Fix:**
```sql
SELECT * FROM (
    SELECT t.*, ROW_NUMBER() OVER (PARTITION BY art.id ORDER BY COALESCE(t.lastfm_playcount, 0) DESC) AS rn
    FROM library_tracks t
    JOIN library_albums alb ON alb.id = t.album_id
    JOIN library_artists art ON art.name = t.artist
    WHERE art.id = ANY(:artist_ids)
) ranked WHERE rn <= :track_limit
```

---

### P1.5 — 5 streams SSE con refrescos independientes = 52+ queries/min por admin

| Stream | Intervalo | Queries/refresh | Queries/min |
|--------|-----------|-----------------|-------------|
| ops-stream | 15s | 22-30 | 4 |
| tasks-stream | 10s | 2-3 | 12-18 |
| health-stream | 10s | 2 | 12 |
| logs-stream | 5s | 2 | 24 |
| stack-stream | 30s | 0 (Docker API) | 0 |

**Total:** 52-58 queries/min por admin. Con 3 admins = 150-174 queries/min. Varias sobre `library_tracks` (48K).

**Fix:**
1. Aumentar TTLs: ops 15s→60s, logs 5s→15s
2. Unificar señales de refresco en un solo canal Redis en vez de 5 independientes
3. Ops snapshot no necesita refresco cada 15s — 60s es suficiente para un dashboard

---

### P1.6 — `get_top_genres()` y `get_stats_top_genres()`: GROUP BY sobre 48K tracks

**Archivos:**
- `app/crate/db/queries/analytics_overview_stats.py:111-123` — top genres
- `app/crate/db/queries/analytics_overview_distributions.py:8-23` — genre distribution (duplicado)

**Problema:** Ambas hacen `GROUP BY genre FROM library_tracks`. La distribución de géneros ya se computa en `get_genre_distribution()` — `get_top_genres()` es redundante.

**Fix:** Derivar top genres del resultado de `get_genre_distribution()` en Python (ordenar y tomar top 10). Eliminar la query separada.

---

## 🟡 P2 — Ineficiencias Acumulativas

### P2.1 — `read_scope()` vs `transaction_scope()` mal usado

**Archivos:**
- `app/crate/db/worker_logs.py:56-88` — `query_logs()` usa `transaction_scope()` para SELECT
- `app/crate/db/health.py:35-57` — `get_open_issues()` usa `transaction_scope()` para SELECT
- `app/crate/db/health.py:51-57` — `get_issue_counts()` usa `transaction_scope()` para SELECT
- Múltiples queries en `db/queries/` usan `transaction_scope()` para lecturas puras

**Problema:** `transaction_scope()` inicia transacción writable. Para lecturas puras, `read_scope()` evita write-locks y contención en el WAL. Los logs-stream y health-stream adquieren transacciones writable cada 5-10s sin necesidad.

**Fix:** Cambiar a `read_scope()` en todas las funciones de solo lectura.

---

### P2.2 — Cada función `get_*` abre su propio `read_scope()`

**Patrón ubicuo** en `app/crate/db/queries/`

**Problema:** Para el home discovery, son 20-30 aperturas/cierres de scope. Cada uno negocia una conexión del pool. Overhead acumulativo significativo.

**Fix:** Pasar `session` como parámetro opcional. Un request HTTP debería usar un request-scoped session que agrupe todas las queries.

---

### P2.3 — Search usa ILIKE sin trigram en `library_tracks` (48K)

**Archivo:** `app/crate/api/browse_media.py:116-193`

**Problema:** `search_tracks(like, capped_limit)` ejecuta `ILIKE '%term%'` sobre 48K tracks. Sin índice GIN trigram, es un full scan. Peor con términos cortos (<3 caracteres).

**Fix:** Añadir columna `tsvector` con GIN index, o verificar que los índices trigram existentes (migration 010) se están usando.

---

### P2.4 — `get_all_artist_genre_map()` sin LIMIT ni filtro

**Archivo:** `app/crate/db/queries/browse_artist_genres.py:103-116`

**Problema:** `SELECT ... FROM artist_genres JOIN genres ORDER BY weight DESC` sin LIMIT. 2700+ filas ordenadas sin índice óptimo.

**Fix:** `WHERE ag.artist_name = ANY(:names)` limitado a los artistas de la página actual.

---

### P2.5 — `LOWER()` en JOINs de releases deshabilita índices

**Archivo:** `app/crate/db/releases.py:50-92`

**Problema:** `LEFT JOIN library_artists la ON LOWER(la.name) = LOWER(nr.artist_name)`. El `LOWER()` en la condición de JOIN impide usar cualquier índice btree.

**Fix:** Índices funcionales: `CREATE INDEX idx_la_name_lower ON library_artists (LOWER(name))`.

---

### P2.6 — `get_artist_all_tracks()` sin LIMIT

**Archivo:** `app/crate/api/browse_artist.py:364`

**Problema:** Artista con 500+ tracks → carga todos para matchear contra 100 tracks de Last.fm y tomar 20. Over-fetch masivo.

**Fix:** Mover LIMIT a la query SQL y ordenar por `lastfm_playcount DESC`.

---

### P2.7 — `get_replay_mix()` over-fetching con `bliss_vector`

**Archivo:** `app/crate/db/queries/user_library_stats_tops.py:144-186`

**Problema:** Pide 240 tracks con `bliss_vector` (20 floats), filtra en Python a 30. Serialización innecesaria de vectores.

**Fix:** Mover la lógica `max 4 per artist` a SQL con `ROW_NUMBER() OVER (PARTITION BY artist ORDER BY play_count DESC)`.

---

### P2.8 — Album detail: dos queries a `album_genres` para mismo `album_id`

**Archivo:** `app/crate/api/browse_album.py:233-234`

**Problema:** `get_album_genres_list()` y `get_album_genre_profile()` consultan la misma tabla para el mismo álbum. La segunda añade columnas extra pero la base es idéntica.

**Fix:** Una sola query que devuelva todo. Derivar la lista plana del resultado enriquecido.

---

### P2.9 — `get_timeline_albums()` sin LIMIT (4.4K álbumes)

**Archivo:** `app/crate/db/queries/analytics_overview_timeline.py:8-31`

**Problema:** `SELECT ... FROM library_albums ... ORDER BY year` sin LIMIT. 4.4K filas con JOIN a artists.

**Fix:** Agrupar por año en SQL con `COUNT(*)` y devolver solo agregados, o cachear.

---

### P2.10 — `COUNT(*)` de albums y tracks en queries separadas

**Archivo:** `app/crate/db/queries/analytics_overview_stats.py:92-96`

**Problema:** Dos round-trips para conteos que nunca cambian entre requests.

**Fix:** Un solo query con CTE o usar `pg_stat_user_tables.n_live_tup` para approximate counts.

---

### P2.11 — Play history: query principal + fallback separado

**Archivo:** `app/crate/db/queries/user_library_history.py:137-181`

**Problema:** `get_play_history_rows` + fallback `resolve_play_history_album_fallback` para tracks sin `album_id`.

**Fix:** Unificar en una sola query con COALESCE o LEFT JOIN adicional.

---

### P2.12 — `jsonb->>'artist'` en GROUP BY de health issues

**Archivo:** `app/crate/db/health.py:183-193`

**Problema:** `GROUP BY details_json->>'artist'` fuerza scan completo de `health_issues` con extracción JSONB por fila.

**Fix:** Extraer a columna dedicada `artist_name` con índice, o añadir índice GIN `jsonb_path_ops`.

---

### P2.13 — `get_discovery_track_rows`: 2 queries separadas

**Archivo:** `app/crate/db/queries/home_track_discovery.py:9-80`

**Problema:** Primero busca artistas por género (`artist_genres JOIN genres LIMIT 200`), luego busca tracks de esos artistas (`library_tracks WHERE artist = ANY(:artists)`).

**Fix:** Unificar en una sola query con subquery o CTE.

---

### P2.14 — `get_library_stats()`: GROUP BY format redundante

**Archivo:** `app/crate/db/repositories/library_stats_reads.py:55-83`

**Problema:** El `GROUP BY format FROM library_tracks` es redundante con `get_format_distribution()` que ya se llama en el snapshot.

**Fix:** Eliminar el GROUP BY de `get_library_stats()` — solo necesita los 4 COUNTs simples.

---

## 🟢 P3 — Quick Wins (minutos de trabajo)

| # | Qué | Archivo | Fix |
|---|-----|---------|-----|
| Q1 | `query_logs()` usa `transaction_scope()` | `worker_logs.py:56` | Cambiar a `read_scope()` |
| Q2 | `get_open_issues()` usa `transaction_scope()` | `health.py:35` | Cambiar a `read_scope()` |
| Q3 | `get_issue_counts()` usa `transaction_scope()` | `health.py:51` | Cambiar a `read_scope()` |
| Q4 | Aumentar TTL de logs-stream | `admin_logs_surface.py:9` | 5s → 15s |
| Q5 | Aumentar TTL de ops snapshot | `ops_snapshot.py:15` | 15s → 60s |
| Q6 | Aumentar TTL de tasks-stream | `admin_tasks_surface.py:15` | 10s → 30s |
| Q7 | Aumentar TTL de health-stream | `admin_health_surface.py:13` | 10s → 30s |
| Q8 | Eliminar duplicado `get_latest_scan()` en `build_recent_activity` | `ops_snapshot_activity.py:90` | Pasar como parámetro |
| Q9 | Eliminar duplicado `count_import_queue_items()` en `build_recent_activity` | `ops_snapshot_activity.py:102` | Pasar como parámetro |
| Q10 | Eliminar duplicado `get_overview_stat_summary()` en `build_analytics` | `ops_snapshot_stats.py:73` | Pasar como parámetro |

---

## 📊 Resumen

| Severidad | Count | Queries/request afectadas | Filas escaneadas |
|-----------|-------|--------------------------|-----------------|
| P0 | 5 | 30-50 | 500K+ |
| P1 | 6 | 10-20 | 300K+ |
| P2 | 14 | 2-5 | variable |
| P3 | 10 | 1-2 | mínimo |

**Causa raíz:** El ops snapshot y el home discovery son los dos grandes agujeros negros. El primero dispara 22-30 queries cada 15s por admin con múltiples full scans de 48K tracks. El segundo dispara 21-33 queries por carga fría de home. Entre los dos, con 3 admins y 10 usuarios concurrentes, PostgreSQL recibe cientos de queries por minuto, muchas de ellas escaneando tablas enteras.

**Principio de arreglo:** Todo lo que sea COUNT/SUM/AVG/GROUP BY sobre `library_tracks` debe pre-computarse incrementalmente (en el worker, al insertar/analizar) o consolidarse en queries compuestas. Nunca disparar agregaciones sobre 48K filas durante un request HTTP.
