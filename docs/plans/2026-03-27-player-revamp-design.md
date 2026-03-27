# Player Revamp Design

**Date**: 2026-03-27
**Status**: Approved

## Overview

Complete redesign of the audio player: taller bottom bar (96px), floating draggable player with WebGL shader visualizations, independent floating lyrics panel, drag-to-reorder queue.

## Bottom Bar (96px)

Always visible, autosuficiente for daily use.

**Layout (left to right):**
- Cover art (56x56, rounded-lg): click opens/closes floating player. Ring pulses with BPM.
- Info: title (bold), artist/album (muted, clickable), current lyric line (primary/60, synced only)
- Controls: prev/play-pause/next with draggable progress bar + timestamps
- Mini queue: 2-3 next tracks as pills (cover 24px + title truncated)
- Volume slider (mouse wheel support) + floating player toggle button

Background: color bars visualizer at opacity 8%.

## Floating Player (~420x520px)

Draggable panel, position saved in localStorage.

**Structure:**
- Top bar: drag handle, preset name, cycle arrows, close button
- WebGL shader canvas: fills 100% of card as background
- Overlay (backdrop-blur + text shadow):
  - Cover art 120x120, rounded-xl, ring with BPM-synced glow
  - Title + Artist/Album (clickable)
  - Draggable progress bar with timestamps
  - Controls: shuffle, prev, play/pause, next, repeat
- Tabs at bottom: Queue | Lyrics
  - Queue: scrollable list, drag-to-reorder via @dnd-kit
  - Lyrics: synced/plain display (same as floating lyrics content)

Visual: rounded-2xl, shadow-2xl, border-white/10.

## Floating Lyrics Panel (~280x400px)

Independent draggable panel, teleprompter style.

**Behavior:**
- Synced: auto-scroll, active line in text-primary with scale-[1.05] and glow
- Lines fade via gradient mask (top and bottom)
- Click on line: seek to that timestamp
- Plain: manual scroll, no highlight
- Footer: indicator showing Synced/Plain mode

**Background:** bg-card/90 backdrop-blur-md

**Lyrics cache (backend):**
- Table: `lyrics_cache (artist, title, synced_lyrics, plain_lyrics, source, fetched_at)`
- Endpoint: `GET /api/lyrics/{artist}/{title}` — DB cache > lrclib.net fetch > store
- Worker task: embed lyrics in audio file tags (USLT/SYLT for ID3, LYRICS for Vorbis)

## WebGL Shader System

**Data pipeline:**
```
HTMLAudioElement → AudioContext → AnalyserNode (FFT=256, 128 bins)
                                       ↓
                                 ShaderEngine
                                 ├── u_frequencies[128]  (real-time)
                                 ├── u_time, u_bpm, u_energy
                                 ├── u_bass, u_mids, u_treble
                                 ├── u_beat (onset detection, exponential decay)
                                 └── u_resolution
```

Beat detection: monitor bass energy frame-by-frame, spike vs moving average triggers u_beat=1.0, decays 0.95x/frame.

**5 Presets (fragment shaders):**

| Preset | Style | Audio mapping |
|--------|-------|---------------|
| Nebula | Cosmic clouds cyan/blue | bass→expansion, treble→brightness, BPM→flow speed |
| Prism | Fractal geometry, polygons | frequencies→vertices, energy→complexity, key→symmetry |
| Aurora | Fluid waves, northern lights | mids→undulation, bass→color intensity, BPM→wave speed |
| Pulse | Particles exploding from center | beat onset→explosions, energy→density, loudness→radius |
| Void | Minimal concentric circles | frequencies→ring radius, calm, meditative |

Canvas runs at 60fps independent of React. Pauses when floating player is closed.

## Queue Management

- Drag-to-reorder via @dnd-kit/core + @dnd-kit/sortable
- Current track pinned (not draggable)
- Click track to jump, hover to reveal remove button
- Mini queue in bottom bar: 2-3 next tracks as pills

## Keyboard Shortcuts (new)

- V: toggle floating player
- L: toggle lyrics panel
- 1-5: change shader preset (when floating open)
- Mouse wheel on volume: adjust volume

## File Structure

```
components/player/
├── BottomBar.tsx           ← 96px bottom bar
├── FloatingPlayer.tsx      ← draggable visualizer + controls + tabs
├── FloatingLyrics.tsx      ← independent lyrics teleprompter
├── DraggablePanel.tsx      ← generic draggable wrapper
├── QueueList.tsx           ← drag-to-reorder list
├── ShaderEngine.ts         ← WebGL context manager
└── shaders/
    ├── vertex.glsl
    ├── nebula.glsl
    ├── prism.glsl
    ├── aurora.glsl
    ├── pulse.glsl
    └── void.glsl
```

## Dependencies

- @dnd-kit/core + @dnd-kit/sortable (~15KB gzip)
- WebGL: native browser API, no library

## Implementation Phases

1. ShaderEngine + 5 shaders (testeable standalone)
2. FloatingPlayer with shader canvas
3. BottomBar replacing current mini player
4. FloatingLyrics + backend lyrics cache
5. QueueList with drag-to-reorder
6. Cleanup: remove old AudioPlayer, unused visualizers
