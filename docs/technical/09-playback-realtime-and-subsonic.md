# Playback, Realtime, Visualizer, and Subsonic

## Listen playback architecture

Playback is a defining subsystem of `app/listen`, not a peripheral utility.

The central state coordinator is [app/listen/src/contexts/PlayerContext.tsx](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/PlayerContext.tsx).

The player is built around these ideas:

- one queue model owned by React
- one real audio engine
- explicit playback persistence
- explicit soft interruption and recovery logic
- event-based telemetry and history

## Audio engine

The active engine wrapper is [app/listen/src/lib/gapless-player.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/gapless-player.ts), which wraps `Gapless-5`.

Responsibilities of the wrapper:

- initialize the engine once
- configure crossfade
- expose queue-loading and track-mutation operations
- expose track position and duration
- expose the active `AnalyserNode`
- implement fade-in and fade-out helpers over volume changes
- normalize playlist internals so React remains the source of truth for play order

## Why Gapless-5

Listen needs playback features that a raw `HTMLAudioElement` approach handles poorly:

- gapless playback
- equal-power crossfade
- robust handoff between adjacent tracks
- analyser access while keeping an engine abstraction

Gapless-5 provides the lower-level playback machinery, while Crate adds product logic above it.

## PlayerContext responsibilities

The player context owns:

- queue
- current index
- current track
- repeat and shuffle state
- current time and duration
- playback and buffering state
- volume
- recently played
- crossfade transition metadata
- playback source

It also coordinates several supporting hooks:

- play-event tracker
- playback intelligence
- playback persistence
- restore on mount
- soft interruption
- media session
- keyboard shortcuts

## Playback persistence

Listen persists enough state to continue a session after reload:

- queue
- current index
- current time
- playing flag
- shuffle state
- unshuffled baseline queue

This logic is split into dedicated hooks and helpers rather than being embedded monolithically in the main player file.

## Soft interruption and recovery

Listen deliberately distinguishes:

- explicit user pause
- soft interruption due to buffering/network/server failure

The recovery logic aims to:

- fade down rather than hard-cut
- probe for connectivity recovery
- resume playback when appropriate

This is one of the places where the player tries to feel like a premium consumer app rather than a raw browser audio demo.

## Infinite playback and intelligence

`usePlaybackIntelligence` extends the queue dynamically for:

- radio continuation
- autoplay-style infinite playback
- suggestion cadence

This means the queue is not always a static list chosen up front. It can become a live product surface.

## Playback telemetry

Listen tracks play events and history, not just UI state.

Pieces involved:

- [app/listen/src/contexts/use-play-event-tracker.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-play-event-tracker.ts)
- [app/listen/src/lib/play-event-queue.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/play-event-queue.ts)

Important behaviors:

- events are queued offline when needed
- retries are persistent
- account switches/logouts clear pending telemetry to avoid cross-user leakage

## Visualizer architecture

The visualizer is a substantial subsystem, not a toy canvas.

Relevant code:

- [app/listen/src/hooks/use-audio-visualizer.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/hooks/use-audio-visualizer.ts)
- [app/listen/src/components/player/visualizer/useMusicVisualizer.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/components/player/visualizer/useMusicVisualizer.ts)
- [app/listen/src/components/player/visualizer/MusicVisualizer.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/components/player/visualizer/MusicVisualizer.ts)
- renderer and geometry modules under the same directory

Key design decisions:

- use the engine's real analyser node
- do not build a second competing audio graph
- drive palette and style from album/track context
- keep a dedicated visualization preference layer

## Media session and shortcuts

Listen integrates playback with the host platform through:

- media session metadata and controls
- keyboard shortcuts
- player chrome state
- mobile lock-screen style behavior where available

This is essential for the app to feel native-ish on both desktop and mobile.

## Realtime: SSE versus websocket

Crate uses different realtime transports for different jobs:

### SSE

Used for:

- task and global events
- cache invalidation/event streams

Why SSE:

- simple server push
- easy fit for status/event streams
- enough for mostly append-only operational events

### WebSocket

Used for:

- jam sessions

Why websocket:

- bidirectional room communication
- low-latency shared queue and playback control
- presence updates

## Jam rooms

Jam sessions are implemented in [app/crate/api/jam.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/jam.py).

The model includes:

- room creation
- invite issuance and join
- host and collaborator roles
- persisted room state
- websocket room hub
- room events and presence

Playback control events include:

- `play`
- `pause`
- `seek`
- queue mutations

The goal is coordinated playback control, not sample-perfect audio sync.

## Subsonic compatibility

Crate also exposes a Subsonic/Open Subsonic compatible API in [app/crate/api/subsonic.py](https://github.com/diego-ninja/crate/blob/main/app/crate/api/subsonic.py).

This allows external players to:

- authenticate
- browse artists and albums
- fetch cover art
- stream tracks

This matters because Crate is not only its own client ecosystem. It can also serve as the backend for third-party listening apps.

## Design decisions in this layer

### Why React owns queue order

Crate wants queue state to remain product-controlled and inspectable in the UI.

That is why the Gapless wrapper normalizes playlist internals instead of letting the engine invent a separate shuffle/order model.

### Why visualizer uses the engine analyser directly

A second ad hoc audio pipeline would drift from the real playback engine and make crossfade/seek/pause behavior harder to reason about.

Using the engine's analyser keeps playback and visualization aligned.

### Why jam sessions are private invite rooms

This keeps the first version manageable:

- smaller permissions surface
- easier product model
- less moderation complexity
- more plausible UX for shared listening among friends

## Related documents

- [Auth, Sessions, Users, and Social Layer](/technical/auth-users-social-and-sessions)
- [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
- [Development, Deployment, and Operations](/technical/development-deployment-and-operations)
