# Radio, Smart Playlists y Curated Playlists - Diseño

**Fecha**: 2026-03-30
**Estado**: Revisado
**Scope**: radio por artista/album/track y playlists globales del sistema gestionadas desde `admin`

## Resumen

Este documento redefine el modelo de radio y playlists globales en Crate con una regla central:

- `listen` es una app de consumo
- `admin` es la app de gestión y curación
- los usuarios finales pueden crear playlists normales propias
- los usuarios finales no pueden crear ni editar playlists `smart` o `curated`
- las playlists `smart` y `curated` son entidades del sistema, creadas y mantenidas por admins/curators de Crate
- lo que sí es por usuario es la relación de `follow`, librería personal y, en su caso, las proyecciones personales a Navidrome

## Objetivos

Queremos soportar tres familias de funcionalidad:

1. radio por `track`, `album` y `artist`
2. playlists globales del sistema mantenidas desde `admin`
3. follow/unfollow por usuario sobre esas playlists globales desde `listen`

## Principios de Producto

### Separación de responsabilidades

- `app/ui` administra, configura, genera y publica playlists del sistema
- `app/listen` descubre, reproduce, sigue y consume esas playlists
- `app/listen` no expone ningún flujo de creación de smart/curated playlists

### Identidad de usuario

- Crate sigue siendo el origen de verdad para auth, follows, likes, saves, playlists personales y relaciones de librería
- la sincronización con Navidrome tiene dos capas distintas:
  - proyección global del sistema para clientes externos Subsonic/OpenSubsonic
  - proyección personal por usuario enlazado cuando aplique
- ninguna playlist global del sistema debe depender de una cuenta Navidrome compartida para existir

### Modelo conceptual claro

En Crate, `smart` y `curated` no son sinónimos.

- `smart` responde a: "como se construyen los tracks"
- `curated` responde a: "como se presenta, publica y distribuye una playlist del sistema"

Esto permite casos como:

- playlist global estática y editorial: `curated`, pero no `smart`
- playlist global regenerada por reglas: `smart` y `curated`
- playlist personal normal del usuario: ni `smart` ni `curated`

## Definiciones

### Playlist personal

Playlist privada del usuario.

- creada por el usuario
- editable por el usuario
- visible en su librería personal
- puede sincronizarse a Navidrome si el usuario está enlazado

### Smart playlist

Playlist cuyo contenido se genera a partir de reglas.

- no define por sí sola visibilidad ni audiencia
- describe un mecanismo de generación
- puede ser del sistema
- puede regenerarse manual o automáticamente

### Curated playlist

Playlist global publicada por el sistema para los usuarios finales.

- existe como objeto editorial
- tiene identidad, metadata, artwork, copy y visibilidad pública dentro de `listen`
- puede ser estática o smart
- puede ser seguida por usuarios

## Relación entre Smart y Curated

La diferencia importante es esta:

- `smart` es el motor
- `curated` es el producto final publicado

Relación recomendada:

- una playlist `curated` puede estar respaldada por una playlist `smart`
- una playlist `curated` también puede ser manual/estática
- no toda playlist `smart` tiene por qué ser visible en `listen`

Ejemplos:

- `Top 50 2026`: curated + smart
- `Chill Evenings`: curated + smart
- `Diego Picks Vol. 1`: curated + estática
- `Repair Candidates`: smart interna para admin, no curated

## Modelo Recomendado

Se recomienda unificar todo sobre la entidad `playlists` ya existente, en vez de crear dos sistemas totalmente paralelos.

Campos conceptuales recomendados:

- `scope`: `user | system`
- `generation_mode`: `static | smart`
- `is_curated`: boolean
- `is_active`: boolean
- `managed_by_user_id`: nullable, para saber qué admin/curator la mantiene
- `follower_count`: derivado, no necesariamente persistido
- `curation_key` o `slug`: opcional, para templates/identidad editorial estable

Consecuencias:

- playlist personal: `scope=user`, `generation_mode=static`, `is_curated=false`
- smart interna de admin: `scope=system`, `generation_mode=smart`, `is_curated=false`
- curated editorial manual: `scope=system`, `generation_mode=static`, `is_curated=true`
- curated editorial regenerada: `scope=system`, `generation_mode=smart`, `is_curated=true`

Esto encaja mejor con la infraestructura actual de Crate:

- API ya existente en `app/crate/api/playlists.py`
- capa DB ya existente en `app/crate/db/playlists.py`
- UI admin de playlists ya existente en `app/ui/src/pages/Playlists.tsx`
- UI de consumo ya existente en `app/listen/src/pages/Library.tsx`, `Home.tsx` y `Playlist.tsx`

## Follow por Usuario

El `follow` sí es estrictamente por usuario.

Un usuario puede:

- seguir una playlist `curated`
- dejar de seguir una playlist `curated`
- ver sus playlists globales seguidas dentro de su librería
- opcionalmente copiarlas o guardarlas en su espacio personal si más adelante se decide ofrecer esa acción

Un usuario no puede:

- crear una curated playlist
- editar reglas smart del sistema
- activar/desactivar playlists del sistema
- cambiar portada/copy/editorial de playlists del sistema

Relación recomendada:

- `user_followed_playlists(user_id, playlist_id, followed_at)`

Esa relación debe apuntar a la playlist global real, no a una entidad paralela distinta.

## Radio

## Propósito

La radio debe ser una capa de reproducción continua y contextual, no una playlist persistente.

Debe soportar:

- `track radio`
- `album radio`
- `artist radio`

Todas comparten una misma idea:

- partir de una o varias semillas
- encontrar continuidad musical razonable
- rellenar cola progresivamente

## Tipos de Radio

### Track Radio

Usa una pista concreta como semilla principal.

Fuentes recomendadas:

- `bliss_vector` como señal principal
- exclusión de la propia pista y de tracks recientes en la cola
- posible mezcla con popularidad o afinidad de artista para evitar resultados demasiado raros

Es el mejor caso para aprovechar Bliss de forma directa.

### Album Radio

Usa un álbum como semilla.

Opciones válidas:

- centroid/blend de los `bliss_vector` del álbum
- sampleo de varias pistas del álbum como semillas
- mezcla de similitud sonora + cercanía de artista/escena

Objetivo:

- capturar el "mundo" de un álbum, no solo una pista aislada

### Artist Radio

Usa un artista como semilla.

Debe apoyarse en:

- catálogo del artista
- artistas similares ya enriquecidos
- pistas similares vía Bliss
- opcionalmente popularidad o recurrencia para no quedarse en resultados demasiado dispersos

Nota:

- Crate ya tiene una base de `artist radio`
- el diseño nuevo debe absorber esa capacidad dentro de un modelo de radio unificado, no duplicarla sin criterio

## Contrato Recomendado de Radio

La radio debería apoyarse en identidad moderna de pista:

- `libraryTrackId` como identidad de biblioteca
- `navidromeId` como backend preferido de playback si existe
- `path` solo como fallback de stream

Por tanto:

- evitar diseño basado en `track_path` como identidad principal de API
- preferir endpoints por `track_id`, `album_id` o `artist name / artist_id`

Propuesta de superficie:

- `GET /api/radio/track/{track_id}`
- `GET /api/radio/album/{album_id}`
- `GET /api/radio/artist/{name:path}`

Parámetros posibles:

- `limit`
- `exclude_track_ids`
- `exclude_artists`
- `threshold`

Respuesta esperada:

- lista de tracks lista para encolar, con `track_id`, `path`, `navidrome_id`, metadata y cover data derivable

## Player Model

La radio es una modalidad del player, no una playlist guardada.

El player debería manejar:

- `radio.active`
- `radio.type`: `track | album | artist`
- `radio.seed`
- `radio.autoRefillThreshold`
- `radio.lastFetchAt`

Comportamiento:

1. usuario inicia una radio
2. se reproduce una pista inicial o se encola un lote inicial
3. cuando la cola baja del umbral, el player pide más resultados
4. los tracks nuevos se añaden al final de la cola
5. al parar radio, la cola deja de autoalimentarse

## Smart Rules

Las smart playlists del sistema deben reutilizar el motor de reglas ya existente en Crate.

Posibles familias de reglas:

- género
- artista
- año
- bpm
- energy
- danceability
- valence
- formato
- popularidad
- reglas basadas en similitud Bliss

Pero Bliss en playlists smart debe entenderse como una herramienta adicional, no como la única forma de construir radio o curation.

Ejemplos:

- `High Energy Metal`: reglas de género + energy + bpm
- `Late Night Electronics`: reglas de género + valence baja + decades
- `If You Like Converge`: mezcla editorial + similar artists + Bliss

## Curated del Sistema

Las curated playlists son objetos editoriales publicados por el sistema.

Propiedades recomendadas:

- nombre
- descripción
- portada
- short copy / subtitle opcional
- categoría: `mood | genre | fresh | editorial | scene`
- posición/orden editorial
- activa o no activa
- visibilidad en Home / Explore / Library

Secciones naturales en `listen`:

- `Featured`
- `Moods`
- `Genres`
- `Fresh`
- `For Fans Of`

## Admin UX

`admin` debe ser el único punto de creación y gestión de playlists del sistema.

Capacidades necesarias:

- crear playlist del sistema estática
- crear playlist del sistema smart
- editar metadata editorial
- editar reglas smart
- regenerar manualmente
- activar/desactivar
- destacar en Home/Explore
- ver track count, freshness y follower count

También conviene distinguir visualmente en admin:

- personales del usuario
- smart internas
- curated públicas

## Listen UX

`listen` debe comportarse como cliente de consumo.

Capacidades:

- descubrir playlists curated
- seguir/dejar de seguir
- reproducir
- compartir
- ver detalles y tracks
- opcionalmente sincronizar a Navidrome si el usuario está enlazado

No debe permitir:

- crear curated
- crear smart
- editar reglas smart
- regenerar playlists del sistema

## Home, Explore y Library

### Home

- secciones editoriales destacadas
- mezcla de curated playlists, artistas y álbumes
- algunas playlists pueden marcarse como `featured`

### Explore

- navegación por categorías editoriales
- filtros o tabs por `mood`, `genre`, `fresh`, etc.

### Library

Debe separar claramente:

- `Your Playlists`
- `Followed Playlists`

Esto evita mezclar playlists personales con objetos globales del sistema.

## Proyección a Navidrome

Regla importante:

- las playlists del sistema viven primero en Crate
- el follow vive en Crate
- Navidrome nunca es la fuente de verdad de estas playlists

Hay dos proyecciones distintas:

### 1. Proyección global del sistema

- las playlists `curated` y, cuando tenga sentido, algunas `smart`, deben existir también en Navidrome para clientes externos Subsonic/OpenSubsonic
- esa proyección debe crearse bajo un owner de sistema
- esas playlists deben marcarse como públicas/visibles para todos los usuarios permitidos por Navidrome
- su existencia no depende de que nadie las siga en `listen`

Objetivo:

- que otros clientes además de `listen` vean esas playlists globales

### 2. Proyección personal por usuario

- opcional y separada
- depende del `user sync` enlazado
- sirve para casos de copia o persistencia dentro del espacio personal del usuario

Por tanto, el follow en Crate no debe significar automáticamente "copiar playlist al usuario en Navidrome".

Consecuencias:

- una playlist curated no existe "solo en Navidrome"
- una playlist global del sistema puede proyectarse a Navidrome como pública sin depender del usuario
- si Navidrome está caído, la relación de follow no debe romperse
- el `follow` sigue siendo una señal de biblioteca personal dentro de Crate/`listen`

## Arquitectura Recomendada por Fases

### Fase 1: Aclarar modelo de playlist

- consolidar modelo `scope + generation_mode + is_curated`
- separar claramente personales vs sistema
- añadir relación de follow por usuario para playlists globales

### Fase 2: Radio unificada

- formalizar `track radio`, `album radio` y `artist radio`
- mover a un contrato común de endpoints y PlayerContext
- usar `track_id` / `album_id` / `artist`

### Fase 3: Admin editorial

- UI de admin para playlists globales
- reglas smart
- publicación y activación
- regeneración manual y programada

### Fase 4: Listen de consumo

- secciones curated en Home y Explore
- Followed Playlists en Library
- UX clara entre playlist personal y playlist del sistema

### Fase 5: Sync opcional a Navidrome

Dividir esta fase en dos subcapas:

- `system projection`
  - publicar playlists globales en Navidrome como playlists públicas
- `user projection`
  - solo para usuarios enlazados
  - opcional
  - nunca como fuente de verdad

## Criterios de Éxito

- el usuario final entiende la diferencia entre playlist propia y playlist seguida
- `listen` no expone herramientas de curación que pertenecen a `admin`
- radio por track/album/artist funciona sin acoplarse a paths frágiles
- playlists del sistema pueden ser estáticas o smart sin crear dos productos separados
- las playlists globales pueden existir también en Navidrome para clientes externos sin alterar la fuente de verdad en Crate

## Recomendación Final

Crate debe tratar:

- `radio` como una modalidad de reproducción dinámica
- `smart` como un mecanismo de generación
- `curated` como una capa editorial de publicación

La fuente de gestión de todo eso debe vivir en `admin`.
La fuente de consumo y follow debe vivir en `listen`.

Esa separación es la que mejor encaja con la arquitectura actual del proyecto y con la dirección de producto de ambas apps.
