# crate-ui Design System

**Date:** 2026-04-22
**Status:** Approved
**Scope:** Unified component library for listen + admin (site in a second pass)

## Goals

1. Single source of truth for all UI: tokens, primitives, shadcn, domain components
2. Apps become thin shells: routing, pages, context wiring
3. Glass/solid surface variants controlled by data attribute
4. Develop in `app/shared/ui/`, publishable to npm via `make crate-ui-build`
5. Zero breaking change during migration — additive moves, update imports

## Architecture

### Principle

**Everything that renders UI lives in `shared/ui/`. Apps only have pages, routing, and context providers.**

A component does not need to exist in both apps to live in crate-ui. If it's UI, it goes to crate-ui.

### What stays in each app

```
app/ui/src/
  App.tsx                    # Routing
  pages/                     # Page components
  contexts/                  # Admin-specific contexts (if any)
  lib/api.ts                 # API client wiring
  lib/utils.ts               # Re-exports from shared
  index.css                  # @import shared tokens + app overrides

app/listen/src/
  App.tsx                    # Routing
  pages/                     # Page components
  contexts/                  # PlayerContext, OfflineContext, AuthContext, etc.
  hooks/                     # App-specific hooks
  lib/api.ts                 # API client wiring (Capacitor-aware)
  lib/utils.ts               # Re-exports
  index.css                  # @import shared tokens + app overrides
```

### Directory structure

```
app/shared/ui/
  package.json                    # @crate/ui (for future npm publish)
  tsconfig.json                   # Standalone type-check config

  tokens/                         # Design tokens — single source of truth
    colors.css                    # Semantic color tokens
    surfaces.css                  # Solid/glass variants via data-surface
    radius.css                    # Border radius scale
    z-index.css                   # Z-layer system + utility classes
    animations.css                # Shared keyframes + utility classes
    typography.css                # Font stack, text utilities
    index.css                     # Barrel: @import all token files

  lib/
    cn.ts                         # clsx + tailwind-merge (single definition)
    types.ts                      # Shared data interfaces (TrackData, AlbumData, etc.)
    hooks.ts                      # Shared UI hooks (useEscapeKey, useIsDesktop, etc.)

  primitives/                     # Base UI — no domain logic
    ActionIconButton.tsx
    AppModal.tsx                  # Modal + bottom sheet (listen's as base)
    AppPopover.tsx                # Popover surface + AppMenuButton
    CrateBadge.tsx                # CratePill + CrateChip
    VtNavLink.tsx                 # View transition NavLink
    QrCodeImage.tsx               # QR code renderer (colors via props)
    PullIndicator.tsx             # Pull-to-refresh indicator
    Spinner.tsx                   # Loading spinner
    ErrorState.tsx                # Empty/error feedback
    ImageLightbox.tsx             # Click-to-zoom overlay
    StarRating.tsx                # 5-star rating

  shadcn/                         # Curated shadcn/Radix components
    alert-dialog.tsx
    badge.tsx
    button.tsx
    card.tsx
    context-menu.tsx
    dialog.tsx
    dropdown-menu.tsx
    input.tsx
    popover.tsx
    progress.tsx
    scroll-area.tsx
    select.tsx
    separator.tsx
    sheet.tsx
    skeleton.tsx
    table.tsx
    tabs.tsx
    textarea.tsx
    tooltip.tsx

  composites/                     # Composed generic components
    AdminSelect.tsx               # Searchable select (Popover + Input)
    ConfirmDialog.tsx             # Destructive action confirmation
    GridSkeleton.tsx
    TableSkeleton.tsx
    CardSkeleton.tsx
    CommandPalette.tsx            # Cmd+K palette
    ImageUpload.tsx
    ImageCropUpload.tsx
    OAuthButtons.tsx              # OAuth provider buttons (Capacitor-aware)

  domain/                         # Business/domain components
    cards/
      AlbumCard.tsx
      ArtistCard.tsx
      TrackRow.tsx
      TrackCoverThumb.tsx
      ShowCard.tsx
      PlaylistCard.tsx
      PlaylistArtwork.tsx
      AlbumRow.tsx
      ArtistRow.tsx
      TidalAlbumCard.tsx
      MissingAlbumCard.tsx

    artist/
      ArtistHeroSection.tsx
      ArtistAboutSection.tsx
      ArtistAvatar.tsx
      ArtistDiscographySection.tsx
      ArtistNetworkGraph.tsx
      ArtistOverviewSection.tsx
      ArtistSetlistSection.tsx
      ArtistShowsSection.tsx
      ArtistSimilarSection.tsx
      ArtistStatsSection.tsx
      ArtistTabsNav.tsx
      ArtistLoadingState.tsx
      ArtistTopTracksSection.tsx

    album/
      AlbumGrid.tsx
      AlbumHeader.tsx
      AudioProfileCard.tsx
      RelatedAlbums.tsx
      TagEditor.tsx
      TrackTable.tsx

    player/
      PlayerBar.tsx
      PlayerSeekBar.tsx
      PlayerVolumeControl.tsx
      WaveformCanvas.tsx
      QualityBadge.tsx
      PlayerTrackMenu.tsx
      EqBands.tsx
      EqualizerPanel.tsx
      EqualizerPopover.tsx
      LyricsPanel.tsx
      QueuePanel.tsx
      ExtendedPlayer.tsx
      FullscreenPlayer.tsx
      visualizer/
        MusicVisualizer.ts
        OpenGLRenderer.ts
        ShaderProgram.ts
        geometry/

    explore/
      ExplorePill.tsx
      ExploreSectionHeader.tsx
      ExploreSectionRail.tsx
      ExploreViews.tsx

    genres/
      GenreEqEditor.tsx
      GenreNetworkGraph.tsx
      GenreTaxonomyTree.tsx

    shows/
      UpcomingShowCard.tsx
      UpcomingEventRow.tsx
      UpcomingActionButtons.tsx

    stats/
      StatsPanels.tsx
      ArtistStats.tsx
      OpsStatTile.tsx
      OpsPageHero.tsx
      OpsPanel.tsx

    playlists/
      PlaylistCreateModal.tsx
      PlaylistListRow.tsx
      PlaylistTrackFilterBar.tsx

    scanner/
      IssueList.tsx
      MatchCard.tsx
      ScanProgress.tsx

    offline/
      OfflineBadge.tsx

    actions/
      ItemActionMenu.tsx
      useItemActionMenu.ts
      album-actions.tsx
      artist-actions.tsx
      track-actions.tsx
      playlist-actions.tsx
      show-actions.tsx
      MusicContextMenu.tsx

    layout/
      Shell.tsx
      Sidebar.tsx
      TopBar.tsx
      TopBarSearch.tsx
      TopBarUserMenu.tsx
      SearchBar.tsx

    auth/
      UserMap.tsx

    track/
      SimilarTracksPanel.tsx

  charts/
    theme.ts                      # Shared nivo dark theme config
    TrendChart.tsx
```

## Token System

### Colors (colors.css)

Core semantic tokens shared across all apps:

```css
@theme inline {
  --color-background: #0a0a0f;
  --color-foreground: #f1f5f9;
  --color-primary: #06b6d4;
  --color-primary-foreground: #0a0a0f;
  --color-muted-foreground: #64748b;
  --color-destructive: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-info: #3b82f6;
  --color-ring: #06b6d4;
}
```

### Surface variants (surfaces.css)

Controlled by `data-surface` attribute on any ancestor element:

```css
:root, [data-surface="solid"] {
  --color-card: #16161e;
  --color-card-foreground: #f1f5f9;
  --color-secondary: #1c1c28;
  --color-secondary-foreground: #f1f5f9;
  --color-muted: #16161e;
  --color-accent: #1c1c28;
  --color-accent-foreground: #f1f5f9;
  --color-popover: #16161e;
  --color-popover-foreground: #f1f5f9;
  --color-border: #252535;
  --color-input: #141419;
  --surface-app: #0a0a0f;
  --surface-panel: #0c0c14;
  --surface-raised: #12121a;
  --surface-modal: rgba(16,16,24,0.95);
  --surface-popover: rgba(18,18,26,0.95);
}

[data-surface="glass"] {
  --color-card: rgba(18,18,26,0.78);
  --color-card-foreground: #f1f5f9;
  --color-secondary: rgba(28,28,40,0.88);
  --color-secondary-foreground: #f1f5f9;
  --color-muted: rgba(22,22,30,0.72);
  --color-accent: rgba(255,255,255,0.06);
  --color-accent-foreground: #f1f5f9;
  --color-popover: rgba(18,18,26,0.95);
  --color-popover-foreground: #f1f5f9;
  --color-border: rgba(255,255,255,0.08);
  --color-input: rgba(20,20,25,0.72);
  --surface-app: #0a0a0f;
  --surface-panel: #0c0c14;
  --surface-raised: rgba(18,18,26,0.92);
  --surface-modal: rgba(16,16,24,0.95);
  --surface-popover: rgba(18,18,26,0.95);
}
```

Apps set the variant at the html level. Sections can override locally:

```html
<!-- Admin: glass globally -->
<html data-surface="glass">

<!-- Listen: solid default, glass on player bar -->
<html data-surface="solid">
  <div data-surface="glass" class="player-bar">...</div>
```

### Radius scale (radius.css)

One step down from listen's current values:

```css
@theme inline {
  --radius-sm: 0.125rem;    /* 2px */
  --radius-md: 0.25rem;     /* 4px */
  --radius-lg: 0.375rem;    /* 6px */
  --radius-xl: 0.5rem;      /* 8px */
}
```

### Z-index (z-index.css)

```css
:root {
  --z-header: 30;
  --z-sidebar: 40;
  --z-player-drawer: 55;
  --z-extended-player: 1200;
  --z-fullscreen-player: 1300;
  --z-player: 1350;
  --z-popover: 1400;
  --z-player-overlay: 1410;
  --z-dropdown: 1450;
  --z-modal: 1500;
  --z-upcoming-overlay: 1510;
}
/* + utility classes: .z-app-header, .z-app-sidebar, etc. */
```

### Animations (animations.css)

Shared keyframes: `page-in`, `pop-in`, `pop-out`, `sheet-up`, `fade-in`,
`fade-slide-up`, `submenu-in`, `hero-fade-in`, `track-in`, `upcoming-expand`,
`pulse-subtle`, `equalizer-bar`.

### Typography (typography.css)

Font: Poppins (web), system fonts (Capacitor native).
Utility classes for tabular-nums, truncation, etc.

## Component Design Pattern

### Domain components use callbacks, not contexts

Components accept data and callbacks via props. Apps inject behavior:

```tsx
// shared/ui/domain/cards/AlbumCard.tsx
interface AlbumCardProps {
  // Data — universal
  artist: string;
  album: string;
  albumId?: number;
  albumSlug?: string;
  cover?: string;
  year?: string;

  // Metadata — admin shows these
  tracks?: number;
  formats?: string[];
  bitDepth?: number | null;
  sampleRate?: number | null;
  showQualityBadge?: boolean;

  // Layout
  layout?: "rail" | "grid";
  compact?: boolean;

  // Playback — listen injects these
  onPlay?: () => void;
  onSave?: () => void;
  isSaved?: boolean;

  // Offline — listen injects
  offlineState?: "idle" | "downloading" | "ready" | "error";

  // Admin features
  onFetchCover?: () => void;

  // Context menu — both apps inject their own
  contextMenu?: ReactNode;
}
```

Components render features conditionally based on which props are provided:

- `onPlay` present → render play overlay on hover
- `offlineState` present → render offline badge
- `tracks` + `formats` present → render quality badge
- `contextMenu` present → wire right-click / long-press

### CrateUIProvider (optional convenience)

For components that need many capabilities (PlayerBar, TrackRow), a context
provider avoids prop drilling through intermediate page components:

```tsx
// app/listen/src/App.tsx
<CrateUIProvider capabilities={{
  playback: { play, pause, isPlaying, currentTrack },
  offline: { getState, download },
  likes: { isLiked, toggle },
  navigate: useNavigate(),
}}>
  <Shell />
</CrateUIProvider>
```

Domain components call `useCrateUI()` and check capability presence:

```tsx
const { playback } = useCrateUI();
// playback is undefined in admin → don't render play button
```

Admin provides a minimal provider (or none — components degrade gracefully).

## Path Aliases

Both apps configure the same alias:

```json
// tsconfig.json
{ "paths": { "@/*": ["./src/*"], "@crate-ui/*": ["../shared/ui/*"] } }
```

```ts
// vite.config.ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "@crate-ui": path.resolve(__dirname, "../shared/ui"),
  }
}
```

Usage:

```ts
import { Button } from "@crate-ui/shadcn/button";
import { AlbumCard } from "@crate-ui/domain/cards/AlbumCard";
import { EqBands } from "@crate-ui/domain/player/EqBands";
import { cn } from "@crate-ui/lib/cn";
```

## App CSS After Migration

```css
/* app/ui/src/index.css */
@import "@crate-ui/tokens/index.css";
@import "../../shared/fonts/poppins.css";

/* Admin: glass surface variant */
html { &[data-surface] { } }
/* Admin-only overrides (if any) */
```

```css
/* app/listen/src/index.css */
@import "@crate-ui/tokens/index.css";
@import "../../shared/fonts/poppins.css";

/* Listen-only: safe area padding, user-select, iOS input zoom fix */
```

## npm Publishing (future)

```makefile
crate-ui-build:
	cd app/shared/ui && npx tsup \
		lib/*.ts primitives/*.tsx shadcn/*.tsx composites/*.tsx domain/**/*.tsx \
		--format esm --dts --outdir dist \
		--external react --external react-dom --external @radix-ui/*

crate-ui-publish: crate-ui-build
	cd app/shared/ui && npm publish --access public
```

`package.json` exports map:

```json
{
  "name": "@crate/ui",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    "./tokens/*": "./tokens/*",
    "./lib/*": "./dist/lib/*.js",
    "./primitives/*": "./dist/primitives/*.js",
    "./shadcn/*": "./dist/shadcn/*.js",
    "./composites/*": "./dist/composites/*.js",
    "./domain/*": "./dist/domain/*.js",
    "./charts/*": "./dist/charts/*.js"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-popover": "^1.0.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^3.0.0",
    "lucide-react": "^0.400.0"
  }
}
```

## Migration Phases

Phases 0-3 move context-free code (tokens, utilities, shadcn primitives,
UI primitives). These are mechanical and safe.

Phases 4+ deal with domain components that import app-specific contexts,
hooks, and services (`PlayerContext`, `OfflineContext`, `useApi`, etc.).
These cannot be "just moved" — each component must first be refactored
to receive dependencies via props/callbacks instead of importing contexts
directly. This is per-component work, not a batch operation.

### Phase 0 — Scaffold ✅

- Created `shared/ui/` structure, token files, aliases, `cn.ts`
- npm workspaces configured (root `package.json`)
- Both apps import tokens from `@crate-ui/tokens/`
- `data-surface="solid|glass"` variant system
- Makefile updated for workspace-aware vite

### Phase 1 — Literal duplicates ✅

- `cn.ts` → `@crate-ui/lib/cn`
- `EqBands` → `@crate-ui/domain/player/EqBands`
- `CrateBadge` (CratePill + CrateChip) → `@crate-ui/primitives/CrateBadge`
- `VtNavLink` → `@crate-ui/primitives/VtNavLink`
- `PlaylistArtwork` → `@crate-ui/domain/playlists/PlaylistArtwork`
- `@source "../../shared/ui"` added to both apps for Tailwind v4

### Phase 2 — shadcn components ✅

- 19 shadcn files moved to `shared/ui/shadcn/`
- Internal imports fixed (`@/lib/utils` → `@crate-ui/lib/cn`)
- `AppPopover` moved to `shared/ui/primitives/` (shadcn depends on it)
- All consumer imports updated to `@crate-ui/shadcn/*`

### Phase 3 — UI primitives ✅

- `ActionIconButton` / `ActionIconLink` → `@crate-ui/primitives/`
- `AppModal` + ModalHeader/Body/Footer/Close → `@crate-ui/primitives/`
- `QrCodeImage` (colors as props) → `@crate-ui/primitives/`
- `PullIndicator` → `@crate-ui/primitives/`
- `StarRating` → `@crate-ui/primitives/`
- `ImageLightbox` → `@crate-ui/primitives/`
- `ErrorState` → `@crate-ui/primitives/`
- `Spinner` → `@crate-ui/primitives/` (new extraction)

### Phase 4 — Shared hooks and utilities ✅

Extracted context-free hooks and utilities into `shared/ui/lib/`:
- `useIsDesktop` (breakpoint hook)
- `useEscapeKey` (keyboard handler)
- `useDismissibleLayer` (click-outside + escape)
- `offline` types and pure functions (OfflineItemState, getOfflineStateLabel, etc.)

### Phase 5 — Unify overlapping domain components ✅

**Principle: crate-ui only holds components used by BOTH apps.**
Single-app components stay in their app. A component moves to crate-ui
only when both apps need it.

**Done:**
- `OAuthButtons` → `@crate-ui/domain/auth/OAuthButtons`
  Icons (GoogleIcon, AppleIcon) extracted. OAuth navigation injected
  via `onOAuthNavigate` callback. Each app wraps with platform logic
  (Capacitor native in listen, simple redirect in admin).
- `ShowCard` → `@crate-ui/domain/shows/ShowCard` + `show-types.ts`
  Collapsed/expanded animation shell shared. Action buttons injected
  via `collapsedActionsSlot` and `expandedActionsSlot` ReactNode props.
  `NormalizedShow` type + `formatShowDateParts` + `getGenreColor` in
  shared types. Each app normalizes its own data and provides slots.

**Skipped (too divergent to unify cost-effectively):**
- `ArtistCard` — circle vs square photo, completely different data/actions
- `ArtistHeroSection` — 28 vs 13 props, different action surfaces
- `ArtistSetlistSection` — modal vs inline table
- `ItemActionMenu` vs `MusicContextMenu` — different paradigms

**Future (when needed):**
- `AlbumCard` — image/text/nav shell is reusable, but play/offline/quality
  slots make it complex. Unify when there's a concrete need.
- `SearchBar` — input chrome is similar, unify when admin or listen changes.
- Nivo chart theme to `shared/ui/charts/theme.ts`

### Phase 6 — Layout unification

Extract shared layout patterns (only if both apps benefit):
- Shell frame (sidebar + header + content + optional player slot)
- Sidebar (configurable nav items, collapsible, persisted state)
- TopBar (configurable actions, search)

### Phase 7 — Cleanup and publish

- Delete re-export stub files in both apps
- Delete original files that were moved to shared/ui
- Remove unused shared/ui files (composites/, domain/ subdirs for
  components that were reverted to their apps)
- `make crate-ui-build` with tsup
- `make crate-ui-publish` to registry
- Site migration to shared tokens

## Overlap Reference

### Tier 1 — Literal duplicates (Phase 1)

| Component | Listen path | Admin path |
|-----------|------------|------------|
| EqBands | `components/player/EqBands.tsx` | `components/genres/EqBands.tsx` |
| CrateChip | `components/ui/CrateBadge.tsx` | `components/ui/CrateBadge.tsx` |
| VtNavLink | `components/ui/VtNavLink.tsx` | `components/ui/VtNavLink.tsx` |
| PlaylistArtwork | `components/playlists/PlaylistArtwork.tsx` | `components/playlists/PlaylistArtwork.tsx` |

### Tier 2 — Same purpose, minor API divergence (Phase 3)

| Component | Difference |
|-----------|-----------|
| ActionIconButton | rounded-full (listen) vs rounded-md (admin) |
| AppPopover | admin adds `layer` prop for z-index contexts |
| AppMenuButton | rounded-xl (listen) vs rounded-md (admin) |
| CratePill | slight active-color opacity diffs, border-radius |
| QrCodeImage | foreground/background colors hardcoded differently |

### Tier 3 — Overlapping domain, different features (Phase 6)

| Component | Listen features | Admin features |
|-----------|----------------|----------------|
| AlbumCard | play overlay, heart, offline badge | quality badge, track count, formats, cover fetch |
| ArtistCard | circular, play/follow on hover | square, metadata chips, selection mode |
| ShowCard | attendance, setlist play, context menu | compact mode, union input normalizer |
| OAuthButtons | Capacitor native, invite token | Simple redirect only |
| ArtistHeroSection | play/shuffle/radio/follow/share | upload/enrich/analyze/repair/delete admin actions |
| ArtistSetlistSection | modal + play/export | in-page table + frequency bars |
