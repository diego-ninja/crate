# Identity, Social & Collaboration Status

Fecha: 2026-04-11
Rama: `codex/identity-social-collab-foundation`

## Resumen

La rama ya no es solo la implementación de la fase `identity/social/collaboration`.
Durante el trabajo también se abrió un frente grande de plataforma:

- eliminación progresiva de la dependencia de Navidrome
- introducción de un API Subsonic propio en Crate
- cierre del login social con Google
- limpieza importante de `listen` y `admin` para quitar acoplamientos viejos

El resultado actual es bueno en alcance, pero heterogéneo: la base social/collab está mayoritariamente implementada y compila, mientras que la limpieza de Navidrome no está terminada al 100% en backend.

## Salud actual

Validado a fecha de este documento:

- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile` OK en `auth`, `social`, `jam`, `subsonic` y DB asociada
- `npm run build` OK en `app/listen`
- `npm run build` OK en `app/ui`

## Qué quedó implementado del plan original

### 1. Auth configurable y proveedores sociales

Implementado:

- auth por contraseña sigue activo
- Google OAuth funcional
- Apple preparado a nivel de infraestructura OAuth/OIDC
- providers activables/desactivables desde `admin`
- `GET /api/auth/providers`
- `POST /api/auth/oauth/{provider}/start`
- `GET /api/auth/oauth/{provider}/callback`
- `POST /api/auth/oauth/{provider}/link`
- `POST /api/auth/oauth/{provider}/unlink`
- `return_to` soportado en `admin` y `listen`
- invite-only para altas nuevas
- auth invites desde `admin`
- links y QR para invites
- login/register en `listen` ya usan botones OAuth propios

Estado:

- Google: funcional
- Apple: infraestructura presente, pendiente de validación real end-to-end

### 2. Sesiones reales y gestión de usuarios

Implementado:

- sesiones persistidas con `revoked_at`, `last_seen_at`, `last_seen_ip`, `user_agent`, `app_id`, `device_label`
- heartbeat en `listen` y `admin`
- listado de sesiones del usuario
- revocar sesión individual
- revocar todas salvo la actual
- `admin/users` muestra sesiones activas y cuentas conectadas
- modal de detalle por usuario con sesiones

Estado:

- backend: fuerte
- `listen`: usable
- `admin`: usable

### 3. Social graph, perfiles y affinity

Implementado:

- perfiles públicos por `username`
- follows unidireccionales
- `is_friend` derivado por follow mutuo
- búsqueda de usuarios
- followers/following
- playlists públicas en perfil
- affinity score con cache en DB
- páginas en `listen`:
  - `/people`
  - `/users/:username`
  - `/users/:username/followers`
  - `/users/:username/following`

Estado:

- funcional y bastante completo
- pendiente de calibración fina del algoritmo de affinity con datos de producción

### 4. Playlists colaborativas

Implementado:

- `owner + collab`
- visibilidad `public/private`
- `is_collaborative`
- members
- invites con link y QR
- aceptación de invite en `listen`
- surfaced en `Library`, `PlaylistCreateModal`, `Playlist`, perfiles públicos

Estado:

- bastante completo
- principal pendiente: más validación funcional con casos reales multiusuario

### 5. Jam sessions / shared queue

Implementado:

- creación de room
- invites por link y QR
- join por invite
- websocket por room
- eventos de queue add/remove/reorder
- sync de play/pause/seek
- end room
- control por roles `host/collab`
- UI de jam en `listen`

Estado:

- ya es una v1 usable
- sigue siendo el bloque más sensible y el que más necesita pruebas reales multiusuario

## Cambio de dirección importante: Navidrome -> Subsonic

### Lo que ya cambió

- existe `app/crate/api/subsonic.py`
- hay token dedicado para Subsonic por usuario
- `listen` ya eliminó la dependencia directa de Navidrome
- `admin` ha perdido gran parte de la UI acoplada a Navidrome
- varias superficies ahora dependen de endpoints nativos de Crate

### Lo que aún no está cerrado

Todavía quedan restos de Navidrome en backend y parte del dominio de playlists/integrations:

- `app/crate/navidrome.py`
- `app/crate/api/navidrome.py`
- referencias de sync/projection en playlists
- worker handlers de integración y proyección
- algunos stubs y rutas legacy en `app/crate/api/auth.py`

Conclusión:

- la dependencia ya no domina el producto
- pero la eliminación no está cerrada al 100% en backend

## Qué queda del plan original

### Pendiente real

1. Validación real de Apple Sign-In
2. Calibrar affinity con datos reales de producción
3. Probar jam sessions multiusuario de verdad
4. Limpiar restos legacy de Navidrome del backend
5. Revisar si los endpoints/admin flows que todavía hablan de Navidrome deben borrarse o reconducirse a Subsonic
6. Documentar el flujo definitivo de Subsonic tokens + clientes compatibles

### Pendiente menor / polish

1. UI social más profunda en `admin` si se quiere moderación o browsing social desde allí
2. más observabilidad en jam rooms
3. posible búsqueda futura por affinity

## Lectura honesta del estado

Si se mide solo contra el plan `identity/social/collaboration`, la rama está avanzada y bastante cerca de “feature complete”.

Si se mide contra el alcance real que tomó la rama, la parte que sigue abierta es esta:

- consolidar Subsonic como reemplazo real
- terminar de matar Navidrome en backend
- hacer validación runtime multiusuario de social + collab

## Recomendación

Cerrar en este orden:

1. limpiar backend legacy de Navidrome
2. validar Google + Apple + Subsonic token flow en runtime
3. probar jam/collab con 2 usuarios reales
4. ajustar affinity en producción
