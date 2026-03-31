# Radio y Playlist Intelligence - Diseño Consolidado

**Fecha**: 2026-03-31
**Estado**: Activo
**Scope**: radio por `track` / `album` / `artist` / `playlist`, reproducción infinita con suggested tracks, e inclusión inteligente de pistas en playlists

## Resumen

Este documento consolida la estrategia de Crate para toda la reproducción “inteligente” en `listen`.

Agrupa tres problemas que deben resolverse con una arquitectura coherente, no con features aisladas:

1. radio contextual
2. continuidad automática cuando termina un álbum o playlist en modo infinito
3. sugerencias inteligentes intercaladas dentro de una playlist, al estilo Spotify

La idea base es esta:

- la radio no es una playlist guardada
- las sugerencias no deben mutar una playlist por defecto
- el player necesita un único motor de recomendación/contexto que alimente varias superficies

## Reglas de Producto

- `listen` es una app de consumo
- `admin` sigue siendo la herramienta de gestión de playlists globales del sistema
- las playlists `smart` y `curated` del sistema siguen viviéndose desde `admin`
- el usuario final no debe ver infraestructura backend como Navidrome
- cualquier inteligencia de reproducción debe sentirse como comportamiento natural del player, no como plumbing técnico

## Qué Problemas Resuelve Este Diseño

### 1. Radio

Permitir que el usuario arranque una sesión continua basada en:

- una pista
- un álbum
- un artista
- una playlist

### 2. Infinite Continuation

Cuando termina un álbum o una playlist y el modo infinito está activo, el player no debe quedarse muerto:

- debe sugerir continuidad musical razonable
- debe hacerlo sin romper la identidad del contexto original

### 3. Smart Track Inclusion

Permitir que una playlist tenga sugerencias inteligentes entre sus pistas durante la reproducción:

- de forma configurable
- sin modificar la playlist guardada
- con opción futura de aceptar una sugerencia y convertirla en parte real de la playlist

## Modelo Conceptual

## Radio Session

La radio es una sesión dinámica del reproductor.

Debe tener:

- `active`
- `type`: `track | album | artist | playlist`
- `seed`
- `sessionId`
- `refillThreshold`
- `recentlySuggestedTrackIds`
- `recentlyPlayedTrackIds`

No debe persistirse como playlist salvo que en el futuro se ofrezca explícitamente “save this queue as playlist”.

## Queue Continuation

La continuación infinita no es exactamente radio, pero comparte motor.

Conceptualmente:

- una reproducción normal puede degradar a “context continuation”
- esa continuación puede usar radio interna sin exponerla como concepto distinto

Ejemplo:

- el usuario reproduce un álbum completo
- el álbum termina
- `infinite mode = on`
- el player pide pistas sugeridas usando el álbum como contexto

## Smart Inclusion

La inclusión inteligente no es una mutación del objeto playlist.

Debe entenderse como:

- una capa de sugerencias sobre la cola de reproducción derivada de una playlist
- opcional
- visible y controlable

Por defecto, una pista sugerida:

- entra en la cola
- aparece marcada visualmente como sugerida
- no se guarda en la playlist original

En el futuro podrá existir:

- `Add suggestion to playlist`

## Tipos de Radio

## Track Radio

Semilla:

- `track_id`

Uso:

- arrancar desde un track row
- arrancar desde el player actual

Señales recomendadas:

- Bliss / similitud tímbrica
- BPM / energía / tonalidad
- afinidad de artista
- afinidad de género
- dedupe fuerte respecto a cola reciente

Es el caso más directo y el que debería dar mejores resultados más pronto.

## Album Radio

Semilla:

- `album_id`

Objetivo:

- extender el mundo sonoro de un álbum
- no reducirlo a una sola pista

Señales recomendadas:

- sampleo multi-seed de varias pistas del álbum
- centroid o agregación ligera de señales del álbum
- afinidad de artista, escena y género
- respeto por continuidad estética

Debe ser especialmente útil para discos con identidad fuerte.

## Artist Radio

Semilla:

- `artist_name` o `artist_id`

Objetivo:

- mezclar catálogo del artista con vecindad musical razonable

Base actual ya existente:

- Crate ya tiene `artist radio` parcial apoyada en Bliss y artistas similares

Dirección nueva:

- absorber esa implementación en un modelo unificado
- dejar de tratarla como endpoint especial legacy

## Playlist Radio

Semilla:

- `playlist_id`

Aplica tanto a:

- playlists personales
- playlists del sistema (`smart` o `curated`)

Objetivo:

- continuar la identidad musical de una playlist sin limitarse a sus pistas exactas

Señales recomendadas:

- sampleo de pistas representativas de la playlist
- distribución de artistas y géneros de la playlist
- energía / BPM / tonalidad medias o por clusters
- historial reciente de skips / likes en la propia sesión

Esto es distinto de “seguir reproduciendo la playlist”:

- playlist radio expande
- reproducción normal solo consume el contenido guardado

## Suggested Tracks al Final de Álbum o Playlist

## Objetivo

Cuando el usuario activa reproducción infinita:

- al terminar un álbum, seguir con pistas relacionadas
- al terminar una playlist, seguir con pistas relacionadas

Esto debe sentirse natural, no aleatorio.

## Reglas

### Si termina un álbum

Con `infinite mode = on`:

- continuar usando contexto de `album`
- si el álbum pertenece a un artista con identidad fuerte, priorizar coherencia sobre variedad
- si el álbum es claramente continuo/gapless, nunca insertar sugerencias en mitad del álbum; solo al final

### Si termina una playlist

Con `infinite mode = on`:

- continuar usando contexto de `playlist`
- priorizar mantener el mood o la escena de la playlist
- si la playlist es del sistema y tiene metadata editorial fuerte, respetar ese marco

## UX esperada

Al acercarse el final:

- el usuario no debería notar corte
- opcionalmente puede aparecer una pequeña etiqueta del tipo:
  - `Up next from this vibe`
  - `Keep the session going`

Pero la continuidad no debe sentirse como una nueva pantalla o modo separado.

## Smart Track Inclusion en Playlists

## Qué es

Durante la reproducción de una playlist, el motor puede intercalar pistas sugeridas entre pistas guardadas.

Inspiración:

- Spotify Smart Shuffle

En Crate, la primera versión debería ser más sobria y controlable.

## Principios

- las sugerencias no mutan la playlist persistida
- la sugerencia vive en la cola, no en `playlist_tracks`
- el usuario debe poder entender qué pista es sugerida
- debe poder desactivarse

## Configuración recomendada

La configuración debería vivir en dos niveles:

### Preferencia del usuario

- `smartPlaylistSuggestionsEnabled`
- `smartPlaylistSuggestionsCadence`
  - por ejemplo cada `3`, `4`, `5`, `6` pistas
- `smartPlaylistSuggestionsIntensity`
  - `low | medium | high`

### Política de playlist

Opcional y especialmente útil para playlists del sistema:

- `allow_smart_inclusion`
- `default_suggestion_cadence`
- `suggestion_profile`
  - `strict`
  - `balanced`
  - `exploratory`

La política de playlist no debe imponerse a un usuario si éste la ha desactivado globalmente.

## Comportamiento recomendado

Si está activo:

- cada N pistas reproducidas desde una playlist
- el motor evalúa si conviene insertar una sugerencia
- la sugerencia entra justo después de la pista actual o en el siguiente bloque lógico

Debe haber límites:

- no más de X sugerencias por hora
- no más de Y sugerencias consecutivas
- nunca duplicar un track reciente
- nunca romper reproducción gapless dentro de un álbum si la playlist está reproduciendo un bloque de álbum continuo

## Diferencia entre Smart Playlist e Smart Inclusion

No son lo mismo.

- `smart playlist`: el contenido guardado de la playlist se genera por reglas
- `smart inclusion`: durante la reproducción, el player añade sugerencias efímeras a la cola

Ejemplos:

- playlist del sistema `Hardcore`: smart playlist
- mientras la escuchas, el player te intercala 1 tema sugerido cada 5: smart inclusion

## Motor Unificado de Recomendación

Las tres superficies deben apoyarse en un mismo servicio interno:

- radio
- infinite continuation
- smart inclusion

## Inputs del motor

- seed primaria:
  - `track_id`
  - `album_id`
  - `artist_name/id`
  - `playlist_id`
- contexto actual:
  - cola
  - historial reciente
  - skips
  - likes
  - artists recientes
  - albums recientes
- restricciones:
  - no duplicados
  - no repetir artista de forma excesiva
  - no romper continuidad de álbum cuando proceda

## Señales recomendadas

- Bliss / similaridad de audio
- artist similarities
- géneros
- BPM / energía / tonalidad
- popularidad
- afinidad por librería personal
- editorial priors para playlists del sistema

## Contrato de Identidad

La identidad principal debe ser estable:

- `track_id` para radio de pista
- `album_id` para radio de álbum
- `playlist_id` para radio de playlist

En la respuesta:

- `track_id`
- `title`
- `artist`
- `album`
- `path`
- `navidrome_id` cuando exista

En el player:

- `libraryTrackId` como identidad principal de biblioteca
- `navidromeId` como backend preferente de reproducción si existe
- `path` como fallback

No volver a diseñar nada alrededor de `track_path` como identidad canónica de producto.

## API Recomendada

## Radio

- `GET /api/radio/track/{track_id}`
- `GET /api/radio/album/{album_id}`
- `GET /api/radio/artist/{name:path}`
- `GET /api/radio/playlist/{playlist_id}`

Parámetros comunes:

- `limit`
- `exclude_track_ids`
- `exclude_artist_names`
- `continuation_context`

## Continuation / Suggestions

Dos caminos válidos:

### Opción A: endpoints separados

- `POST /api/playback/continue`
- `POST /api/playback/playlist-suggestions`

### Opción B: un solo endpoint de motor

- `POST /api/recommendations/resolve`

con body:

- `mode`: `radio | continuation | playlist_inclusion`
- `seedType`
- `seed`
- `queueContext`
- `preferences`

Mi recomendación:

- empezar por endpoints separados de radio
- y usar un servicio interno compartido
- cuando el modelo madure, evaluar unificación del endpoint

## Modelo del Player en Listen

`PlayerContext` debería evolucionar para soportar:

- `radioSession`
- `autoplayMode`
  - `off`
  - `continue_context`
- `playlistSuggestionMode`
  - `off`
  - `on`
- `suggestedQueueItems`
- `lastRecommendationFetchAt`

## Entry Points en Listen

### Track

- track row contextual menu
- player bottom bar contextual menu
- extended player

### Album

- botón `Album Radio` en la vista de álbum

### Artist

- botón `Artist Radio` en la vista de artista

### Playlist

- botón `Playlist Radio` en la vista de playlist
- acción equivalente en filas de playlists

## Priorización Recomendada

## Fase 1

- formalizar `track radio`
- migrar `artist radio` al modelo nuevo
- exponer entradas claras en `listen`

## Fase 2

- `album radio`
- `playlist radio`

## Fase 3

- `infinite continuation` para álbum/playlist

## Fase 4

- `smart track inclusion`

## Por Qué Este Orden

- `track radio` da la mejor señal con menor ambigüedad
- `artist radio` ya tiene base reutilizable
- `album radio` y `playlist radio` dependen más de multi-seed y contexto
- `smart inclusion` es la parte más sensible de UX y debe llegar con el motor ya fiable

## Decisiones de UX Importantes

- radio debe sentirse como modo de reproducción, no como lista guardada
- suggested tracks al final deben ser discretos, no intrusivos
- smart inclusion debe ser claramente identificable y fácil de apagar
- ninguna de estas capas debe exponer al usuario detalles de backend o infraestructura

## Riesgos

### Riesgo 1 - Duplicados o loops

Si el motor no deduplica bien:

- radio y continuation se volverán repetitivos muy rápido

### Riesgo 2 - Radio demasiado “técnica”

Si Bliss domina demasiado:

- la coherencia tímbrica puede ganar a la coherencia musical percibida

### Riesgo 3 - Smart inclusion invasiva

Si se sugieren demasiadas pistas:

- el usuario sentirá que su playlist deja de ser “suya”

### Riesgo 4 - Mezclar responsabilidad de producto

Si smart inclusion y smart playlist se mezclan conceptualmente:

- será difícil explicarlo y mantenerlo

## Conclusión

Crate necesita una sola arquitectura de “playback intelligence”, no varias features sueltas.

Esa arquitectura debe cubrir:

- radio por `track` / `album` / `artist` / `playlist`
- continuation al final de álbum/playlist en modo infinito
- sugerencias intercaladas dentro de playlists

Todo ello sin:

- mutar playlists por sorpresa
- exponer infraestructura técnica al usuario
- reintroducir identidades frágiles basadas en paths
