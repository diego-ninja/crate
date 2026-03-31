# Listen User Stats, Wrapped y Listening Intelligence - Diseño

**Fecha**: 2026-03-31
**Estado**: Activo
**Scope**: modelo de datos y producto para estadísticas personales, tendencias, insights y experiencias tipo Wrapped dentro de Crate / Listen

## Resumen

Si queremos que `listen` pueda ofrecer:

- estadísticas útiles tipo stats.fm / volt.fm
- recap anual tipo Spotify Wrapped
- tendencias, gráficos y resúmenes visuales realmente buenos
- mixes y recomendaciones más personales

necesitamos una base mejor que la actual.

Hoy Crate ya guarda historial de reproducción, pero ese historial es demasiado pobre para sostener un sistema de stats potente.

La conclusión principal es:

- sí, con datos de reproducción por usuario podemos construir casi todo lo que queremos
- pero hace falta pasar de un historial mínimo a un modelo de eventos y agregados derivados

## Estado Actual del Repo

## Qué tenemos hoy

En backend ya existe una base mínima:

- tabla `play_history` en [core.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/core.py)
- helpers en [user_library.py](/Users/diego/Code/Ninja/musicdock/app/crate/db/user_library.py)
- API en [me.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/me.py):
  - `GET /api/me/history`
  - `POST /api/me/history`
  - `GET /api/me/stats`

En `listen`, [PlayerContext.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/PlayerContext.tsx) ya envía eventos al terminar una pista:

- `POST /api/me/history`
- y además reporta `scrobble` al backend de streaming

## Limitaciones actuales

La tabla `play_history` actual solo guarda:

- `user_id`
- `track_path`
- `title`
- `artist`
- `album`
- `played_at`

Esto sirve para:

- recently played
- contar reproducciones totales de forma muy simple
- top artists muy básicos

Pero no sirve bien para:

- minutos escuchados reales
- distinguir skip de reproducción completa
- top tracks fiables
- top albums fiables
- estadísticas por hora / día / mes
- streaks
- sesiones de escucha
- comparar periodos
- wrapped narrativo
- algoritmos de personalización más finos

## Qué Aprendemos de stats.fm, volt.fm, Spotify y TIDAL

## stats.fm

Lo más útil del modelo de stats.fm no es la UI, sino la idea de fondo:

- historial completo
- conteo por reproducciones reales
- filtros / exclusiones
- actualización continua

Su propia documentación deja clara una regla importante:

- las stats precisas requieren historial de reproducción rico
- además filtran reproducciones cortas o skips para no contaminar métricas

Fuente:

- [stats.fm - About importing](https://support.stats.fm/docs/import/)
- [stats.fm - History synchronisation](https://support.stats.fm/docs/streams/sync/)

## volt.fm

volt.fm enfatiza muy bien tres superficies:

- número de reproducciones y minutos
- hábitos de escucha por horas / días / meses
- vistas explorables por track / artist / album / genre

Eso encaja muy bien con lo que Crate podría hacer de forma nativa si almacena bien los eventos.

Fuente:

- [volt.fm home](https://volt.fm/)
- [volt.fm Pro](https://volt.fm/pro)
- [volt.fm Super Stats](https://volt.fm/blog/super-stats)

## Spotify Wrapped

Spotify deja una idea importante para producto:

- no todo se calcula igual
- algunas historias usan streams
- otras usan minutos
- otras usan metodologías específicas por entidad

Y además Wrapped es una capa narrativa sobre datos, no un dashboard sin curación.

Fuentes:

- [Spotify Wrapped methodology](https://newsroom.spotify.com/2025-12-05/wrapped-methodology-explained/)
- [How your Wrapped is made](https://newsroom.spotify.com/2025-12-03/how-your-wrapped-is-made/)

## TIDAL

TIDAL demuestra dos cosas útiles:

- `My Mix` se basa en actividad reciente + colección
- `History Mixes` convierten historial en objetos escuchables por mes / año / all-time

Eso es valioso porque apunta a un modelo híbrido:

- estadísticas
- más superficies reproducibles derivadas del historial

Fuentes:

- [TIDAL My Mix](https://support.tidal.com/hc/en-us/articles/360000702697-My-Mix)
- [TIDAL Your History](https://support.tidal.com/hc/en-us/articles/360009257397-Your-History)
- [TIDAL My Activity](https://support.tidal.com/hc/en-us/articles/4410310728977-My-Activity)

## Principio de Diseño para Crate

Crate no debería copiar literalmente stats.fm ni Wrapped ni TIDAL Replay.

La mejor dirección es:

- base de datos propia de listening events
- agregados derivados
- producto híbrido:
  - utilitario como stats.fm / volt.fm
  - emocional y shareable como Wrapped
  - reproducible como los mixes / history mixes de TIDAL

## Modelo de Datos Recomendado

## Capa 1: eventos crudos

Tabla nueva recomendada:

- `user_play_events`

Campos mínimos:

- `id`
- `user_id`
- `track_id` nullable solo como fallback extremo
- `track_path` nullable para compat / auditoría
- `started_at`
- `ended_at`
- `played_seconds`
- `track_duration_seconds`
- `completion_ratio`
- `was_skipped`
- `was_completed`
- `play_source_type`
  - `track | album | playlist | radio | queue | system_playlist | mix`
- `play_source_id` nullable
- `play_source_name` nullable snapshot
- `context_artist`
- `context_album`
- `context_playlist_id`
- `device_type`
  - `web | mobile | desktop | cast` a futuro
- `app_platform`
  - `listen-web | listen-capacitor` etc.
- `created_at`

Notas:

- `track_id` debe ser la identidad principal
- `track_path` puede quedarse como ayuda de compatibilidad / debugging
- no diseñar la capa de stats sobre strings de path

## Capa 2: agregados diarios

Tabla recomendada:

- `user_daily_listening`

Por usuario y día:

- `user_id`
- `day`
- `play_count`
- `complete_play_count`
- `skip_count`
- `minutes_listened`
- `unique_tracks`
- `unique_artists`
- `unique_albums`

Esto permite:

- dashboards rápidos
- trends
- streaks
- calendarios de actividad

## Capa 3: agregados por entidad y periodo

Tablas o materializaciones:

- `user_track_stats`
- `user_artist_stats`
- `user_album_stats`
- `user_genre_stats`

Campos típicos:

- `user_id`
- `entity_id` o `entity_key`
- `window`
  - `7d | 30d | 90d | 365d | all_time | monthly:<yyyy-mm>`
- `play_count`
- `complete_play_count`
- `minutes_listened`
- `first_played_at`
- `last_played_at`

Esto permite:

- tops rápidos
- comparativas por periodo
- reproducir mixes derivados

## Qué Evento Debe Contar Como Reproducción

Mi recomendación es modelar varias capas:

- `play_started`
- `qualified_play`
- `completed_play`

Y para stats visibles:

- una reproducción “válida” cuenta si supera un umbral
- por ejemplo 30 segundos o X% del track

Esto sigue una lógica parecida a la que explican Spotify Wrapped y stats.fm.

No todo debe usar el mismo criterio:

- top tracks: mejor con `qualified_play_count`
- minutos: usar `played_seconds`
- ratio de skips: usar eventos completos vs iniciados

## Qué Guardar en el Player

El cambio principal en `listen` no es visual, es de instrumentación.

[PlayerContext.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/PlayerContext.tsx) debería evolucionar de:

- “registrar al final que se reprodujo algo”

a:

- registrar inicio
- registrar fin
- registrar si hubo skip
- calcular segundos escuchados
- incluir `playSource`

Idealmente:

- al empezar track: crear evento en memoria
- durante reproducción: acumular tiempo escuchado
- al parar / saltar / terminar: flush del evento

No hace falta mandar heartbeats cada segundo en la primera versión.

## MVP recomendado de tracking

### Primer corte útil

Nuevo endpoint:

- `POST /api/me/play-events`

Body:

- `track_id`
- `track_path`
- `title`
- `artist`
- `album`
- `started_at`
- `ended_at`
- `played_seconds`
- `track_duration_seconds`
- `play_source_type`
- `play_source_id`
- `play_source_name`
- `was_skipped`
- `was_completed`

Con esto ya tendríamos base suficiente para:

- top tracks
- top artists
- top albums
- minutes listened
- skip rate
- habits por hora/día

## Features de producto que esto desbloquea

## 1. Stats útiles en la app

Página futura:

- `Stats`

Bloques recomendados:

- minutos escuchados esta semana / mes / año
- top tracks
- top artists
- top albums
- top genres
- listening activity by hour
- listening activity by weekday
- streak actual
- evolución mes a mes

## 2. Wrapped / Year in Review

Experiencia anual narrativa:

- top artists
- top tracks
- top albums
- total minutes
- longest streak
- discovery stats
  - artistas nuevos
  - géneros nuevos
- listening personality
- “tu mes más activo”
- “tu noche más larga”

Y además:

- share cards
- playlist final:
  - `Your 2026 Crate Wrapped`

## 3. History Mixes

Inspirado en TIDAL:

- top tracks del mes
- top tracks del año
- all-time favorites

Como mixes reproducibles:

- `January 2026`
- `2026 Replay`
- `All-Time History Mix`

## 4. Personalization más fuerte

Con esta capa podemos mejorar:

- `For You`
- My Mixes propios de Crate
- recommendations
- playlist radio
- infinite continuation

## 5. stats.fm / volt.fm dentro de Crate

La forma sensata de hacerlo no es “integrarlos”.

La forma buena es:

- coger sus mejores patrones de producto
- implementarlos con datos propios

Qué copiaría:

- métricas por plays + minutes
- timelines y period filters
- top entities explorables
- hábitos de escucha por tiempo
- comparativas temporales

Qué no copiaría tal cual:

- producto enteramente social
- profiles públicos como centro
- excesiva dependencia de share social antes de que la base esté madura

## Fases recomendadas

## Fase 1 - Tracking serio

- nueva tabla `user_play_events`
- nuevo endpoint `POST /api/me/play-events`
- instrumentación en `PlayerContext`
- mantener `play_history` solo como compat temporal o derivado simple

## Fase 2 - Aggregates y API

- agregados diarios
- agregados por track/artist/album
- endpoints:
  - `GET /api/me/stats/overview`
  - `GET /api/me/stats/trends`
  - `GET /api/me/stats/top-tracks`
  - `GET /api/me/stats/top-artists`
  - `GET /api/me/stats/top-albums`

## Fase 3 - UI útil

- página `Stats`
- charts y trends
- filtros por periodo
- bloques reproducibles

## Fase 4 - Wrapped / Replay

- yearly recap
- share cards
- replay playlist

## Fase 5 - Personalization profunda

- mixes
- recommendations
- better home feed
- listening personality / evolutions

## Riesgos

### Riesgo 1 - Guardar muy poco

Si seguimos solo con `track_path + played_at`, luego casi todo será heurística pobre.

### Riesgo 2 - Guardar demasiado pronto

Si intentamos un modelo gigantesco desde el primer día, lo haremos frágil.

### Riesgo 3 - Mezclar analítica con infraestructura externa

Navidrome puede seguir siendo backend de playback, pero la verdad de producto para stats personales debería vivir en Crate.

### Riesgo 4 - UI bonita sin metodología

Wrapped y stats solo funcionan si el criterio de conteo es consistente y explicable.

## Recomendación final

La próxima gran mejora estratégica para `listen` no es solo otra pantalla.

Es esta:

- pasar de historial mínimo a sistema de eventos de escucha por usuario

Con eso podemos construir:

- un `Stats` útil
- un `Wrapped` potente
- mixes e insights que realmente compitan con lo mejor de Spotify/TIDAL

Y sí: esto encaja perfectamente dentro del futuro reanálisis de negocio `listen vs TIDAL/Spotify`, porque define la capa de valor personal y emocional que hoy todavía no existe en Crate.
