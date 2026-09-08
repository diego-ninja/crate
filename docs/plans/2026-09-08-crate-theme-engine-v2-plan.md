# Crate Theme Engine v2 Implementation Plan

> **Status (2026-09-08): complete on `codex/listen-design-system`.** T00–T16
> are implemented and pushed. The release gate is local because PR #247 is
> still draft; GitHub does not emit the protected CI runs for draft changes.
> The final local evidence is recorded in
> `docs/technical/listen-design-system-visual-qa.md` and the hero operations
> gate in `docs/technical/artist-hero-theming-rollout.md`.

> **For agents:** REQUIRED SUB-SKILL: Use `viterbit-ai-tools:executing-plans` to implement this plan task-by-task. Read the current repository instructions before execution.

**Goal:** Evolucionar el motor de apariencia existente de Crate/Listen con personalización visible de colores, tipografía, superficies y densidad, previews aisladas y logo y hero compatibles con `default`/`crateRed` y `dark`/`light`/`system`. Entregar por fases verificables, conservando la identidad Crate y la navegación actual.

**Architecture:** Mantener `theme-skin.ts` como fachada compatible y extraer detrás un contrato de apariencia versionado, un resolver puro y una aplicación CSS por scope. La persistencia, el store activo y los adaptadores de plataforma quedan separados de la resolución; la densidad es una preferencia de presentación independiente del skin. El hero editorial separa contenido y artefactos de la apariencia; su manifiesto, renderer y rollout se entregan en una secuencia propia, incluida en el alcance total.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, CSS custom properties, Vitest/Testing Library, Playwright para contratos de navegador; FastAPI, Pydantic, PostgreSQL/Alembic, Dramatiq y Pillow/WebP para la línea posterior del hero.

---

## 1. Estado real y decisiones que gobiernan el plan

- Fecha de revisión: `2026-09-08`.
- Rama: `codex/listen-design-system`.
- Baseline actual: `370bf918` (`feat: harden bio research and gate AI controls`).
- La revisión inicial partía de `1cbe6022`. La implementación de esta
  evolución v2 está entregada en esta rama. Este documento conserva el diseño
  y el checklist de aceptación como registro de release.
- La rama ya contiene un refactor amplio del design system; cualquier tarea debe medir el drift contra el estado actual y no contra un snapshot histórico.
- `.decisions/theme-engine-v2/` contiene la comparación visual de esta
  iteración y está versionado junto con el registro de decisiones.

### 1.1 Qué ya existe

La implementación actual incluye:

1. `app/shared/ui/lib/theme-skin.ts` con `dark`, `light`, `system`, `default` y `crateRed`.
2. Variables explícitas para dark/light de ambos skins.
3. Persistencia y migración del formato anterior, incluido `aurora` → `crateRed`.
4. `ThemeSkinSection` en Listen con selector de modo y skin.
5. Inicialización en `app/listen/src/main.tsx` y suscripción para el Toaster.
6. Tests de resolver, persistencia, system mode, listener y selector.
7. `ArtistHeroFrame` y el contrato compartido de hero.
8. Migraciones de hero existentes `082`–`089`, renderer `cover-fit-v4`, rutas y workers de composición.

### 1.2 Decisiones ya tomadas

- Separación ortogonal entre theme y skin.
- Alcance confirmado por Diego: «Principalmente apariencia: colores, tipografía, superficies y densidad», más hero y logo sensibles al tema. La densidad cambia métricas acotadas de contenido; la estructura de navegación, el comportamiento y los mínimos táctiles permanecen estables.
- CSS custom properties + Tailwind semántico; inline solo para valores calculados legítimos.
- El default debe conservar la paridad perceptual con el Listen actual.
- La densidad `comfortable`/`compact` está incluida en el plan. Es independiente del skin y se entrega en la línea C; no requiere reabrir la decisión de alcance.

El alto contraste configurable y los colores hexadecimales libres quedan fuera de esta propuesta de entrega. Son límites técnicos propuestos, no decisiones de producto previamente confirmadas por el usuario.

### 1.3 Alcance de la primera línea de entrega

Incluye:

1. Rebaselining y guardrails del engine actual.
2. Contrato versionado y resolver puro detrás de la fachada existente.
3. Autoridad única para tokens semánticos y bridge runtime para Tailwind.
4. Controles de acento acotado, superficies, material, radios, tipografía, efectos y movimiento; preview scoped con Apply/Cancel/Reset sin efectos globales.
5. `dark`, `light` y `system` para `default` y `crateRed`.
6. Integración del modo con Toaster, visualizadores/canvas y superficies nativas que ya dependan del tema.
7. Logo dinámico únicamente donde sea seguro; los assets estáticos conservan su pipeline.
8. Tests de comportamiento, estilos computados y regresión visual del default.

Fuera de esta primera línea:

- Alto contraste configurable y `forced-colors` como feature de producto.
- Accent hexadecimal arbitrario introducido por el usuario.
- Densidad compacta: incluida en la línea C posterior, no excluida del plan.
- Manifiesto, renderer neutral y migración del hero: incluidos en D/E posteriores.
- Cambios estructurales de layout o variantes de navegación.
- Sincronización de preferencias con cuenta, marketplace, plugins o CSS arbitrario.
- Clon estructural de Apple Music.

---

## 2. Líneas de trabajo y orden de entrega

El plan queda dividido en entregas independientes para que una regresión visual del engine no quede mezclada con una migración de assets o de base de datos.

| Línea | Contenido | Entrega |
| --- | --- | --- |
| Mantenimiento | QR, Escape de modal, teclado de ShowCard | PR separado, no bloquea el engine |
| A | Theme engine core y tokens | Primera entrega obligatoria |
| B | Controles de personalización de Listen, system mode, canvas y logo | Después de A |
| C | Densidad `comfortable`/`compact` | Incluida; entrega separada después de A/B |
| D | Hero compartido Admin/Listen | Línea frontend posterior |
| E | Manifiesto, renderer neutral, publicación y migración | Línea backend posterior |
| QA | Drift, React Doctor, Playwright, documentación y rollout | Incremental en todas las líneas |

La línea E no debe entrar en el mismo PR que A/B. Tiene problemas de compatibilidad, storage, workers, snapshots y rollback suficientemente grandes para una release independiente.

Cerrar A/B no satisface por sí solo el objetivo completo: C y D/E siguen siendo entregas comprometidas. Después de A/B, C y D pueden avanzar por separado; E depende de D. T15 se incorpora desde A/B y se amplía con cada entrega, sin aplazar la verificación de navegador hasta el final.

### 2.1 Opciones descartadas

- Más presets de color sin contrato: insuficiente y reproduce el drift actual.
- Layouts alternativos por skin: futuro piloto aislado, no parte de v2.
- CSS-in-JS o estilos inline como API principal: contradice la decisión vigente.
- Accent hexadecimal libre en v2: se sustituye por una paleta tipada y acotada, con contraste validado por modo.

---

## 3. Diagnóstico corregido

| Evidencia actual | Riesgo | Línea |
| --- | --- | --- |
| `theme-skin.ts` ya aplica, persiste y publica aunque reciba un `root` alternativo | El preview puede contaminar Listen y `localStorage` | A |
| `ThemeSkinSection` aplica inmediatamente cada selección | No existe draft real para Cancel/Reset | B |
| `tokens/radius.css` usa literales en `@theme inline` | Las utilities compiladas pueden ignorar radios runtime | A |
| `colors.css`, `surfaces.css` y `semantic.css` tienen varias capas con valores propios | Múltiples autoridades y precedencia difícil de razonar | A |
| `crateRed.light` se construye extendiendo la estructura de default light | Riesgo de heredar identidad accidental; requiere mapas completos por preset | A |
| Canvas/visualizador y superficies nativas consumen colores en módulos separados | El cambio de modo puede quedar incompleto | B |
| Existe `ArtistHeroFrame`, contrato v1 y renderer `cover-fit-v4` | T08–T13 evolucionan el sistema existente | D/E |
| El renderer extend actual usa `Image.new("RGB", ..., (10, 10, 15))` | Padding negro horneado incompatible con superficies claras | E |
| Readiness del hero depende del prefijo del renderer actual | Un bump puede ocultar featured heroes válidos | E |
| Los tests actuales cubren clases, regex y mocks, pero no todos los estilos computados/scopes reales | Falsa confianza frente a regresiones visuales | QA |

Antes de implementar se debe ejecutar un nuevo baseline. Los números de una revisión histórica no son criterios de cierre.

---

## 4. Contrato de apariencia v2

### 4.1 Preferencias persistidas

Mantener los IDs `default` y `crateRed` y migrar el formato actual sin romper sesiones existentes.

```ts
type ColorModePreference = "dark" | "light" | "system";
type ResolvedColorMode = "dark" | "light";
type PresetId = "default" | "crateRed";
type AccentId = "cyan" | "red" | "violet";
type ContentDensity = "comfortable" | "compact";

interface AppearancePreferencesV2 {
  version: 2;
  mode: ColorModePreference;
  preset: PresetId;
  overrides: {
    accent?: AccentId;
    surfaceTone?: "neutral" | "warm" | "tinted";
    material?: "solid" | "glass";
    radius?: "subtle" | "rounded";
    typography?: "brand" | "system";
    effects?: "off" | "subtle" | "expressive";
  };
  presentation: {
    density: ContentDensity;
  };
  accessibility: {
    motion: "system" | "reduced";
  };
}
```

La paleta inicial propuesta ofrece cyan, red y violet, más «Del tema» mediante ausencia de override. Cada ID resuelve valores y foreground/estados por modo desde el registro; no acepta CSS ni hex arbitrarios. La aceptación visual y el contraste se validan en T04/T15 antes de publicar estos valores.

`presentation.density` existe desde el contrato v2 y migra a `comfortable`. A/B conserva y serializa el campo, pero los controles y las métricas compactas se entregan juntos en C. Así la fase C no exige otra migración del contrato ni cambia densidad al seleccionar un skin.

`ResolvedAppearance` contiene únicamente datos serializables: modo resuelto, preset, valores efectivos, variables CSS tipadas y metadatos de accesibilidad. No contiene `HTMLElement`, storage, callbacks, rutas ni estado de producto.

### 4.2 Precedencia

1. Foundations compartidas.
2. Preset y modo resuelto.
3. Overrides acotados del usuario.
4. Derivación de aliases semánticos y superficies.
5. Restricciones de movimiento y mínimos interactivos.

Cambiar preset conserva modo, overrides explícitos, densidad y accesibilidad; solo cambian los valores heredados «Del tema». Cambiar modo conserva las demás preferencias. «Restablecer personalización» limpia únicamente overrides del draft; mantiene preset, modo, densidad y movimiento. Cancel descarta el draft completo; Apply persiste y publica una única selección.

### 4.2.1 Storage, clientes antiguos y rollback

- Usar `crate.listen.appearance.v2` como nueva clave; mantener `crate.listen.theme-skin` para clientes antiguos. Nunca escribir el objeto v2 en la clave legacy.
- Leer primero v2 válido. Solo si está ausente, migrar `{mode, skin}` o `{theme, skin}` desde la clave anterior, incluido `aurora` → `crateRed`. La lectura es pura; el bootstrap persiste la migración una sola vez. Conservar la clave legacy y una copia inicial de su valor en `crate.listen.theme-skin.backup.v1` antes de proyectar cambios.
- Cada Apply v2 guarda primero v2 y después una proyección legacy `{mode, skin: preset}` como operación best effort. Si falla solo la proyección, v2 sigue siendo válida y no se revierte. Esta proyección permite arrancar un cliente antiguo con modo/preset compatibles; nunca es la autoridad para overrides, densidad o accesibilidad.
- Si un cliente antiguo cambia la proyección, v2 sigue prevaleciendo al volver a un cliente nuevo. No inferir una sincronización bidireccional entre formatos. El downgrade no muestra ajustes que desconoce, pero no elimina el payload v2.
- En la misma versión, conservar campos desconocidos al guardar mediante merge de campos conocidos validados; nunca convertir esos campos en tokens. El writer vuelve a leer el payload antes de guardar para distinguir ausente, compatible, corrupto o versión futura y preservar los campos que no controla.
- Ante una versión futura o un payload corrupto, usar defaults seguros en memoria sin sobrescribir el original durante bootstrap. Si el payload es corrupto, un Apply explícito puede recuperar el guardado: primero respaldar sus bytes en `crate.listen.appearance.corrupt-backup`, después guardar v2 válida; si falla el respaldo, no sustituir el original. No exigir al usuario editar `localStorage`. Una versión futura sigue intacta también en Apply y devuelve incompatibilidad explícita, sin degradarla silenciosamente.
- Devolver un resultado de persistencia explícito para distinguir guardado v2, fallo del guardado principal, fallo del respaldo e incompatibilidad; el fallo de la proyección legacy es secundario. Settings no comunica un guardado inexistente.
- Cubrir migración, carga repetida, recuperación de payload corrupto y fallo de su respaldo, versión futura, storage no disponible y ciclo cliente nuevo → antiguo → nuevo. Probar que el cliente antiguo solo sobrescribe su clave y que `crateRed`, overrides, densidad y motion v2 sobreviven.

### 4.3 Registro único de tokens

Crear un registro tipado que describa cada rol:

- nombre semántico;
- tipo (`color`, `length`, `font`, `shadow`, `gradient`);
- valor por defecto por modo/preset;
- si admite override;
- pares de contraste relevantes;
- owner y consumidores.

De este registro se derivan la allowlist, la validación y los tests. No mantener una lista independiente en `theme-skin.ts` y otra en CSS.

Separar explícitamente foundations, aliases semánticos, recetas de componente y slots de producto. Los colores de fotografías, logos de proveedores y datos musicales no se sustituyen indiscriminadamente.

### 4.4 API runtime

```ts
resolveAppearance(
  preferences: AppearancePreferencesV2,
  environment: AppearanceEnvironment,
): AppearanceResolution;

applyAppearanceToRoot(
  root: HTMLElement,
  appearance: AppearanceResolution,
): () => void;

readAppearancePreferences(storage: StorageReader): AppearancePreferencesV2;
writeAppearancePreferences(
  storage: StorageReader & StorageWriter,
  preferences: AppearancePreferencesV2,
): AppearanceWriteResult;
```

`resolveAppearance` es pura. `applyAppearanceToRoot` no escribe storage, no publica el store global, no fuerza `data-crate-app="listen"`, elimina únicamente sus propias variables y devuelve cleanup.

Mantener `theme-skin.ts` como fachada compatible durante la transición para no migrar todos los imports en un solo cambio. Sus operaciones de modo/skin deben fusionarse con las preferencias v2 vigentes; no reconstruir un objeto que pierda overrides, densidad o accesibilidad.

### 4.5 Store y scopes

- Listen tiene un único store activo compatible con `useSyncExternalStore`.
- Settings trabaja sobre un draft local y solo confirma al pulsar Apply.
- Admin puede usar el resolver en un scope local sin modificar el store de Listen.
- `ThemeScope` aplica variables, aliases y tipografía en un contenedor propio.
- Los portales deben recibir un contenedor dentro del scope o un scope explícito; no asumir que heredan variables desde un nodo arbitrario.
- La preview no altera Toaster, player, navegación, storage ni otros scopes.

Settings debe exponer los campos del contrato; no se considera entregada la personalización por añadir únicamente Apply/Cancel/Reset al selector actual:

| Control | Opciones | Entrega |
| --- | --- | --- |
| Modo y preset | Dark/light/system; default/crateRed | B |
| Acento | Del tema; cyan/red/violet | B |
| Tono de superficie | Del tema; neutral/warm/tinted | B |
| Material | Del tema; solid/glass | B |
| Radios | Del tema; subtle/rounded | B |
| Tipografía | Del tema; brand/system | B |
| Efectos | Del tema; off/subtle/expressive | B |
| Movimiento | Seguir sistema/reducir | B |
| Densidad de contenido | Comfortable/compact | C |

Cada control necesita etiqueta accesible, traducciones y una preview representativa con texto, botones, card, superficie y logo. Los valores «Del tema» eliminan su override; no copian el valor efectivo del preset. Probar por eje una selección distinta del default, Apply, Cancel, recarga y Reset, además de cambios de modo/preset con overrides activos.

### 4.6 Contraste y movimiento

La primera entrega valida contraste estándar sobre valores computados:

- texto normal: 4,5:1;
- texto grande: 3:1;
- controles, estados y focus: 3:1 cuando corresponda;
- transparencias sobre un backdrop declarado.

El movimiento efectivo se reduce si lo pide el sistema **o** el usuario; ningún preset ni `effects=expressive` puede desactivarlo. Probar también sistema sin reducción + preferencia explícita `reduced` y propagar el resultado a los consumidores actuales de movimiento. El alto contraste configurable queda fuera de v2; la compatibilidad futura con `forced-colors` no debe bloquearse mediante decisiones irreversibles.

---

## 5. Identidad visual y logo

`default` conserva la identidad actual. `crateRed` aporta una alternativa sobria inspirada en Apple Music mediante paleta, superficies, tipografía, radios y efectos, sin cambiar símbolo, navegación o comportamiento.

Antes de crear `CrateLogo`, revisar la decisión de marca existente. El componente debe conservar paths y `viewBox` canónicos, pero no asumir que los assets estáticos pueden tematizarse dinámicamente.

Reglas:

- SVG inline solo para usos dinámicos de la app.
- IDs de gradiente únicos por instancia.
- Sin `hue-rotate`, búsqueda de DOM externo ni recoloreado de `<img>`.
- Favicon, PWA, launcher, tray y exports conservan una receta estática explícita.
- `effects=off` y reduced motion simplifican aura/pulso sin eliminar el estado accesible.
- Loader y marca no deben reutilizar success/error/info como identidad de marca.

La ruta propuesta es `app/shared/ui/domain/brand/CrateLogo.tsx`, acompañada de tokens de marca en `app/shared/ui/tokens/semantic.css` o un archivo dedicado importado desde `index.css`. No crear `app/shared/brand` como dependencia paralela sin actualizar esta decisión.

---

## 6. Tareas de implementación

Cada tarea sigue TDD: prueba que falla, implementación mínima, suite focalizada, React Doctor y checks de calidad. Cada tarea es un commit independiente. La línea de hero posterior no empieza hasta cerrar A/B.

### T00. Rebaselining y registro del alcance

**Archivos:** `docs/plans/2026-09-08-crate-theme-engine-v2-plan.md`, `.decisions/theme-engine-v2/`, `docs/technical/listen-design-system-visual-qa.md`.

1. Ejecutar baseline sobre `370bf918`: typecheck, tests, build, drift, layers, React Doctor y `git diff --check`.
2. Registrar qué tokens, componentes, skins y contratos ya existen.
3. Registrar el alcance confirmado de apariencia, densidad, hero y logo; distinguirlo de los límites técnicos propuestos sobre high contrast y accent libre.
4. Mantener `.decisions/theme-engine-v2/` coherente con este documento y resolver su inclusión junto con la documentación antes del PR. Esta decisión editorial no bloquea T01.
5. Commit: `docs: rebaseline theme engine v2 plan`.

### T01. Contrato versionado y migración compatible

**Crear:** `app/shared/ui/lib/appearance-types.ts`, `app/shared/ui/lib/appearance-resolver.ts`, tests correspondientes.

**Modificar:** `app/shared/ui/lib/theme-skin.ts`, `app/shared/ui/lib/theme-skin.test.ts`.

1. Escribir tests de lectura de `{mode, skin}`, formato legacy `{theme, skin}`, JSON inválido, campos desconocidos, versión futura y defaults seguros.
2. Implementar el protocolo de claves de 4.2.1 con pruebas de migración única, preservación del backup, recuperación de payload corrupto mediante Apply, cliente antiguo sobrescribiendo su proyección, fallo de segunda escritura y ciclo downgrade → upgrade. Las lecturas no persisten ni destruyen payloads; el writer relee y valida antes de hacer merge o recuperar.
3. Escribir tests de resolución pura para modos/presets, cada override y `presentation.density`; migrar densidad ausente a `comfortable`.
4. Implementar tipos y resolver sin acceso a DOM/storage. Mantener la fachada y comprobar que cambiar modo/skin por la API antigua conserva los campos nuevos.
5. Verificar que no cambia la salida visual del default dark y que v2 válida prevalece sobre legacy tras reiniciar.
6. Ejecutar `npm run --workspace=app/shared/ui test -- theme-skin.test.ts appearance-resolver.test.ts` y typecheck; comprobar que ambos archivos se ejecutan.
7. Ejecutar React Doctor solo sobre los archivos nuevos/modificados.
8. Commit: `refactor: version appearance preferences behind theme facade`.

### T02. Autoridad de tokens y bridge Tailwind runtime

**Modificar:** `app/shared/ui/tokens/colors.css`, `radius.css`, `surfaces.css`, `semantic.css`, `themes.css`, `index.css` y `app/shared/ui/vitest.config.ts`.

**Crear:** `app/shared/ui/tokens/runtime-contract.test.ts`. Añadir `tokens/**/*.test.ts` a `test.include`; la configuración actual no descubre ese directorio.

1. Añadir el patrón de descubrimiento y ejecutar `npm run --workspace=app/shared/ui test -- tokens/runtime-contract.test.ts`: debe ejecutar el contrato y fallar por los literales actuales, no por «no tests found».
2. Cubrir `rounded-*`, colores y aliases de superficies cuyo valor debe cambiar en runtime con CSS compilado real.
3. Separar foundations, aliases y recetas sin cambiar todavía los consumidores de producto.
4. Mapear las utilities Tailwind a variables runtime con nombres distintos para evitar ciclos de variables.
5. Definir precedencia entre `data-surface="solid|glass"`, preset y scope.
6. Derivar aliases legacy desde tokens semánticos; no copiar valores por preset. Mantener excepciones editoriales documentadas.
7. Ejecutar contrato focalizado, build de `@crate/ui`, suite completa, drift y layers; confirmar que la suite completa también incluye `runtime-contract.test.ts`.
8. Commit: `refactor: make design tokens runtime resolvable`.

### T03. Aplicación scoped, controles y preview segura

**Crear:** `app/shared/ui/primitives/ThemeScope.tsx` y tests.

**Modificar:** `app/shared/ui/lib/theme-skin.ts`, `app/listen/src/components/settings/ThemeSkinSection.tsx`, `ThemeSkinSection.test.tsx`, catálogos `app/listen/src/i18n/catalogs/{en,es,ca,eu,fr,de,it}.json` y sus metadatos existentes; tests de shared UI.

1. Escribir tests donde aplicar una preview a un root alternativo no cambia `localStorage`, store global, eventos ni atributos del root principal.
2. Escribir tests de cleanup que restauren solo las variables aplicadas por el scope.
3. Implementar `applyAppearanceToRoot` sin side effects de producto.
4. Implementar un store único para Listen con `useSyncExternalStore`.
5. Convertir Settings a draft local con los controles de la tabla 4.5 correspondientes a B. Incluir opción «Del tema», etiquetas accesibles y traducciones; el control de densidad llega con sus consumidores en T07.
6. Implementar preview representativa y Apply/Cancel/Reset con la semántica de 4.2. Probar cada override distinto del default: aplicar, cancelar, recargar, restablecer y cambiar modo/preset. Comunicar fallos reales de persistencia sin fingir éxito.
7. Probar portal dentro y fuera del scope y que múltiples previews no cambian otros scopes ni playback.
8. Ejecutar tests de shared UI y Listen, typecheck, lint, `npm run --workspace=app/listen i18n:check` y React Doctor; validar controles con el harness inicial de T15 antes de cerrar B.
9. Commit: `feat: add scoped appearance controls and previews`.

### T04. Contraste, estados y preferencias de movimiento

**Modificar:** `app/shared/ui/lib/color-contrast.ts`, `app/shared/ui/lib/appearance-resolver.ts`, `app/listen/src/lib/motion-availability.ts`, tokens semánticos y tests.

1. Añadir casos de foreground destructivo, los tres acentos en ambos modos, superficies solid/glass y focus. Validar la paleta propuesta antes de ofrecerla en Settings.
2. Validar ratios sobre colores resueltos, no sobre nombres de clases.
3. Derivar foreground y estados con algoritmo determinista y límites explícitos.
4. Garantizar que reduced motion desactiva/simplifica efectos sin eliminar affordances. Cubrir sistema reducido + usuario system y sistema sin reducción + usuario reduced; integrar ambos orígenes con los consumidores de movimiento y logo, incluso con efectos expressive.
5. No implementar UI ni persistencia de `contrast: more`.
6. Ejecutar tests focalizados y la suite de shared UI.
7. Commit: `fix: validate resolved appearance contrast and motion`.

### T05. Integración de Listen, canvas y system mode

**Modificar:** `app/listen/src/main.tsx`, `app/listen/src/index.css`, `app/listen/src/components/player/visualizer-color-tokens.ts`, sus tests y los adaptadores nativos que consuman `colorScheme`/theme-color.

1. Escribir tests de cold boot en light, cambio live de system mode y cambio de skin durante playback.
2. Hacer que canvas/visualizadores lean tokens resueltos al cambiar apariencia, nunca por frame.
3. Sincronizar Toaster, `meta[name="theme-color"]` y superficies nativas que ya estén bajo responsabilidad de Listen.
4. Comprobar que cambiar apariencia no remonta providers ni pierde cola, pista, posición, navegación o selección.
5. Ejecutar suite Listen, build y React Doctor.
6. Commit: `feat: apply appearance changes across listen surfaces`.

### T06. Logo dinámico y consumidores

**Crear:** `app/shared/ui/domain/brand/CrateLogo.tsx` y tests.

**Modificar:** consumidores dinámicos de logo en Listen/Admin y tokens de marca.

1. Escribir tests de geometría/viewBox, dos instancias simultáneas y IDs únicos.
2. Implementar la receta dinámica sin modificar favicon/PWA/tray.
3. Migrar solo usos de navegación, loader y marca dentro de la app; dejar assets estáticos intactos.
4. Probar tamaños 16/24/32/64 px, effects off y reduced motion.
5. Ejecutar typecheck, tests, build, React Doctor y revisión visual del default.
6. Commit: `feat: add scoped theme-aware crate logo`.

### T07. Densidad de contenido — incluida, entrega C

La densidad ya forma parte del alcance confirmado. Se entrega después de A/B con control y consumidores juntos, independientemente del skin, sin una nueva decisión de producto.

**Modificar:** `app/listen/src/components/cards/{TrackRow,TrackRowParts,AlbumCard,ArtistCard}.tsx`, `app/shared/ui/domain/lists/{MediaGrid,MediaRail}.tsx`, `app/listen/src/components/ui/WindowVirtualList.tsx`, `app/listen/src/pages/LibraryLikedTab.tsx`, `app/listen/src/components/playlists/{PlaylistTrackList,CuratedPlaylistTrackList}.tsx`, `ThemeSkinSection.tsx`, tokens de métricas y sus tests. Revisar overrides locales en `HomeAlbumRails.tsx`, `HomeRadioRails.tsx` y `HomeDiscoveryRails.tsx`. No cambiar geometría del player/dock ni safe areas.

1. Extraer baseline `comfortable` con métricas explícitas de filas, padding, cards, gaps y gutters; preservar la apariencia actual por defecto.
2. Escribir tests de compact para no solapar filas ni romper anclas del virtualizador. Actualizar estimaciones hoy fijadas a 72 px, invalidar medidas al cambiar densidad y conservar la posición visible.
3. Implementar métricas acotadas de contenido, sin root scaling ni `transform: scale`. Respetar mínimos táctiles; reducir espacios externos cuando el control ya alcance su mínimo.
4. Exponer comfortable/compact en el draft de Settings usando `presentation.density` de v2. Probar Apply/Cancel, recarga y persistencia al cambiar skin/modo; Reset de overrides no cambia densidad.
5. Verificar objetivos táctiles, keyboard navigation, responsive y listas cortas/largas, incluida la virtualización propia de CuratedPlaylistTrackList.
6. Ampliar T15 con ambas densidades y ejecutar suites Listen, i18n y Playwright antes de cerrar C.
7. Commit: `feat: add opt-in content density preference`.

---

## 7. Línea D: hero frontend independiente de la apariencia

Esta línea reutiliza lo que ya existe en `app/shared/ui/domain/ArtistHeroFrame.tsx`, `app/shared/web/artist-hero-contract.ts`, `app/ui/src/components/artist/HeroCompositionCanvas.tsx` y sus tests. No crea un sistema paralelo de hero.

### T08. Unificar presentación compartida Admin/Listen

**Modificar:** `app/shared/ui/domain/ArtistHeroFrame.tsx`, `app/listen/src/components/home/{HomeDiscoveryHero,HomeCanonicalHero,HomeHeroContent,HomeLegacyHero}.tsx`, `app/listen/src/components/home/home-hero-utils.ts`, consumidores de hero en Artist, `app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx` y tests. `HomeDiscoverySections.tsx` es una fachada de reexports; modificar los consumidores reales.

1. Escribir pruebas de paridad para mismo asset, viewport, bounds y apariencia.
2. Compartir roles de superficie, foreground, scrim, CTA y géneros.
3. Mantener routing, callbacks y semántica accesible en cada aplicación.
4. Eliminar fondos fijos de Konva y dobles scrims; el frame usa tokens del scope. Definir un único cálculo de fit/posición para la imagen y sus bounds, compartido con la preview; no mezclar `object-cover` en Admin y `object-fill` en Listen.
5. Mantener un fallback visual legacy hasta E: con bounds fiables, enmascarar únicamente el padding exterior; sin ellos, mostrar la composición existente en un panel editorial oscuro contenido con texto seguro. Nunca borrar píxeles por semejanza a negro ni deformar la fotografía para ocultar bordes.
6. Probar fotos claras/oscuras, crop, extend, bounds ausentes y legacy. La entrega D conserva los assets RGB anteriores; no se considera resuelto el renderer neutral hasta E.
7. Commit: `refactor: share theme-aware artist hero presentation`.

### T09. Preview de composición aislada

**Modificar:** `app/ui/src/components/artist/ArtistHeroArtworkEditor.tsx`, `HeroCompositionCanvas.tsx`, `hero-composition-geometry.ts`, `hero-image-treatment.ts` y tests.

1. Probar cambio local de tema sin modificar recipe, source, dirty state, storage o requests.
2. Usar scope propio y fondo transparente para Konva. Simular el tamaño real del contenedor destino (incluidas alturas móviles variables) y resolver responsive por ese contenedor, no por el viewport del Admin.
3. Probar reabrir composición persistida sin re-upload y sources desktop/mobile diferentes.
4. Rechazar previews de recetas obsoletas sin publicar nada.
5. Ejecutar tests UI focalizados, typecheck, build y React Doctor.
6. Commit: `feat: isolate admin artist hero appearance previews`.

---

## 8. Línea E: hero backend, manifiesto y migración

Esta línea es una release independiente. Se ejecuta solo después de validar D y conservar un reader legacy operativo.

### T10. Manifiesto versionado y contrato compatible

**Crear:** nueva revisión Alembic, solo si el número sigue libre; tests de manifiesto.

**Modificar:** `app/crate/db/repositories/artist_hero_artwork.py`, `app/crate/api/schemas/artist_hero.py`, `app/crate/artist_hero_contract.py`, `app/shared/web/artist-hero-contract.ts`.

1. Probar perfil actual sin manifiesto, perfil con manifiesto y contratos públicos v1/v2.
2. Añadir JSONB nullable y distinguir rutas internas de URLs públicas.
3. Definir `renderer_version`, `render_revision`, `source_fingerprint`, `recipe_hash`, `relative_path` interno y URL pública derivada.
4. Separar revisión editorial de revisión de artefacto.
5. Sustituir el readiness basado únicamente en prefijo por una política de versiones soportadas.
6. Mantener approvals, provenance, featured y flags existentes.
7. Commit: `feat: version published artist hero artifacts`.

### T11. Renderer neutral con alpha

**Modificar:** `app/crate/artist_hero_artwork.py`, `app/crate/artwork_materializer.py`, `app/crate/worker_handlers/artwork.py` y tests.

1. Escribir fixtures RGB claras/oscuras con negro legítimo dentro de la fotografía.
2. Probar alpha cero fuera del artwork y conservación de contenido dentro.
3. Cambiar únicamente el canvas extendido a RGBA/transparente; no alterar crop ni tratamiento editorial.
4. Probar guardar/reabrir WebP, reescalado 2× y composición sobre fondo claro/oscuro.
5. Preview y persistencia deben compartir renderer; el skin nunca participa en el output.
6. Commit: `feat: render theme-neutral artist hero artwork`.

### T12. Publicación segura y delivery compatible

**Crear:** `app/crate/artist_hero_publication.py`, `app/tests/test_artist_hero_publication.py`.

**Modificar publicación y delivery:** `app/crate/worker_handlers/artwork.py`, `app/crate/db/repositories/artist_hero_artwork.py`, `app/crate/artwork_sources.py`, `app/crate/artwork_tasks.py`, `app/crate/artwork_materializer.py`, `app/crate/artwork_variants.py`, `app/crate/artwork_maintenance.py`, `app/crate/api/browse_artist.py`, `app/crate/api/artwork_delivery.py`.

**Modificar snapshots:** `app/crate/db/queries/home_catalog.py`, `app/crate/db/home_builder_discovery_queries.py`, `app/crate/artist_hero_contract.py`; adaptar el contrato de `app/readplane/internal/routes/home_discovery_response.go` solo si lo requiere el payload nuevo.

**Tests existentes:** `app/tests/test_artist_hero_artwork.py`, `app/tests/test_artist_hero_composition_delete.py`, `app/tests/test_artwork_sources.py`, `app/tests/test_artwork_tasks.py`, `app/tests/test_artwork_materializer.py`, `app/tests/test_artwork_variants.py`, `app/tests/test_artwork_variant_cleanup.py`, `app/tests/test_artwork_route_delivery.py`, `app/tests/test_browse_artist_api.py`, `app/tests/test_artwork_read_path_purity.py`, `app/tests/test_artist_hero_contract.py`, `app/readplane/internal/routes/home_discovery_response_test.go`.

1. Añadir pruebas de concurrencia con interleavings controlados: upload entre lectura de perfil y fuente, edición/delete durante render, cambio de fuente sin revisión DB todavía visible, dos publicaciones técnicas con la misma revisión editorial y retry duplicado. Ningún resultado puede mezclar fuente/receta de ediciones distintas, resucitar un slot borrado ni sustituir una publicación posterior.
2. Coordinar upload, compose, delete y recompose con el mismo mecanismo por artista. Capturar perfil, manifest esperado, flags, recetas y bytes/fingerprints de las fuentes bajo una sección breve. Escribir fuentes mediante staging y publicación atómica en rutas por revisión/fingerprint, sin sobrescribir la fuente activa antes de asociarla al perfil; un crash no debe dejar receta antigua apuntando a bytes nuevos. Renderizar fuera de la transacción y de esa sección; antes de publicar, volver a comprobar bajo la misma coordinación revisión editorial, manifest, fingerprints, recetas y flags. Un cambio invalida el trabajo preparado.
3. Introducir una identidad compartida de asset formada por artista + composición + revisión de artefacto en el resolver, materializer, delivery y dedup de tareas. Resolver la fuente desde el artefacto inmutable de esa revisión; no desde `artist-hero-{composition}.webp`. El `current.json` que publica hoy el materializer debe quedar dentro de ese namespace por revisión, sin activar la revisión del perfil.
4. Preparar artefactos, variantes y sidecars inmutables antes del CAS. Persistir de forma durable el manifest nuevo, el manifest anterior y sus mappings revisión → asset antes de sustituir el puntero DB. En la primera adopción legacy, retener los bytes existentes y registrar solo la asociación histórica que pueda verificarse; no inventar mappings para versiones antiguas desconocidas.
5. Activar el manifest mediante una única transacción con CAS de revisión editorial y manifest activo esperado, después de las revalidaciones del paso 2. La publicación técnica conserva approvals, provenance, featured y flags. Un CAS fallido deja artefactos inactivos para cleanup; nunca modifica el perfil ni el asset activo.
6. Invalidar caches y refrescar snapshots únicamente después del commit, agrupando scopes cuando se migre un lote. Probar crash tras artefactos pero antes de sidecars, tras sidecars pero antes del CAS, y tras CAS pero antes de invalidación. El retry debe reconocer una publicación propia ya activa, completar la invalidación pendiente sin republicar y mantener disponible el manifest anterior.
7. Resolver realmente `v`/revisión explícita en `browse_artist.py` contra los sidecars retenidos. Probar snapshot A → publicación B → lectura explícita de A con bytes y ETag A, también tras materializar B. Mantener comprobaciones actuales de auth, review y composición habilitada; no servir B bajo una URL que promete A. El legacy sin mapping verificable usa un fallback explícito sin prometer inmutabilidad histórica.
8. Hacer que Home lea el manifest y derive sus composiciones del contrato canónico, sustituyendo la construcción v1 y el readiness por prefijo duplicados en `home_builder_discovery_queries.py`. Probar snapshots legacy y nuevos a través de API/readplane, incluidos los snapshots anteriores a una publicación.
9. Ajustar retención y cleanup para proteger manifest activo, manifiestos retenidos, sus variantes y referencias necesarias para rollback/snapshots; el cleanup actual de «current + una anterior» no basta. Medir huérfanos, CAS rechazados, fallback y fuentes ausentes con métricas/alertas Sentry. Verificar que las lecturas no escriben filesystem ni provocan recomposición.
10. Ejecutar las suites Python indicadas y el contrato Go de Home; todos los casos de concurrencia, crash, entrega por revisión y retención deben quedar verdes antes de habilitar el writer.
11. Commit: `fix: publish hero renders against current editorial revision`.

### T13. Migración canary y rollback

**Crear:** `app/tests/test_artist_hero_migration.py`.

**Modificar:** `app/crate/actors.py`, `app/crate/task_registry.py`, `app/crate/worker_handlers/artwork.py`, `app/crate/artist_hero_publication.py`, `app/crate/db/repositories/artist_hero_artwork.py`, `docs/technical/artwork-delivery.md`; ampliar `app/tests/test_artist_hero_artwork.py`, `app/tests/test_artist_hero_composition_delete.py` y `app/tests/test_artist_hero_publication.py`.

1. Añadir dry-run reanudable con cursor, límites, dedup por objetivo de migración/revisión esperada y razones de skip por fuente o receta ausente. Priorizar perfiles manuales aprobados sin convertirlos en derivados; no reutilizar el backfill que cambia provenance/review.
2. Migrar técnicamente todas las composiciones habilitadas de un perfil en una sola publicación de manifest. Si falta una fuente o receta, no publicar parcialmente ni avanzar una revisión global: conservar íntegros manifest/artefactos legacy, approvals y featured y devolver un skip observable. No recomponer desde lecturas ni generar variantes por usuario o theme.
3. Mantener separadas las ediciones dirigidas a un slot: upload/compose de desktop actualiza desktop y conserva el manifest de mobile, y viceversa. La falta de fuente del slot no editado no bloquea la edición. Delete elimina solo el slot solicitado y aplica las reglas editoriales existentes; un job anterior no puede restaurarlo.
4. Probar el par completo, solo una composición habilitada, fuente/receta ausente en una de dos habilitadas, fuente legacy compartida, retry y reanudación con edición concurrente. Verificar que la migración publica todo el par o nada y que las ediciones dirigidas preservan el otro slot.
5. Probar rollback usando el manifest anterior durable de T12: CAS sobre revisión editorial **y manifest activo esperado**, sin modificar aprobación o featured. Cubrir A → B → C con la misma revisión editorial: rollback de B debe rechazarse cuando C ya está activo. Cubrir también edición/delete posterior, crash y retry de rollback; los artefactos retenidos deben seguir resolviéndose.
6. Ejecutar canario con crop/extend, desktop/mobile, fotografías claras/oscuras y perfiles legacy sin fuente. Comparar geometría, approvals, featured, visibilidad y fallback antes/después; comprobar reanudación y rollback antes de ampliar el lote.
7. Documentar cursor, skips, dedup, retención y procedimiento de rollback en `docs/technical/artwork-delivery.md`. Solo después del canario, activar lotes limitados y observables mediante workers, respetando backpressure y agrupando invalidaciones posteriores al commit.
8. Ejecutar los tests de migración/publicación y las regresiones de upload/compose/delete antes de habilitar lotes generales.
9. Commit: `feat: migrate artist heroes with resumable rollback`.

---

## 9. Calidad, guardrails y QA visual

### T14. Guardrails incrementales

**Modificar:** `scripts/design-system/drift-inventory.mjs`, `layer-inventory.mjs`, tests y workflows de frontend.

1. Resolver imports reales y aliases antes de comprobar capas.
2. Añadir contrato de CSS compilado para que las utilities runtime no horneen valores configurables.
3. Mantener excepciones con owner y motivo.
4. Ejecutar después de cada corte:

```bash
node --test scripts/design-system/*.test.mjs
npm run design-system:layers
npm run design-system:drift
git diff --check
```

5. Ejecutar React Doctor limitado a los archivos modificados; los findings preexistentes de otra rama no bloquean el diff nuevo.
6. Commit: `test: enforce appearance and layer contracts`.

### T15. Playwright de apariencia

**Crear:** `playwright.appearance.config.ts`, `tests/appearance/fixtures.ts`, harness de navegador en `tests/appearance/harness/` y specs `contracts.spec.ts`, `settings.spec.ts`, `logo.spec.ts`, `scopes.spec.ts`, `materials.spec.ts`; ampliar con `density.spec.ts` en C y `hero.spec.ts` en D/E.

**Modificar:** `package.json`, `package-lock.json`, `.github/workflows/test-frontend.yml` y `.gitignore` para reports/resultados generados. No existe actualmente una suite Playwright del proyecto que pueda darse por configurada.

1. Instalar `@playwright/test` como devDependency raíz con `npm install -D @playwright/test`; registrar script `test:appearance` con `playwright test --config=playwright.appearance.config.ts`. Configurar proyectos llamados `chromium` y `webkit`, `webServer` para el harness y artefactos en `playwright-report/appearance/` y `test-results/appearance/`.
2. Servir componentes y CSS reales desde el harness fuera de rutas de producción. Usar datos deterministas; mockear red/datos, no CSS ni renderer. Los fixtures raster de hero se generan con el renderer real y se conservan como fixtures verificables.
3. Incorporar los contratos de A/B antes de cerrar esa entrega: default/crateRed × dark/light, cada acento y override con un valor no-default, system live, solid/glass, dos scopes, portal, cold boot light, teclado y movimiento reducido tanto por sistema como por usuario.
4. Ampliar en C con ambas densidades y ancla de listas virtualizadas; en D/E, con fotos claras/oscuras, crop/extend, legacy y fuentes separadas. Usar viewports 375, 430, 1024, 1200, 1480 y ultrawide sin un producto cartesiano innecesario: matriz base completa de modos/presets y casos dirigidos para cada eje.
5. Añadir job Chromium obligatorio en `.github/workflows/test-frontend.yml`: `npm ci`, `npx playwright install --with-deps chromium`, `npm run test:appearance -- --project=chromium`. Añadir `playwright.appearance.config.ts` y `tests/appearance/**` a **ambos** filtros de paths, push y pull_request. Subir reports/traces en fallos.
6. Reservar el proyecto WebKit para `hero.spec.ts`, `scopes.spec.ts` y `materials.spec.ts`; instalar WebKit y ejecutar `npm run test:appearance -- --project=webkit` antes de cerrar entregas que afecten a esos contratos. Registrar la evidencia aunque no se ejecute toda la matriz WebKit en cada PR.
7. Aprobar baselines manualmente y no actualizar snapshots para ocultar drift. Comprobar que cambiar solo un spec/config dispara CI y que el resumen incluye tests realmente ejecutados, sin skips que sustituyan los criterios de cierre.
8. Commit inicial: `test: add browser coverage for appearance contracts`; ampliar specs junto a cada línea posterior.

### T16. Documentación y cierre por release

**Crear/modificar:** `docs/technical/listen-design-system-visual-qa.md`, `docs/technical/artist-hero-theming-rollout.md`, documentación de frontends y este plan.

Documentar por separado:

- cómo crear un preset sin duplicar tokens;
- cómo añadir un token/slot y su owner;
- cómo usar `ThemeScope` y portales;
- controles de personalización, paleta acotada y densidad independiente;
- claves de preferencias, migración, proyección legacy y comportamiento ante downgrade/futuros formatos;
- criterios de visual QA;
- operación del renderer, retención, canary y rollback del hero.

No marcar el plan completo como terminado hasta cerrar A/B, C y D/E con sus pruebas y entregas. Actualizar el registro de decisiones sin convertir detalles técnicos propuestos en decisiones del usuario ni volver opcional el alcance confirmado.

---

## 10. Verificación

### Theme engine y Listen

```bash
npm run --workspace=app/shared/ui typecheck
npm run --workspace=app/shared/ui test -- tokens/runtime-contract.test.ts
npm run --workspace=app/shared/ui test
npm run --workspace=app/shared/ui build
npm run --workspace=app/listen typecheck
npm run --workspace=app/listen lint
npm run --workspace=app/listen i18n:check
npm run --workspace=app/listen test
npm run --workspace=app/listen build
node --test scripts/design-system/*.test.mjs
npm run design-system:layers
npm run design-system:drift
npm run test:appearance -- --project=chromium
git diff --check
```

### Admin y hero

```bash
npm run --workspace=app/ui typecheck
npm run --workspace=app/ui test
npm run --workspace=app/ui build
PYTHONPATH=app .venv/bin/python -m pytest app/tests/test_artist_hero_contract.py app/tests/test_artist_hero_artwork.py app/tests/test_artist_hero_publication.py app/tests/test_artist_hero_migration.py app/tests/test_artist_hero_composition_delete.py -q
npm run test:appearance -- --project=chromium
npm run test:appearance -- --project=webkit
```

Los comandos corresponden al cierre de cada entrega tras crear las pruebas previstas; no son afirmaciones de que esas pruebas o scripts existan hoy. Al configurar un entorno de navegador nuevo, ejecutar `npx playwright install chromium webkit`; en CI usar `--with-deps` para el navegador del job. Un resultado «no tests found» o un spec requerido omitido no cumple el cierre.

Para cambios backend completos usar `make dev-test-backend` con DB aislada. Nunca ejecutar migraciones de prueba contra producción.

### Criterios de cierre de la línea A/B

- [x] Default mantiene identidad y paridad visual actuales.
- [x] `crateRed` tiene dark/light explícitos y no depende accidentalmente de default.
- [x] Mode/preset funcionan sin duplicar providers ni perder playback/navigation state.
- [x] Preview, Cancel, Apply y Reset no contaminan otros scopes.
- [x] Todos los controles de B están visibles, traducidos y cubiertos con valores no-default, recarga y cambios de preset; no basta el selector modo/skin.
- [x] Acentos y foreground/estados pasan contraste en ambos modos y materiales; «Del tema» hereda y Reset limpia solo overrides.
- [x] Migración y ciclo nuevo → antiguo → nuevo preservan preferencias v2; bootstrap no sobrescribe versiones futuras/payloads corruptos. Apply recupera un payload corrupto solo tras respaldarlo y los fallos de guardado son explícitos.
- [x] CSS computado demuestra que radios, superficies, tipografía y colores runtime llegan a consumidores reales.
- [x] Toaster, canvas y theme-color siguen el modo activo.
- [x] Reduced motion respeta sistema o selección explícita del usuario, incluidos logo y efectos expressive.
- [x] Assets estáticos de marca no se regeneran ni se rompen.
- [x] Vitest descubre los contratos de `tokens/`; Playwright Chromium se ejecuta en CI y WebKit verifica scopes/materiales. React Doctor, typechecks, builds, drift, layers y lint están verdes.

### Criterios de cierre de la línea C

- [x] Comfortable conserva el baseline; compact modifica filas/cards/gaps/gutters sin cambiar estructura de navegación, player/dock o safe areas.
- [x] Densidad aplica, cancela y persiste desde Settings; cambiar modo/preset no la restablece.
- [x] Los virtualizadores actualizan estimaciones y medidas sin solapamientos ni pérdida del ancla visible.
- [x] Mínimos táctiles, teclado y responsive siguen funcionando en ambas densidades.
- [x] Tests de consumidores y Playwright cubren C; no se cierra el plan dejando la densidad como fase opcional.

### Criterios de cierre de la línea D/E

- [x] Listen y Admin presentan el mismo hero para asset, viewport y apariencia equivalentes.
- [x] No hay padding negro añadido por el renderer extend.
- [x] Legacy sin manifiesto sigue visible mediante fallback explícito.
- [x] Preview y Listen usan la misma geometría y bounds en el tamaño real del contenedor; el fallback legacy conserva negro legítimo de la foto.
- [x] Jobs obsoletos no publican sobre ediciones nuevas ni resucitan composiciones borradas.
- [x] Captura fuente/receta coherente y revalidación al publicar cubren todos los writers; render/materialización quedan fuera de la transacción.
- [x] Resolver, materialización y dedup aíslan revisiones; un job cuyo CAS falla no cambia assets servidos ni el manifest activo.
- [x] La migración publica juntas todas las composiciones habilitadas o conserva el bundle legacy; editar un slot preserva el otro.
- [x] Lecturas API/readplane no escriben filesystem.
- [x] URLs/versiones/ETags y retención son coherentes.
- [x] Canary y rollback han sido probados antes de cualquier migración masiva.
- [x] Manifest anterior y assets necesarios son durables antes del CAS; rollback exige editorial y manifest esperado y rechaza pisar otra publicación técnica.
- [x] Sentry y métricas cubren CAS, fallback, missing source, cleanup y jobs obsoletos.

---

## 11. Rendimiento y rollout

- No leer estilos de canvas por frame; actualizar solo al cambiar apariencia.
- No remontar visualizadores completos para cambiar una paleta.
- No añadir variantes raster por theme.
- No aplicar `transform: scale` ni cambiar el font-size raíz.
- Mantener lazy loading de fuentes/assets.
- Respetar backpressure de workers y colas de playback.
- Medir peso de WebP con alpha y crecimiento de storage antes y después.

Orden de producción para la línea E:

1. Reader compatible y migración de esquema aditiva.
2. Frontend capaz de leer legacy y manifiesto nuevo.
3. Writer neutral desactivable.
4. Canary de perfiles aprobados.
5. Rollback probado.
6. Migración gradual, reanudable y observable.
7. Retirada futura de compatibilidad antigua solo cuando clientes cacheados, cobertura y retención lo permitan.

Rollback del engine: el cliente anterior usa exclusivamente la proyección `crate.listen.theme-skin`, o su backup inicial si se necesita restaurarlo. No eliminar ni reescribir `crate.listen.appearance.v2`; al volver a v2, recuperar el payload completo. Probar la operación con el runtime antiguo real o una fixture congelada de su contrato, no solo con el migrador nuevo.

Rollback del hero: desactivar el writer nuevo y restaurar el manifest anterior, persistido de forma durable antes de la publicación, mediante CAS de revisión editorial **y manifest activo esperado**. Si una edición, delete u otra publicación técnica ha cambiado esas condiciones, rechazar el rollback para ese perfil. Mantener artefactos/sidecars retenidos y el reader compatible; invalidar caches/refrescar snapshots después del commit. Nunca revocar approval o featured como efecto colateral.

---

## 12. Referencias y decisiones pendientes

Referencias internas:

- diseño del 2026-08-26;
- decisiones `decision-001`, `decision-003` y `decision-007`;
- plan de modo/skins del 2026-09-06;
- contratos y migraciones de hero ya existentes;
- `.decisions/theme-engine-v2/index.html`.

Referencias externas:

- [Tailwind: theme variables y referencias runtime](https://tailwindcss.com/docs/theme#referencing-other-variables);
- [WCAG: contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html);
- [Apple Music para Mac](https://support.apple.com/en-nz/guide/music/welcome/mac), solo como referencia visual.

El alcance de apariencia, densidad, hero y logo está confirmado y entregado.
Esta revisión incorpora las correcciones solicitadas y deja el plan cerrado;
los detalles operativos viven en las guías técnicas enlazadas arriba.

Durante la ejecución se validan la paleta acotada y la receta dinámica del logo mediante T04/T06/T15, respetando la geometría canónica y los assets estáticos. No son motivos para volver a preguntar si se incluye el logo o la densidad. La exclusión de alto contraste configurable y accent hexadecimal libre es el límite propuesto de esta entrega.

Antes del PR, resolver cómo versionar este plan y `.decisions/theme-engine-v2/`: `docs/plans/` está ignorado actualmente. Incluirlos de forma intencional si deben acompañar el cambio; no declarar que están en el diff solo por existir en disco. Mantener la división A/B, C y D/E con los criterios de cierre anteriores.
