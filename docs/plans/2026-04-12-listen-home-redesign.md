# Listen Home Redesign

## Objetivo
Rehacer la Home de `listen` con una estructura más cercana a Tidal/Spotify:

1. Hero editorial con artista recomendado
2. Recently played en grid 3x3
3. Custom mixes dinámicos
4. Suggested new albums
5. Recommended new tracks
6. Radio stations
7. Favorite artists
8. Artist essentials
9. Mantener Upcoming / Replay / Just Landed abajo

## Contrato backend
Nuevo agregado:

- `GET /api/me/home/discovery`

Devuelve:

- `hero`
- `recently_played`
- `custom_mixes`
- `suggested_albums`
- `recommended_tracks`
- `radio_stations`
- `favorite_artists`
- `essentials`

Nuevo endpoint de mixes dinámicos:

- `GET /api/me/home/mixes/{mix_id}`

## Heurísticas v1

### Hero
- artista no seguido
- con foto y bio
- match por top genres del usuario
- boost por relación con top artists recientes
- desempate por listeners / playcount global

### Daily Discovery
- tracks no reproducidos o muy poco reproducidos
- artistas fuera del núcleo más escuchado/seguido
- match por top genres del usuario
- diversidad por artista y álbum

### My New Arrivals
- tracks de releases recientes de artistas seguidos o top artists
- preferencia por material no escuchado
- fallback a material reciente del catálogo de esos artistas si faltan releases detectados

### Genre Mixes
- 2-3 mixes generados desde top genres 90d
- foco en descubrimiento controlado, no repetición

### Suggested New Albums
- `new_releases` que encajan con artistas seguidos / top artists
- solo álbumes presentes en librería local
- excluye álbumes guardados

### Recommended New Tracks
- cortes de releases muy recientes, priorizando la última semana
- excluye liked y ya escuchados
- fallback a `My New Arrivals`

### Radio Stations
- mezcla de artist radios y album radios
- seeds sacadas de top artists + top albums 90d

### Essentials
- cards tipo playlist por artista
- fuente: top artists 90d
- label actual: `Core Tracks`
- playback: top tracks del artista

## Pendientes
- Ajustar el scoring del hero con datos de producción
- Decidir si `Custom mixes` merecen página propia además de reproducción directa
- Afinar `My New Arrivals` cuando haya más releases reales en prod
- Ver si `Just Landed` sigue teniendo sitio o se sustituye por otra fila más personalizada
