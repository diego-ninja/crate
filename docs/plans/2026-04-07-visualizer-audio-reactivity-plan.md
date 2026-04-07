# Visualizer Audio Reactivity Plan

## Goal

Make the player visualizer adapt to each track using library analysis data:

- `bpm` / tempo
- `energy`
- `danceability`
- `valence`
- `audio_key` / `audio_scale`
- `mood_json`
- optionally `bliss_vector` or a derived signature from it

The visualizer should remain reactive to the live audio signal via `AnalyserNode`, but each track should also have a stable visual identity.

## Current State

### Listen player

The most capable visualizer lives in `listen`:

- `app/listen/src/components/player/ExtendedPlayer.tsx`
- `app/listen/src/components/player/visualizer/useMusicVisualizer.ts`
- `app/listen/src/components/player/visualizer/MusicVisualizer.ts`
- `app/listen/src/lib/player-visualizer-prefs.ts`

Current behavior:

- The visualizer is driven only by live FFT/time-domain data from Web Audio.
- Track-specific behavior is limited to album-cover palette extraction.
- User settings are manual and persistent:
  - `separation`
  - `glow`
  - `scale`
  - `persistence`
  - `octaves`
  - `mode` (`spheres`, `halo`, `tunnel`)

Important detail:

- `MusicVisualizer` already exposes a good set of runtime knobs.
- That makes this feature viable without rewriting the renderer.

### Track audio metadata

`listen` already fetches per-track analysis data in the Info tab:

- `app/listen/src/components/player/extended/InfoTab.tsx`
- backend endpoint in `app/crate/api/browse_media.py`

Current `/api/tracks/{id}/info` exposes:

- `bpm`
- `audio_key`
- `audio_scale`
- `energy`
- `danceability`
- `valence`
- `acousticness`
- `instrumentalness`
- `loudness`
- `dynamic_range`
- popularity/rating data

What is missing for this feature:

- `mood_json` is not returned there today.
- `bliss_vector` is stored in DB but not exposed.

### Player model

`Track` in `app/listen/src/contexts/player-types.ts` does not currently carry any visualizer-specific metadata.

That is good:

- we do not need to bloat every queue payload immediately
- we can resolve visualizer metadata lazily when the current track changes

### Admin player

`ui` has its own visualizer stack:

- `app/ui/src/components/player/visualizer/MusicVisualizer.ts`
- `app/ui/src/components/player/AudioPlayer.tsx`

It is simpler and has no mode system comparable to `listen`.

Recommendation:

- phase 1 should target `listen` only
- once stable, reuse the mapping logic in `ui` if it still makes sense

## Viability

This feature is viable.

The renderer already has enough controllable parameters to make tracks feel different without changing shader architecture. The main missing piece is not rendering capability, but a clean way to convert track analysis into a small, stable visual profile.

The key design constraint is:

- live audio should drive moment-to-moment motion
- track analysis should drive the baseline scene personality

If we try to make `bliss_vector` the primary driver, the result will likely be hard to reason about and hard to tune. `bliss` is better used as a secondary modifier, not as the main control plane.

## Recommended Product Behavior

For each track, compute a `VisualizerTrackProfile` that influences:

- preferred mode
- base camera motion
- pulse aggressiveness
- geometry spacing
- glow/bloom amount
- noise scale and persistence
- color temperature / palette bias
- contrast / smoothness

Suggested mapping:

- `energy`:
  - stronger pulse amplitude
  - more glow
  - more camera push-in
- `bpm`:
  - faster internal motion multipliers
  - tighter pulsing cadence
- `danceability`:
  - more regular oscillation
  - cleaner attack / less haze
- `valence`:
  - brighter palette lift
  - more open scene composition
- `acousticness`:
  - less glow
  - lower geometry density
  - softer camera motion
- `instrumentalness`:
  - more hypnotic / ambient movement
  - less aggressive pulse
- `audio_key` + `audio_scale`:
  - major can bias upward/bright
  - minor can bias inward/deeper
- `mood_json`:
  - strongest input for mode choice
- `bliss`:
  - only for secondary geometry bias and micro-motion flavor

### Suggested mode heuristics

- `halo`
  - bright, dreamy, emotional, spacious, acoustic, uplifting
- `tunnel`
  - dark, intense, driving, melancholic, repetitive, heavy
- `spheres`
  - balanced default, neutral fallback

## Recommended Technical Shape

### Phase 1: Adaptive visualizer without raw bliss

Add a lightweight client-side profile builder fed by track info.

Why this first:

- fastest route to something visible
- most data already exists
- tuning is easier in frontend
- avoids exposing `bliss_vector` prematurely

Implementation shape:

1. Create a `useTrackVisualizerProfile(currentTrack)` hook in `listen`.
2. Fetch `/api/tracks/{id}/info` when `currentTrack.libraryTrackId` changes.
3. Extend track info endpoint to include `mood_json`.
4. Convert returned metadata into a normalized `VisualizerTrackProfile`.
5. Apply that profile to `vizRef.current` when the track changes.
6. Keep the live `AnalyserNode` loop untouched.

### Phase 2: Add bliss-derived flavor

Do not send raw `bliss_vector` to the frontend yet.

Instead, add a backend-derived compact signature, for example:

- `bliss_texture`
- `bliss_motion`
- `bliss_density`

These can be computed from the 20-float vector using deterministic summary math.

Why this is better:

- smaller payload
- easier to tune visually
- avoids coupling frontend to the internal meaning of the vector

Possible endpoint shape:

- either enrich `/api/tracks/{id}/info`
- or add `/api/tracks/{id}/visualizer-profile`

I recommend enriching `/api/tracks/{id}/info` first only with fields that are broadly useful:

- `mood_json`
- `bliss_signature` (small derived object, not the raw vector)

## Suggested Types

### Backend response additions

```ts
interface TrackInfo {
  bpm: number | null;
  audio_key: string | null;
  audio_scale: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  mood_json?: Record<string, number> | null;
  bliss_signature?: {
    texture: number | null;
    motion: number | null;
    density: number | null;
  } | null;
}
```

### Frontend derived profile

```ts
interface VisualizerTrackProfile {
  mode: "spheres" | "halo" | "tunnel";
  separationDelta: number;
  glowDelta: number;
  scaleDelta: number;
  persistenceDelta: number;
  octavesDelta: number;
  cameraSpeed: number;
  pulseBias: number;
  paletteTemperature: number;
  moodTag?: string;
}
```

Important:

- use deltas, not absolute replacements
- user preferences remain the base layer
- track profile should modulate the base, not erase it

## Where To Plug It In

### Listen only, phase 1

Frontend:

- `app/listen/src/components/player/ExtendedPlayer.tsx`
  - apply computed profile to `vizRef.current`
- `app/listen/src/components/player/visualizer/MusicVisualizer.ts`
  - add a small API for track profile input
- `app/listen/src/components/player/visualizer/useMusicVisualizer.ts`
  - no major change needed
- new hook:
  - `app/listen/src/components/player/visualizer/useTrackVisualizerProfile.ts`
- optionally new mapper:
  - `app/listen/src/components/player/visualizer/track-visualizer-profile.ts`

Backend:

- `app/crate/api/browse_media.py`
  - extend `_TRACK_INFO_COLS`
  - return `mood_json`
  - maybe later add `bliss_signature`

### Optional shared extraction later

If the behavior works well in `listen`, move the pure mapping logic into:

- `app/shared/web/`

Only move the mapping, not the renderer.

## UX Recommendation

Add a new preference:

- `Auto-adapt visualizer to track`

Default:

- enabled in `listen`

Why:

- this will be subjective
- some users will prefer a stable visualizer
- manual controls should still matter

Good companion controls:

- `Auto-adapt visualizer`
- `Keep selected mode fixed`
- `Adaptation intensity`

This lets us support:

- fully manual
- hybrid
- fully adaptive

## Risks

### 1. Too much visual churn

If every track change heavily mutates mode, colors, camera and geometry, the player may feel chaotic.

Mitigation:

- mode changes only when confidence is high
- otherwise keep current mode and change only deltas
- animate transitions over 300-800ms

### 2. Metadata fetch lag on track change

The visualizer might update late if profile data arrives after playback starts.

Mitigation:

- use current defaults immediately
- blend in profile when fetch resolves
- cache profiles by `libraryTrackId`
- optionally preload next-track profile alongside audio preload later

### 3. Bliss overfitting

The 20-float vector is not a user-facing semantic model. Directly binding it to visuals may create noise rather than meaning.

Mitigation:

- use `bliss` only for secondary flavor
- derive 2-3 stable axes first
- do not ship raw vector-driven visuals initially

### 4. Divergence between `listen` and `ui`

Both apps have different visualizer stacks.

Mitigation:

- ship in `listen` first
- extract only the mapping function later if warranted

## Recommended Implementation Order

1. Extend `/api/tracks/{id}/info` to include `mood_json`.
2. Add a `useTrackVisualizerProfile()` hook in `listen`.
3. Add a pure mapper from track info to `VisualizerTrackProfile`.
4. Add runtime setter support in `MusicVisualizer` for profile application.
5. Blend profile changes in `ExtendedPlayer`.
6. Add `Auto-adapt visualizer` preference.
7. Tune heuristics with real library content.
8. Only then consider `bliss_signature`.

## Concrete Recommendation

Build this feature in `listen` only, as a hybrid system:

- live audio stays in charge of motion
- track analysis sets the baseline scene personality
- user settings remain the base layer
- `bliss` enters only in phase 2 as a derived signature

That is the highest-value path with the lowest risk.

## Branch

Working branch created for this exploration:

- `codex/visualizer-audio-reactivity-plan`
