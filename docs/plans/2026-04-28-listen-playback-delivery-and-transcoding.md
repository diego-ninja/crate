# Listen Playback Delivery and Transcoding Plan

## Context

`listen` ya funciona bien como cliente de streaming directo, pero su modelo de
entrega sigue siendo muy simple:

- el player construye una URL de stream por track
- el backend sirve el archivo original
- no existe una politica de entrega distinta por red/dispositivo
- los quality badges describen la **fuente**, no necesariamente la calidad
  con la que se esta sirviendo el audio

Esto es suficiente en LAN o con buena conectividad, pero deja margen claro de
mejora para uso movil, datos medidos, redes inestables y dispositivos con
buffering irregular.

La meta no es convertir Crate en un servicio ABR complejo. La meta es:

1. servir la mejor calidad **realmente util** para el contexto de escucha
2. reducir stalls y time-to-first-audio en `listen`
3. mantener transparencia sobre la calidad fuente y la calidad servida
4. conservar la arquitectura actual del player sin romper gapless, crossfade
   ni offline

---

## Current State

### Listen frontend

Hoy el player trabaja con **archivo por track**.

La resolucion de URLs vive en:

- `app/listen/src/contexts/player-utils.ts`

El motor de reproduccion vive en:

- `app/listen/src/lib/gapless-player.ts`

Detalles importantes del estado actual:

- se usan URLs directas por track
- `Gapless5` sigue siendo el engine principal
- el player depende de `Range requests` y de una semantica tipo archivo
- hay precarga limitada (`loadLimit: 2`)
- la UX actual de quality badge parte de metadata de track, no de una capa de
  delivery/transcoding

### Backend

Los streams actuales viven en:

- `app/crate/api/browse_media.py`

Y hoy hacen esencialmente esto:

- resolver el fichero de origen
- devolver `FileResponse`
- exponer `Accept-Ranges: bytes`

No existe todavia:

- endpoint de decision de playback policy
- seleccion de variante por red
- cache de variantes transcoded
- diferencia entre `source quality` y `streamed quality`

### Product truth

En la practica, Crate hoy responde a la pregunta:

- "que fichero tiene este track?"

pero no a estas otras:

- "que version deberia reproducir este usuario en este contexto?"
- "debo priorizar original o una variante mas ligera?"
- "estoy mostrando la calidad fuente o la calidad de entrega?"

---

## Diagnosis

## 1. HLS/DASH no encaja bien con la arquitectura actual

HLS/DASH resolveria parte del problema de adaptacion, pero introduce mucho
coste arquitectonico para el estado actual de Crate:

- complica `gapless`
- complica `crossfade`
- complica `seek`
- complica la compatibilidad con offline actual
- cambia la semantica del player de "track file" a "manifest + segments"
- obliga a reabrir bastante del shell Capacitor/web

No es el mejor siguiente paso.

## 2. El problema real es de politica de entrega

Lo que falta no es tanto un "streaming protocol" distinto como una capa que
decida:

- original
- balanceado
- ahorro de datos

por track y por contexto.

## 3. El usuario necesita transparencia

Si la fuente es:

- `FLAC 16/44.1`

pero la entrega real es:

- `AAC 160`

la UI no deberia mentir. Debe poder mostrar ambas cosas con claridad cuando
corresponda.

## 4. La primera version no necesita adaptacion mid-track

No hace falta una version v1 que cambie bitrate en mitad del track.

Una decision por track:

- antes de empezar a reproducirlo
- o al pasar al siguiente

ya resuelve una gran parte del problema con mucho menos riesgo.

---

## Product Goal

Introducir una capa de **playback delivery** para `listen` que permita servir
la mejor calidad posible en funcion de:

- la preferencia del usuario
- el tipo de red
- la plataforma
- el historial reciente de reproduccion/stalls

sin abandonar el modelo de player actual basado en track URLs.

La experiencia deseada es:

1. el usuario puede elegir una politica simple de reproduccion
2. `listen` pide el mejor stream posible para ese contexto
3. el player sigue funcionando con `gapless`, `crossfade` y offline
4. la UI explica con honestidad fuente vs entrega

---

## Non-goals

Fuera de alcance para esta epica:

- HLS
- DASH
- adaptacion continua dentro del mismo track
- DRM
- cifrado de segmentos
- reescritura del player a nativo
- invalidar o romper el modelo offline ya existente
- cambiar el contrato general de queue/gapless/crossfade

---

## Decisions Locked In

Estas decisiones quedan fijadas para el plan:

### 1. El modelo sigue siendo per-track

No cambiamos a manifests segmentados como base del player.

### 2. La decision de calidad se hace por track

La politica se evalua:

- al empezar el track
- o al preparar el siguiente

No se hace bitrate switching a mitad del track.

### 3. La fuente de verdad de calidad sigue separada de la calidad servida

Debe existir distincion entre:

- `source quality`
- `delivery quality`

### 4. Offline sigue usando archivo local real

Las copias offline no pasan a depender de un pipeline HLS/DASH.

### 5. El backend puede transcodificar bajo demanda, pero con cache

No queremos un pipe ffmpeg improvisado por cada seek si eso rompe `Range`.
La direccion correcta es producir variantes reutilizables y servibles como
ficheros.

---

## Recommended Strategy

La recomendacion es implementar esto como **policy-based playback delivery**.

### User-facing playback policies

Primera capa de producto:

- `Original`
- `Balanced`
- `Data Saver`
- `Auto` mas adelante

Semantica:

- `Original`: intenta servir la fuente original
- `Balanced`: prioriza buena calidad con coste razonable
- `Data Saver`: prioriza arranque rapido y menor consumo
- `Auto`: se deja para una segunda fase, una vez tengamos telemetria real

### Delivery model

Para cada track, el cliente o el backend resuelve una variante de playback:

- passthrough del original si ya es adecuada
- o variante transcoded cacheada si hace falta

El resultado final sigue siendo una URL servible con semantica de archivo.

---

## Proposed Architecture

## Backend

### A. Playback policy resolver

Crear una capa tipo:

- `app/crate/streaming/playback_policy.py`

Responsable de decidir, dado un track y un contexto:

- politica pedida
- formato fuente
- bitrate / sample rate / bit depth
- plataforma objetivo
- flags de red relevantes

que preset de entrega conviene usar.

### B. Variant/transcode service

Crear una capa tipo:

- `app/crate/streaming/transcode.py`

Responsable de:

- resolver si hace falta transcode
- calcular la cache key de la variante
- generar la variante si no existe
- devolver un artefacto reproducible y cacheable

La cache key debe incluir como minimo:

- `storage_id` o identidad estable del track
- version del contenido (`mtime`, hash o similar)
- preset de salida
- version del pipeline de transcode

### C. Stream endpoints

Hay dos opciones razonables:

1. ampliar endpoints actuales con query params
   - `/api/tracks/{id}/stream?mode=balanced`
   - `/api/tracks/by-storage/{storage_id}/stream?mode=data_saver`

2. introducir un endpoint de resolucion previo
   - `/api/tracks/{id}/playback`
   - devuelve `stream_url`, `source_quality`, `delivery_quality`

Recomendacion:

- mantener los endpoints de stream
- añadir un endpoint ligero de resolucion de playback

Ejemplo:

- `GET /api/tracks/{track_id}/playback?mode=balanced`

Respuesta posible:

- `stream_url`
- `source`
- `delivery`
- `transcoded`
- `cache_hit`

Esto deja la logica de decision bien encapsulada y evita meter demasiada
semantica en `player-utils.ts`.

### D. Concurrency and limits

El transcode no debe competir sin control con analysis/bliss/workers.

Necesitamos:

- semaforo por proceso o servicio
- limite de jobs simultaneos
- colas cortas / cancelacion razonable
- eviction policy de variantes en disco

---

## Listen frontend

### A. Playback mode preference

Persistir una preferencia de reproduccion:

- `original`
- `balanced`
- `data_saver`
- `auto` en fase posterior

### B. Player resolution flow

Antes de reproducir un track remoto:

1. resolver la policy activa
2. pedir la variante de playback
3. entregar al engine la URL final

La cola sigue siendo la misma; lo que cambia es la URL efectiva de reproduccion.

### C. UI transparency

El player y paginas relevantes deberian poder mostrar dos capas:

- fuente: `FLAC 16/44.1`
- reproduccion: `AAC 160`

No siempre hace falta mostrar ambas todo el tiempo, pero la informacion debe
estar disponible y el badge principal no debe inducir a error.

### D. Auto mode later

Cuando exista `Auto`, las señales candidatas son:

- `navigator.connection` en web cuando exista
- `@capacitor/network`
- historial reciente de buffering/stalls
- plataforma actual
- si el stream es local offline o remoto

La decision se aplicaria al track siguiente, no a mitad del actual.

---

## Observability Required

Antes de automatizar `Auto`, necesitamos visibilidad.

### Client metrics

Medir por reproduccion o por track:

- `time_to_first_audio_ms`
- `buffering_events`
- `buffering_total_ms`
- `track_start_failures`
- `delivery_mode`
- `source_format`
- `delivery_format`

### Server metrics

Medir:

- transcodes iniciados
- transcodes completados
- transcodes fallidos
- cache hits de variantes
- cache misses
- tiempo medio de generacion por preset
- bytes servidos por preset

### Admin visibility

Tiene sentido que el dashboard admin pueda ver:

- actividad reciente de variantes
- hit rate de transcode cache
- errores de ffmpeg
- relacion entre source y delivered quality

---

## Implementation Phases

## Phase 0. Design + telemetry

Objetivo:

- fijar contrato
- medir comportamiento actual
- introducir las metricas minimas

Entregables:

- este plan convertido en referencia activa
- metricas cliente/servidor base
- decision cerrada sobre endpoint `playback`

## Phase 1. Manual playback modes

Objetivo:

- exponer `Original`, `Balanced`, `Data Saver`
- sin auto mode

Entregables:

- preferencia persistida en `listen`
- UI minima de ajuste
- endpoint/backend que resuelve variante
- passthrough cuando no haga falta transcode

## Phase 2. Cached transcoded variants

Objetivo:

- generar variantes bajo demanda de forma estable

Entregables:

- servicio de transcode cacheado
- eviction policy
- concurrency guard
- tests de seek/range sobre variantes

## Phase 3. UX transparency

Objetivo:

- diferenciar claramente fuente y entrega

Entregables:

- badges/coincidencias en player y pantallas clave
- copy clara para explicar `Original` / `Balanced` / `Data Saver`

## Phase 4. Auto mode

Objetivo:

- seleccionar preset automaticamente con reglas simples y auditables

Entregables:

- heuristica basada en red + stalls
- logs/metricas para entender por que se tomo una decision
- cambio de preset solo entre tracks

---

## Risks

## 1. Seek / range incompatibilities

Si el transcode se sirve como pipe puro sin artefacto intermedio util, el seek
puede degradarse bastante.

Mitigacion:

- priorizar variantes cacheadas como fichero
- probar `Range` desde el inicio

## 2. CPU pressure

Transcodificar en caliente puede pelearse con analysis/bliss/worker load.

Mitigacion:

- limites de concurrencia
- cache de variantes
- presets acotados

## 3. Quality confusion

Si la UI sigue mostrando solo la calidad fuente, el usuario puede pensar que
esta escuchando lossless cuando no es asi.

Mitigacion:

- separar explicitamente source vs delivery

## 4. Scope creep

Meter `Auto`, transcode, offline y cambios de player a la vez seria demasiado.

Mitigacion:

- seguir las fases y no saltar directamente a la automatizacion

---

## Acceptance Criteria for v1

Podemos considerar la primera iteracion de esta epica exitosa si:

1. `listen` ofrece `Original`, `Balanced` y `Data Saver`
2. el backend puede servir passthrough o variante segun policy
3. el player sigue funcionando con gapless/crossfade sin regresiones graves
4. los quality badges no mienten sobre la calidad realmente servida
5. hay metricas suficientes para decidir despues si `Auto` merece la pena

---

## Recommendation

Sí merece la pena abordar esta epica.

Pero la forma correcta no es saltar a HLS/DASH ni a adaptacion continua.

La mejor siguiente iteracion es:

1. cerrar el merge estable del trabajo actual
2. abrir una rama/epica especifica de playback delivery
3. implementar primero `Original`, `Balanced`, `Data Saver`
4. introducir transcode cacheado por track
5. dejar `Auto` para una segunda vuelta con telemetria real

Ese orden da el mejor equilibrio entre:

- mejora perceptible de experiencia
- riesgo controlado
- compatibilidad con la arquitectura actual de Crate
