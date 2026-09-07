# Listen Design System: diseño validado

**Estado:** Validado
**Fecha:** 2026-08-26
**Ámbito:** `app/listen` y las piezas de `@crate/ui` que deban compartir contrato

## 1. Contexto y objetivo

El documento anterior de design system queda obsoleto y no se reutiliza. Este diseño parte del estado real del Listen actual: dark theme, acentos cyan, superficies glass, Poppins, Solar icons, Tailwind 4, tokens CSS compartidos y una mezcla de primitives, shadcn, composites y componentes de dominio.

El objetivo es completar el sistema visual y dejar Listen limpio sin cambiar su IA ni su comportamiento funcional. El aspecto actual se convierte en `dark + default`; la migración puede consolidar valores equivalentes y corregir problemas de contraste o responsive, pero no debe introducir un rediseño silencioso.

El inventario inicial —candidato, no veredicto automático— encontró 512 archivos frontend, 65 archivos con colores directos y 377 ocurrencias, 1.115 utilities de color potencialmente hardcoded, 98 bloques inline y 142 colores directos en shared UI. Estos números deben convertirse en una métrica automatizada de tendencia, no en una limpieza mecánica.

## 2. Decisiones validadas

| Área | Decisión |
|---|---|
| Tokens | Contrato semántico con primitives controladas y resolver runtime ligero. |
| Ejes visuales | `theme` y `skin` independientes y combinables mediante una matriz soportada. |
| Superficie de skin | Paleta, superficies, radios, sombras, tipografía de marca y efectos decorativos. No layout ni comportamiento. |
| Default | Paridad perceptual: se conserva identidad y jerarquía, no duplicación accidental. |
| Gobernanza | Registry, lint, allowlist con motivo y CI. |
| Componentes | Primitives → composites → domain, con contratos, slots y ownership explícitos. |
| CSS | CSS custom properties como runtime y Tailwind semántico como consumo normal. |
| Migración | Cortes verticales con inventario, tests, revisión visual, accesibilidad y rollback por PR. |

## 3. Arquitectura visual

### 3.1 Tokens

El sistema tendrá tres niveles prácticos:

1. **Primitives controladas:** valores base de color, escala tipográfica, spacing, radios, sombras y motion. No deben consumirse directamente desde features salvo excepciones documentadas.
2. **Tokens semánticos:** intención de uso (`surface-app`, `surface-panel`, `text-primary`, `text-muted`, `border-subtle`, `accent-action`, `state-success`, `focus-ring`, etc.). Los componentes consumirán esta capa.
3. **Slots de componente:** solo cuando un componente tenga una necesidad estable que no deba exponerse como primitive global (`player-progress-fill`, `modal-backdrop`, `row-selected`). Deben derivar de semánticos y no convertirse en una paleta paralela.

El registry debe poder indicar nombre, descripción, tipo, valor default, themes/skins que lo sobrescriben, contraste esperado y si admite override runtime. Los valores dinámicos de audio, artwork y canvas no se fingirán como tokens estáticos.

### 3.2 Theme y skin

El runtime mantendrá dos identificadores independientes:

- `theme`: modo de lectura y accesibilidad (`dark`, futuro `light`, `high-contrast` si se valida).
- `skin`: identidad visual (`default` inicialmente y futuros skins curados).

La combinación inicial será `dark + default`. El resolver validará la combinación, aplicará fallback seguro y actualizará atributos de scope como `data-crate-app="listen"`, `data-crate-theme` y `data-crate-skin`. Persistirá la elección localmente; la sincronización de cuenta queda fuera de este corte.

El resolver no generará estilos por componente. Gestionará registro, selección, persistencia, fallback y aplicación de variables CSS. No habrá CSS-in-JS ni editor libre de colores.

### 3.3 Scope compartido

`@crate/ui` es usado por Admin y Listen. Los tokens y primitives compartidos deben evolucionar con scope explícito para que un skin de Listen no modifique Admin. La capa compartida contendrá contratos neutrales; los overrides de Listen vivirán bajo el scope de la app. Cualquier cambio de token compartido requiere revisar ambos consumidores.

## 4. Arquitectura de componentes

Las capas serán:

- **Primitives:** Button, IconButton, Modal, Popover, Input, Select, Tabs, Badge, Card y estados básicos. No conocen APIs, routing ni contextos de producto.
- **Composites:** PlayerBar, TrackRow, ShowCard, SearchField, QueuePanel y bloques que combinan primitives. Reciben datos y callbacks con contratos tipados.
- **Domain:** componentes musicales o de dominio que pueden conocer el modelo de UI de Listen, pero no deben mezclar fetching, mutaciones y estilos arbitrarios.
- **Features/pages:** orquestan datos, routing y composición. No deben redefinir primitives ni copiar estilos de otra pantalla.

Los componentes compartidos se publicarán en `@crate/ui` solo si los consumen ambas apps. Los específicos de Listen permanecerán en Listen. Se preferirán variantes tipadas y slots a nuevas boolean props. La opción de construir un sistema universal y altamente polimórfico queda aparcada para una futura necesidad demostrada.

## 5. Reglas CSS y excepciones

La vía normal será `var(--token-semantic)` en CSS y utilities Tailwind semánticas. Los valores raw de color y las utilities de opacidad no autorizadas deberán desaparecer de features.

Inline styles se permitirán únicamente para valores calculados o que no puedan expresarse como clase/token estable: geometría de visualizadores, ancho/posición de seekbar, gradients derivados de audio, coordenadas, artwork y APIs de terceros. Cada excepción llevará una razón en la allowlist. Los estilos de canvas no se forzarán artificialmente dentro del contrato de UI.

Las animaciones deberán respetar `prefers-reduced-motion`; los loops RAF de visualizadores y discos se revisarán para no trabajar innecesariamente con la pestaña oculta. Los vendor overrides se aislarán y etiquetarán.

## 6. Migración y quality gates

Se migrará por cortes verticales, no mediante una reescritura global. El orden propuesto es:

1. baseline e inventario automatizado;
2. tokens y resolver runtime;
3. primitives/composites canónicos;
4. player y superficies de reproducción;
5. Shell, Home y discovery;
6. Library, Album, Artist, Playlist, Settings, Stats, Jam y social;
7. división de archivos/contextos grandes y limpieza de tipos;
8. segundo skin y rollout.

Cada corte deberá incluir métrica de drift antes/después, tests de comportamiento, typecheck, lint, revisión visual del default, responsive, teclado/focus, reduced motion y contraste. CI bloqueará nuevos hardcodes salvo allowlist. La definición de clean code será objetiva: contrato semántico consumido, excepciones explicadas, ownership claro, sin suppressions nuevas injustificadas y regresiones detectables.

## 7. Fuera de alcance

No se cambia IA, navegación, features ni lógica funcional de Listen. No se rediseña Admin. No se añade editor libre para usuarios ni skins que cambien layout, densidad, tamaño de controles o comportamiento. La paridad es perceptual e intencionada.
