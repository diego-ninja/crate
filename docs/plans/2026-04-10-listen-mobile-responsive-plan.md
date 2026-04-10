# Listen Mobile & Responsive Overhaul

> Pre-Capacitor pass: fix bugs, bring the visualizer to mobile, polish every page for touch-first usage.

## Status: Draft

---

## Context

Listen is heading toward Capacitor (iOS/Android). Mobile is where the app will be used most, but the current state has several issues:

- The WebGL visualizer (the most visually striking feature) only exists in `ExtendedPlayer` — a desktop-only split-screen panel. Mobile users never see it.
- The playlist creation modal crashes with a React error.
- The artist hero section has excessive blur and an oversized avatar on small screens.
- Continue Listening shows stale/phantom tracks from localStorage instead of real server history.
- Touch targets across the app are below the 44px minimum in several places.
- Sleep timer UI occupies prime header real-estate that the visualizer settings need.

This plan addresses all of these in a dependency-ordered sequence.

---

## Phase 0 — Critical Bugs

### 0.1 Continue Listening shows different content per device

**Problem**: `Home.tsx:164` prepends `currentTrack` to the history list unconditionally:
```tsx
const continueItems = currentTrack
  ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
  : recentlyPlayed;
```
When the page loads, `currentTrack` is restored from `localStorage['listen-player-state']` (the persisted queue). Each browser has a different persisted queue, so each device shows a different lead track — even if nobody is actively playing.

Verified: the DB (`play_history`) has Soziedad Alkoholika as latest plays, but desktop shows Unsane and mobile shows Sarniezz (a track that doesn't even exist in the library or history — ghost from an old radio session with broken cover).

**Fix** (`app/listen/src/pages/Home.tsx`):
```tsx
// Only prepend currentTrack when actually playing, not when restored-but-paused
const continueItems = currentTrack && isPlaying
  ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
  : recentlyPlayed;
```
Import `isPlaying` from `usePlayer()` (already available in scope).

**Files**: `app/listen/src/pages/Home.tsx`
**Effort**: Trivial (2 lines)

---

### 0.2 PlaylistCreateModal React error

**Problem**: The modal uses `@dnd-kit` for drag-to-reorder tracks. Current deps:
```
@dnd-kit/core: ^6.3.1
@dnd-kit/sortable: ^10.0.0
@dnd-kit/utilities: ^3.2.2
```
`@dnd-kit/sortable` v10 changed the `useSortable` hook API and internal contexts. While `core` v6.3 technically satisfies the peer dep (`^6.3.0`), the `@dnd-kit/utilities` v3 exports (`CSS.Transform`) may produce runtime errors with the v10 sortable because the transform shape changed.

**Investigation**: Open the modal in browser with DevTools console open, reproduce the error, capture the exact stack trace. Most likely scenarios:
1. `CSS.Transform.toString()` receives undefined/null transform from v10 sortable
2. Context mismatch between core v6 internal state and sortable v10 expectations
3. React StrictMode double-render causing DndContext to create duplicate sensors

**Fix options** (in order of preference):
1. Align all `@dnd-kit` packages to the same generation: upgrade `core` to `^7.0.0` and `utilities` to a compatible version, OR downgrade `sortable` to `^9.x` to match `core` v6 + `utilities` v3
2. If the error is specifically the transform being null, add a guard in `SortableTrackItem`: `const style = { transform: transform ? CSS.Transform.toString(transform) : undefined, ... }`

**Files**: `app/listen/package.json`, `app/listen/src/components/playlists/PlaylistCreateModal.tsx`
**Effort**: Low (version alignment + test)

---

## Phase 1 — Artist Page Refinement

### 1.1 Reduce background blur

**Current**: `ArtistHeroSection.tsx:57` applies `blur-md` (12px blur).
**Change**: Reduce to `blur-[6px]` — enough to soften the background without losing the image identity. The gradient overlay (`from-background via-background/78 to-background/35`) already ensures text readability.

**File**: `app/listen/src/components/artist/ArtistHeroSection.tsx`

```diff
- className="absolute inset-0 h-full w-full scale-105 object-cover opacity-30 blur-md"
+ className="absolute inset-0 h-full w-full scale-105 object-cover opacity-30 blur-[6px]"
```

**Effort**: Trivial

### 1.2 Compact avatar on mobile

**Current layout** (mobile): avatar 128px stacked above name → pushes content down, wastes vertical space.

**New layout** (mobile only, `<sm`): avatar 56px, inline left of name+stats in a horizontal row. Desktop keeps the large circular avatar as-is.

```
CURRENT (mobile):                  NEW (mobile):
┌──────────────────┐               ┌──────────────────────────┐
│   ┌──────┐       │               │ ┌────┐                   │
│   │128x128│      │               │ │56px│  Artist Name      │
│   │ avatar│      │               │ │    │  1.2M listeners   │
│   └──────┘       │               │ └────┘  342 tracks       │
│ Artist Name      │               │                          │
│ 1.2M listeners   │               │ Bio text truncated...    │
│ 342 tracks       │               │ [tags] [tags] [tags]     │
│ Bio truncated... │               └──────────────────────────┘
└──────────────────┘
```

**Implementation** (`ArtistHeroSection.tsx:65-75`):

The outer container already uses `flex-col sm:flex-row sm:items-end`. For mobile:
- Change avatar from `h-32 w-32` to `h-14 w-14 sm:h-40 sm:w-40`
- On mobile, use `flex-row items-center` for the avatar+text block instead of `flex-col`
- Wrap avatar+name+stats in a single row at `<sm`, then bio and tags below

**File**: `app/listen/src/components/artist/ArtistHeroSection.tsx`
**Effort**: Low

---

## Phase 2 — Visualizer on Mobile (FullscreenPlayer)

This is the centerpiece of the mobile overhaul. The WebGL visualizer currently only lives in `ExtendedPlayer` (desktop split-screen). We bring it to `FullscreenPlayer` (the mobile now-playing screen).

### 2.1 Extract VisualizerSettingsPanel

**Current**: The visualizer settings popover (~120 lines) is hardcoded inside `ExtendedPlayer.tsx:358-476`. It contains:
- Toggles: Enabled, Album palette, Track adaptive
- Info box (analysis status)
- Sliders: Separation, Glow, Scale, Persistence, Octaves
- Reset button

**Extract to**: `app/listen/src/components/player/visualizer/VisualizerSettingsPanel.tsx`

**Props**:
```tsx
interface VisualizerSettingsPanelProps {
  vizEnabled: boolean;
  useAlbumPalette: boolean;
  trackAdaptiveViz: boolean;
  vizConfig: VisualizerSettings;
  effectiveVizConfig: VisualizerSettings;
  trackVizProfile: TrackVisualizerProfile;
  onToggleEnabled: () => void;
  onToggleAlbumPalette: () => void;
  onToggleTrackAdaptive: () => void;
  onUpdateConfig: (config: VisualizerSettings) => void;
  onReset: () => void;
}
```

Both `ExtendedPlayer` and `FullscreenPlayer` import and render this panel.

**Files**: New `VisualizerSettingsPanel.tsx`, modify `ExtendedPlayer.tsx`
**Effort**: Medium (extract + wire up)

### 2.2 Extract shared visualizer state hook

The visualizer configuration state (viz enabled, album palette, track adaptive, config sliders, preference persistence, color application, settings delta) is duplicated logic. Extract to a shared hook:

**Extract to**: `app/listen/src/components/player/visualizer/useVisualizerConfig.ts`

```tsx
function useVisualizerConfig(vizRef, currentTrack, isOpen) {
  // All state: vizEnabled, useAlbumPalette, trackAdaptiveViz, vizConfig
  // All effects: preference sync, color application, config application, accent on track change
  // Returns: all state + setters + effectiveVizConfig + trackVizProfile
}
```

This deduplicates ~150 lines between ExtendedPlayer and FullscreenPlayer.

**Files**: New `useVisualizerConfig.ts`, modify `ExtendedPlayer.tsx`
**Effort**: Medium

### 2.3 Move sleep timer to Settings page

**Current**: Sleep timer has a dedicated button in FullscreenPlayer header (right side) with an inline dropdown menu.

**Move to**: `Settings.tsx` as a new section "Sleep Timer" between "Playback" and "Account". The sleep timer functionality (`sleep-timer.ts`) already works globally — it just needs UI in Settings.

**New Settings section**:
```
┌──────────────────────────────────────────┐
│ Sleep Timer                              │
│ Automatically pause playback after a set │
│ duration or at the end of the current    │
│ track.                                   │
│                                          │
│ [15 min] [30 min] [45 min] [1 hour]     │
│ [End of track]                           │
│                                          │
│ Status: Active · 23:41 remaining         │
│ [Cancel timer]                           │
└──────────────────────────────────────────┘
```

**FullscreenPlayer header change**: Remove the Moon button. If a sleep timer is active, show a small passive indicator (text badge) that doesn't open a menu — just shows remaining time.

**Files**: `app/listen/src/pages/Settings.tsx`, `app/listen/src/components/player/FullscreenPlayer.tsx`
**Effort**: Low-Medium

### 2.4 Integrate WebGL canvas into FullscreenPlayer

**Current "player" tab layout** (`FullscreenPlayer.tsx:379-514`):
```
flex-col items-center justify-center px-6
  → Album cover (280x280 fixed)
  → Track info (title/artist/album)
  → Progress bar
  → Main controls (prev/play/next)
  → Secondary controls (shuffle/like/queue/repeat)
  → Volume slider
```

**New "player" tab layout** when `vizEnabled`:
```
flex-col
  → Visualizer zone (flex-1, relative container)
      → Album cover as background (full width, grayscale+dim like ExtendedPlayer)
      → WebGL canvas overlay (absolute inset-0, pointer-events-none)
      → Track info overlay at bottom of zone (title/artist, semi-transparent bg)
  → Controls zone (fixed height, ~200px)
      → Progress bar
      → Main controls
      → Secondary controls
      → Volume slider
```

When `vizEnabled` is false, keep the current layout with the static album art.

**Key implementation details**:

1. **Canvas setup**: Add `canvasRef` and call `useMusicVisualizer(canvasRef, audioElement, open && vizEnabled)` — same as ExtendedPlayer
2. **Color/config application**: Use the extracted `useVisualizerConfig` hook from step 2.2
3. **Album cover treatment**: Same filter as ExtendedPlayer: `filter: grayscale(100%) brightness(0.35)` when viz is active
4. **Cover sizing**: In viz mode, the cover fills the available zone (not 280x280 fixed). Use `object-cover` with the container being `flex-1` to fill remaining space above controls
5. **Performance**: The canvas already handles its own animation loop. On low-end mobile, the `vizEnabled` toggle acts as an escape hatch

**Header change**:
```
CURRENT:  [↓ Close]  [Player][Queue][Lyrics]  [🌙 Sleep]
NEW:      [↓ Close]  [Player][Queue][Lyrics]  [⚙ Viz Settings]
```

The ⚙ button opens the extracted `VisualizerSettingsPanel` as a slide-down panel below the header (same visual treatment as the current sleep timer dropdown, but with the full viz controls).

If a sleep timer is active, show a small `23:41` text badge inline with the tabs (between tabs and viz button), non-interactive.

**Files**: `app/listen/src/components/player/FullscreenPlayer.tsx`
**Effort**: High (this is the main piece of work)

### 2.5 Guard ExtendedPlayer on mobile

The `ExtendedPlayer` (50/50 desktop split) should never render on mobile. While it's currently only triggered from `PlayerBar` (desktop-only), add a safety guard.

```tsx
// ExtendedPlayer.tsx
const isDesktop = useIsDesktop();
if (!isDesktop || !currentTrack) return null;
```

**File**: `app/listen/src/components/player/ExtendedPlayer.tsx`
**Effort**: Trivial

---

## Phase 3 — Touch Targets & Mobile Interactions

### 3.1 TrackRow touch area expansion

**Current issues**:
- Heart button: `h-8 w-8` (32px) → below 44px minimum
- Action menu button: `h-8 w-8` (32px) → below 44px minimum  
- Index column play icon: only visible on `group-hover` → useless on touch

**Fix**: Increase the visual icon containers to `h-9 w-9` but wrap them in a 44px touch area using padding. Don't change visual size to avoid layout shift.

```tsx
// Heart: keep h-8 w-8 visual, add p-1 wrapper for 40px touch area (acceptable)
// Or: use min-h-[44px] min-w-[44px] with flex centering

// Index column: on mobile (no hover), always show the play icon with reduced opacity
// instead of track number. Tap the row to play (already works), icon is just visual feedback.
```

**File**: `app/listen/src/components/cards/TrackRow.tsx`
**Effort**: Low

### 3.2 AlbumCard play button

**Current**: `w-10 h-10` (40px)
**Fix**: `w-11 h-11` (44px)

**File**: `app/listen/src/components/cards/AlbumCard.tsx`
**Effort**: Trivial

### 3.3 MiniPlayer swipe for next/prev

`PlayerBar` (desktop) already has swipe left/right handlers (`handleTouchStart`/`handleTouchEnd` at lines 55-74). `MiniPlayer` doesn't have this.

**Add**: Same swipe gesture to `MiniPlayer.tsx` — swipe left = next, swipe right = prev. Use the same 50px threshold and 2:1 horizontal/vertical ratio to avoid conflicts with the swipe-to-dismiss of FullscreenPlayer.

**File**: `app/listen/src/components/player/MiniPlayer.tsx`
**Effort**: Low

---

## Phase 4 — Layout & Safe Areas

### 4.1 Horizontal safe areas for notched devices

**Current**: Bottom safe area is handled (`env(safe-area-inset-bottom)`). Horizontal safe areas are missing for landscape mode on notched iPhones.

**Fix**: Add horizontal safe area padding to the main content area in `Shell.tsx`:
```tsx
// Mobile main content
<div className="p-4 px-[max(1rem,env(safe-area-inset-left))]">
```

Also verify `<meta name="viewport" content="..., viewport-fit=cover">` is set in `index.html`.

**Files**: `app/listen/src/components/layout/Shell.tsx`, `app/listen/index.html`
**Effort**: Low

### 4.2 FullscreenPlayer horizontal safe areas

Add `px-[max(1.5rem,env(safe-area-inset-left))]` to the player content area for landscape mode.

**File**: `app/listen/src/components/player/FullscreenPlayer.tsx`
**Effort**: Trivial

### 4.3 Status bar theme-color meta tag

Add `<meta name="theme-color" content="#0a0a0f">` to match the app background. This colors the status bar on mobile browsers and is required for Capacitor.

**File**: `app/listen/index.html`
**Effort**: Trivial

---

## Phase 5 — Polish

### 5.1 Pull-to-refresh on more pages

Currently only `Home.tsx` has pull-to-refresh. Add to:
- `Library.tsx` (refresh playlists, saved albums, likes, follows)
- `Explore.tsx` (refresh genre/mood data)
- `Artist.tsx` (refresh artist data)

Use the existing `usePullToRefresh` hook + `<PullIndicator>` component.

**Files**: `Library.tsx`, `Explore.tsx`, `Artist.tsx`
**Effort**: Low (pattern already exists)

### 5.2 TrackRow index column on mobile

**Current**: Shows track number by default, play icon on `group-hover` (desktop). On mobile, the play icon never shows (no hover).

**Fix**: On touch devices, always show the play icon with `opacity-60`, hide the track number. The entire row is tappable anyway, but the visual affordance matters.

```tsx
// Use a media query approach:
<Play size={14} className="text-foreground mx-auto hidden md:group-hover:block" />
// becomes:
<Play size={14} className="text-foreground mx-auto md:hidden" /> {/* always visible on mobile */}
<Play size={14} className="text-foreground mx-auto hidden md:block md:opacity-0 md:group-hover:opacity-100" /> {/* hover on desktop */}
```

**File**: `app/listen/src/components/cards/TrackRow.tsx`
**Effort**: Low

### 5.3 Home "Keep the queue moving" — server-backed data

**Current**: The "Keep the queue moving" rail in Home uses `recentlyPlayed` from PlayerContext, which is persisted in localStorage. This means different browsers show different quick-pick suggestions.

**Fix**: Feed this section from the same `/api/me/history` data instead of the PlayerContext's localStorage state. The Home page already fetches `historyRaw` — use a slice of it for this rail.

**File**: `app/listen/src/pages/Home.tsx`
**Effort**: Low

---

## Execution Order

```
Phase 0 (bugs)          ~1h
  0.1 Continue Listening fix .............. 5 min
  0.2 PlaylistCreateModal fix ............. 30 min

Phase 1 (artist page)   ~30min
  1.1 Reduce blur ......................... 5 min
  1.2 Compact avatar on mobile ............ 25 min

Phase 2 (visualizer)     ~3-4h
  2.1 Extract VisualizerSettingsPanel ...... 30 min
  2.2 Extract useVisualizerConfig hook ..... 45 min
  2.3 Move sleep timer to Settings ......... 30 min
  2.4 Integrate WebGL into FullscreenPlayer  90 min
  2.5 Guard ExtendedPlayer on mobile ....... 5 min

Phase 3 (touch targets)  ~1h
  3.1 TrackRow touch expansion ............. 20 min
  3.2 AlbumCard play button ................ 5 min
  3.3 MiniPlayer swipe .................... 20 min

Phase 4 (safe areas)     ~30min
  4.1 Shell horizontal safe areas .......... 10 min
  4.2 FullscreenPlayer safe areas .......... 5 min
  4.3 Theme-color meta tag ................. 5 min

Phase 5 (polish)         ~1h
  5.1 Pull-to-refresh on more pages ........ 30 min
  5.2 TrackRow index column mobile ......... 15 min
  5.3 Keep queue moving → server data ...... 15 min
```

Total estimate: ~7-8h of implementation across 5 phases.

---

## Files Changed (summary)

| File | Phases | Changes |
|------|--------|---------|
| `pages/Home.tsx` | 0.1, 5.3 | Fix continue listening lead, server-backed queue rail |
| `package.json` | 0.2 | Align @dnd-kit versions |
| `playlists/PlaylistCreateModal.tsx` | 0.2 | Fix DnD error (if code change needed) |
| `artist/ArtistHeroSection.tsx` | 1.1, 1.2 | Reduce blur, compact mobile avatar |
| **`player/FullscreenPlayer.tsx`** | **2.3, 2.4, 4.2** | **Major: visualizer integration, sleep timer removal, safe areas** |
| `player/ExtendedPlayer.tsx` | 2.1, 2.2, 2.5 | Extract viz settings + hook, add mobile guard |
| **NEW `player/visualizer/VisualizerSettingsPanel.tsx`** | **2.1** | **Shared viz settings component** |
| **NEW `player/visualizer/useVisualizerConfig.ts`** | **2.2** | **Shared viz state + effects hook** |
| `pages/Settings.tsx` | 2.3 | Add Sleep Timer section |
| `cards/TrackRow.tsx` | 3.1, 5.2 | Touch targets, mobile play icon |
| `cards/AlbumCard.tsx` | 3.2 | Play button 44px |
| `player/MiniPlayer.tsx` | 3.3 | Swipe next/prev |
| `layout/Shell.tsx` | 4.1 | Horizontal safe areas |
| `index.html` | 4.1, 4.3 | viewport-fit, theme-color |
| `pages/Library.tsx` | 5.1 | Pull-to-refresh |
| `pages/Explore.tsx` | 5.1 | Pull-to-refresh |
| `pages/Artist.tsx` | 5.1 | Pull-to-refresh |

---

## Out of scope (for later)

- Capacitor plugin integration (camera, haptics, push notifications)
- Offline playback / service worker caching
- Background audio on iOS (requires Capacitor plugin)
- Landscape-specific layouts beyond safe areas
- Long-press context menus (nice-to-have, not blocking)
