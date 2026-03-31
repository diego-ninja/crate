# Radio, Smart Playlists y Curated Playlists - Plan de Implementación

**Fecha**: 2026-03-30
**Estado**: Revisado
**Objetivo**: implementar radio por track/album/artist y playlists globales del sistema gestionadas desde `admin`, consumidas desde `listen`

## Resumen Ejecutivo

Este plan implementa el diseño actualizado con cuatro reglas base:

- `admin` crea y mantiene playlists del sistema
- `listen` consume y sigue playlists del sistema
- `smart` describe generación
- `curated` describe publicación editorial

En este plan:

- los usuarios finales no crean smart playlists
- los usuarios finales no crean curated playlists
- el follow a playlists globales sí es por usuario
- la proyección a Navidrome se separa entre:
  - proyección global pública del sistema
  - proyección personal por usuario enlazado, si se ofrece

## Estado Actual Relevante

Ya existe base útil en el repo:

- playlists personales y smart playlists en `app/crate/api/playlists.py`
- capa DB de playlists en `app/crate/db/playlists.py`
- UI admin de playlists en `app/ui/src/pages/Playlists.tsx`
- UI de consumo en `app/listen/src/pages/Home.tsx`, `Library.tsx` y `Playlist.tsx`
- `artist radio` ya existe de forma parcial en `app/crate/api/browse_media.py`
- `listen` ya distingue `libraryTrackId`, `navidromeId` y `path`
- `listen` ya tiene estado de `user sync` con Navidrome
- Navidrome puede exponer playlists públicas/shared a clientes externos, así que las playlists globales del sistema necesitan una proyección pública aparte del `user sync`

Por tanto, la implementación debe extender lo existente, no abrir un sistema paralelo innecesario.

## Objetivos de Implementación

1. formalizar un modelo único de playlists del sistema
2. añadir follow/unfollow por usuario sobre playlists globales
3. exponer esas playlists en `listen`
4. unificar radio por track/album/artist
5. mantener `admin` como única superficie de creación/curación

## Modelo de Datos Recomendado

La implementación debe evolucionar la tabla `playlists` existente.

Campos nuevos recomendados:

- `scope TEXT NOT NULL DEFAULT 'user'`
  - valores: `user`, `system`
- `generation_mode TEXT NOT NULL DEFAULT 'static'`
  - valores: `static`, `smart`
- `is_curated BOOLEAN NOT NULL DEFAULT FALSE`
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`
- `managed_by_user_id INTEGER NULL REFERENCES users(id)`
- `curation_key TEXT NULL`
- `featured_rank INTEGER NULL`
- `category TEXT NULL`
  - valores orientativos: `mood`, `genre`, `fresh`, `editorial`, `scene`

Mantener:

- `user_id`
- `is_smart`
- `smart_rules_json`

Migración recomendada:

- no romper `is_smart` todavía
- mapear internamente:
  - `is_smart=true` -> `generation_mode='smart'`
  - `is_smart=false` -> `generation_mode='static'`
- usar los nuevos campos como contrato nuevo
- retirar `is_smart` más adelante si deja de aportar valor

Tabla nueva:

- `user_followed_playlists`
  - `user_id`
  - `playlist_id`
  - `followed_at`
  - PK `(user_id, playlist_id)`

Restricción lógica:

- solo se puede seguir una playlist con `scope='system'` y `is_curated=true`

## Fases

## Fase 1 - Normalizar modelo de playlists

### Objetivo

Distinguir correctamente:

- playlist personal
- smart interna del sistema
- curated estática
- curated smart

### Backend

Archivos principales:

- `app/crate/db/core.py`
- `app/crate/db/playlists.py`
- `app/crate/api/playlists.py`

Tareas:

- añadir columnas nuevas a `playlists`
- crear `user_followed_playlists`
- extender helpers DB para leer y escribir los nuevos campos
- mantener compatibilidad con la UI actual mientras hacemos la transición

Helpers DB a añadir:

- `get_playlist_followers_count(playlist_id)`
- `is_playlist_followed(user_id, playlist_id)`
- `follow_playlist(user_id, playlist_id)`
- `unfollow_playlist(user_id, playlist_id)`
- `get_followed_system_playlists(user_id)`
- `list_system_playlists(...)`

Resultado esperado:

- el backend ya puede representar playlists globales sin tablas editoriales paralelas

## Fase 2 - API de playlists del sistema

### Objetivo

Separar claramente la superficie `admin` de la superficie `listen`.

### Admin API

Se recomienda crear un router específico, por ejemplo:

- `app/crate/api/system_playlists.py`

Endpoints:

- `GET /api/admin/system-playlists`
- `POST /api/admin/system-playlists`
- `GET /api/admin/system-playlists/{id}`
- `PUT /api/admin/system-playlists/{id}`
- `DELETE /api/admin/system-playlists/{id}`
- `POST /api/admin/system-playlists/{id}/generate`
- `POST /api/admin/system-playlists/{id}/activate`
- `POST /api/admin/system-playlists/{id}/deactivate`

Validaciones importantes:

- solo admins
- creación de playlists del sistema siempre con `scope='system'`
- si `generation_mode='smart'`, validar `smart_rules`
- si `is_curated=true`, exigir metadata editorial mínima

### Listen API

Se recomienda exponer un router de consumo, por ejemplo:

- `app/crate/api/curation.py`

Endpoints:

- `GET /api/curation/playlists`
- `GET /api/curation/playlists/{id}`
- `GET /api/curation/playlists/category/{category}`
- `POST /api/curation/playlists/{id}/follow`
- `DELETE /api/curation/playlists/{id}/follow`
- `GET /api/me/followed-playlists`

Respuesta recomendada:

- metadata editorial
- follower state del usuario actual
- follower count
- artwork/cover
- flags de publicación

Resultado esperado:

- `listen` deja de depender de listar solo `/api/playlists` para descubrir contenido editorial

## Fase 3 - UI admin para playlists del sistema

### Objetivo

Que `admin` sea la única herramienta de creación y mantenimiento de smart/curated playlists.

Archivo base recomendado:

- `app/ui/src/pages/Playlists.tsx`

Dos caminos válidos:

- extender la página actual con secciones claras
- o crear una página nueva `SystemPlaylists.tsx`

Mi recomendación:

- separar visualmente `personal/user playlists` de `system playlists`
- mantener todo cerca si el equipo quiere menos dispersión

Capacidades necesarias:

- crear playlist del sistema estática
- crear playlist del sistema smart
- editar metadata editorial
- activar/desactivar
- regenerar
- ver track count
- ver follower count
- marcar destacadas

UI recomendada:

- filtros por `All`, `Curated`, `Smart`, `Inactive`
- badges claros:
  - `system`
  - `curated`
  - `smart`
  - `active/inactive`

## Fase 4 - Follow y descubrimiento en listen

### Objetivo

Consumir playlists del sistema en `listen` sin dar herramientas de curación.

Archivos principales:

- `app/listen/src/pages/Home.tsx`
- `app/listen/src/pages/Explore.tsx`
- `app/listen/src/pages/Library.tsx`
- `app/listen/src/pages/Playlist.tsx`

Tareas:

- añadir sección `Featured Playlists` en Home
- convertir Explore en superficie editorial real por categorías
- añadir `Followed Playlists` en Library
- marcar estado `followed`
- permitir `follow/unfollow`

Reglas UX:

- playlists personales y playlists seguidas no deben mezclarse sin etiqueta
- `Library` debe separar:
  - `Your Playlists`
  - `Followed Playlists`
- las acciones de edición/borrado solo se muestran para playlists del usuario
- las acciones de follow/share/play se muestran para playlists del sistema

Resultado esperado:

- `listen` actúa como cliente de descubrimiento y biblioteca personal, no como editor

## Fase 5 - Radio unificada

### Objetivo

Formalizar radio por track/album/artist como modalidad del reproductor.

### Backend

Crear una API específica de radio:

- `app/crate/api/radio.py`

Endpoints recomendados:

- `GET /api/radio/track/{track_id}`
- `GET /api/radio/album/{album_id}`
- `GET /api/radio/artist/{name:path}`

Implementación:

- `track radio`
  - Bliss similarity como base
- `album radio`
  - blend/centroid de tracks del álbum o sampleo multi-seed
- `artist radio`
  - reutilizar y consolidar la lógica ya existente de `artist radio`

Notas:

- no usar `track_path` como identidad principal
- usar `track_id` / `album_id`
- devolver datos listos para player:
  - `track_id`
  - `path`
  - `navidrome_id`
  - `title`
  - `artist`
  - `album`

### Listen

Archivo principal:

- `app/listen/src/contexts/PlayerContext.tsx`

Tareas:

- añadir estado `radio`
- soportar `type: track | album | artist`
- auto-refill de cola cuando baje del umbral
- evitar duplicados recientes
- exponer `startTrackRadio`, `startAlbumRadio`, `startArtistRadio`, `stopRadio`

Superficies de entrada:

- track row
- album view
- artist view
- player menu

Resultado esperado:

- una sola arquitectura de radio, no tres implementaciones independientes

## Fase 6 - Regeneración y scheduling de playlists smart del sistema

### Objetivo

Permitir que las playlists smart globales se mantengan frescas.

Backend:

- reutilizar `generate_smart` existente
- extraer lógica a helper reutilizable si hace falta
- crear task específica si se necesita scheduling:
  - `regenerate_system_playlist`

Archivos:

- `app/crate/api/playlists.py`
- `app/crate/worker_handlers/management.py` o nuevo módulo más adecuado
- `app/crate/actors.py`
- `app/crate/scheduler.py`

Tareas:

- regeneración manual desde admin
- regeneración programada para playlists seleccionadas
- guardar `updated_at`, `track_count`, `total_duration`
- opcionalmente guardar `last_generated_at`

Resultado esperado:

- las curated smart pueden mantenerse vivas sin intervención manual constante

## Fase 7 - Proyección global a Navidrome

### Objetivo

Publicar playlists globales del sistema en Navidrome para que otros clientes Subsonic/OpenSubsonic puedan verlas.

Reglas:

- no requiere `user sync`
- no convierte a Navidrome en fuente de verdad
- la playlist global sigue viviendo en Crate
- debe proyectarse con un owner de sistema
- debe quedar pública/shared dentro de Navidrome

Trabajo:

- crear un flujo específico de `system playlist projection`
- soportar creación/actualización en Navidrome
- marcar playlist como pública/shared cuando el endpoint/cliente lo permita
- guardar el `navidrome_id` proyectado de la playlist del sistema si hace falta

## Fase 8 - Proyección personal opcional

### Objetivo

Permitir que un usuario enlazado copie o persista playlists en su espacio personal de Navidrome cuando tenga sentido de producto.

Reglas:

- requiere `user sync` enlazado
- sigue siendo derivada
- no debe confundirse con el follow en Crate

Trabajo:

- reutilizar el patrón actual de sync por usuario
- decidir si aplica a playlists personales, seguidas o ambas
- no lanzar esta fase hasta que la proyección global esté clara

Importante:

- esta fase va después del modelo editorial y del follow
- no debe bloquear el lanzamiento de curated playlists dentro de Crate

## Orden Recomendado de Ejecución

1. Fase 1 - Normalizar modelo de playlists
2. Fase 2 - API de playlists del sistema
3. Fase 3 - UI admin
4. Fase 4 - Follow y discovery en listen
5. Fase 5 - Radio unificada
6. Fase 6 - Regeneración/scheduling
7. Fase 7 - Proyección global a Navidrome
8. Fase 8 - Proyección personal opcional

## Riesgos

### Riesgo 1 - Duplicar sistemas de playlists

Si se crea una entidad editorial paralela demasiado separada de `playlists`, el producto se vuelve más confuso y el mantenimiento más caro.

Mitigación:

- extender `playlists` y no inventar dos jerarquías completas

### Riesgo 2 - Mezclar UX de admin y listen

Si `listen` acaba exponiendo herramientas de curación, se rompe la frontera de producto.

Mitigación:

- reservar creación/edición/regeneración a `admin`

### Riesgo 3 - Radio basada en identidad frágil

Si radio se implementa sobre `track_path`, volveremos a los mismos problemas de identificación que ya hemos corregido en likes/player.

Mitigación:

- usar `track_id` y `album_id`

### Riesgo 4 - Acoplar demasiado pronto a Navidrome

Si las curated dependen de Navidrome para existir, el producto pierde robustez.

Mitigación:

- Crate mantiene la verdad
- Navidrome replica primero a nivel global de sistema y, si hace falta, también a nivel personal

## Validación por Fase

### Backend

- API arranca limpia en dev
- tests o checks básicos de DB
- rutas nuevas devuelven ownership/visibilidad correctos

### Admin

- se puede crear una playlist del sistema
- se puede activar/desactivar
- una smart del sistema puede regenerarse

### Listen

- Home/Explore muestran playlists globales
- Library separa personales y seguidas
- follow/unfollow funciona
- no aparecen botones de edición del sistema al usuario final

### Radio

- track radio rellena cola
- album radio produce resultados razonables
- artist radio reutiliza la infraestructura nueva

## Deliverables

Al completar este plan, el sistema debe tener:

- modelo claro de playlists `user` y `system`
- smart playlists globales gestionadas desde `admin`
- curated playlists globales publicadas en `listen`
- follow por usuario
- radio por track/album/artist
- proyección global a Navidrome como capa derivada
- proyección personal opcional y separada

## Recomendación Final

La implementación debe hacerse con una idea simple:

- no construir un producto nuevo al lado del actual
- evolucionar la infraestructura real ya existente

`admin` gestiona.
`listen` consume.
`smart` genera.
`curated` publica.
