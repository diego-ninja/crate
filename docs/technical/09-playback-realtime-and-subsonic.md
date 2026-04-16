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

The active engine wrapper is [app/listen/src/lib/gapless-player.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/gapless-player.ts), which wraps a **vendored fork** of Gapless-5 living at [app/listen/src/lib/gapless5/](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/gapless5).

Responsibilities of the wrapper:

- initialize the engine once
- configure crossfade (equal-power curve, user-tunable duration)
- expose queue-loading and track-mutation operations
- expose track position and duration
- expose the active `AnalyserNode` for the visualizer
- expose the post-processing output chain for the equalizer
- implement fade-in and fade-out helpers over volume changes
- normalize playlist internals so React remains the source of truth for play order
- expose `isCurrentTrackFullyBuffered()` for offline-resilient interruption handling

### Why Gapless-5, and why vendored

Listen needs playback features that a raw `HTMLAudioElement` approach
handles poorly: true gapless transitions, equal-power crossfade, a stable
analyser node, and sample-perfect handoff between adjacent tracks.
Gapless-5 provides all of that.

Crate vendored the library rather than pulling it from npm because the
integration needed a few patches the upstream does not ship, and the
project prefers owning that surface over carrying them as monkey-patches:

1. **`masterOut` gain node** — a single `GainNode` between every source
   and the destination so post-processing (equalizer, future compressor)
   can be inserted in one place.
2. **`setOutputChain(input, output)`** — splice arbitrary processing
   between `masterOut` and `destination`, with `null` restoring direct
   output.
3. **XHR fail-safe during HTML5 playback** — a failed WebAudio preload
   no longer tears down the active track if the HTML5 element is
   already playing. The user just misses the sample-perfect upgrade.
4. **HTML5 error fail-safe under WebAudio** — once WebAudio has taken
   over (RAM-resident buffer), errors on the now-dormant `<audio>`
   element stop escalating; the track keeps playing from RAM.

The header of [gapless5.js](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/gapless5/gapless5.js) documents each patch with enough detail to reapply them against a
future upstream version if we ever want to reconcile.

### loadLimit

`Gapless-5` is configured with `loadLimit: 2` (current + next). With the
default (`-1`, unlimited) a 50-track playlist fires 100+ parallel HTTP
requests — one XHR and one HTML5 `<audio>` per source — which saturates
the browser connection pool and stretches first-track-to-audio latency
past five seconds. Two is the sweet spot: gapless transitions still have
the next track decoded by the time the current one ends, and the
browser stays responsive.

## PlayerContext responsibilities

The player context owns:

- queue (including an un-shuffled baseline so toggling shuffle is a round-trip)
- current index
- current track
- repeat and shuffle state
- current time and duration
- playback and buffering state
- volume
- recently played
- crossfade transition metadata (outgoing + incoming tracks during the fade window)
- playback source (album, playlist, radio, jam, …)

The context is composed of focused hooks rather than one monolithic
reducer. Each hook owns one concern and can be tested in isolation:

- [use-play-event-tracker.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-play-event-tracker.ts) — deduplicated play-event emission with explicit session lifecycle.
- [use-playback-intelligence.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-playback-intelligence.ts) — radio refill, suggestion insertion, verb-oriented API.
- [use-playback-persistence.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-playback-persistence.ts) — writes queue/index/time/shuffle to localStorage.
- [use-restore-on-mount.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-restore-on-mount.ts) — rebuilds the previous session after reload.
- [use-soft-interruption.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-soft-interruption.ts) — stall detection, probe-and-resume.
- media session + keyboard shortcuts.

### Visual crossfade

During the real audio crossfade, PlayerContext exposes a
`crossfadeTransition` object with the outgoing and incoming tracks plus
a normalised progress value. The FullscreenPlayer, PlayerBar, and
ExtendedPlayer use it to:

- cross-fade album artwork between tracks (two stacked `<img>` with
  inverse opacities)
- cross-fade title and artist text
- interpolate the visualizer palette between outgoing and incoming
  track analyses
- keep the progress bar anchored to the still-audible outgoing track
  rather than jumping to the incoming one at fade start

All of this rides on the same progress value that drives the audio
fade, so what the user sees and what the user hears stay in lockstep.

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

The recovery logic, in [use-soft-interruption.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/contexts/use-soft-interruption.ts), aims to:

- fade down rather than hard-cut on stall
- probe for connectivity recovery (HEAD on the current stream URL with a 4 s deadline)
- resume playback with a fade-in when the probe succeeds
- react to browser `online`/`offline` events and the app-level `crate:network-restored` event

### Why offline does not always mean "pause"

Once the current track's audio is fully decoded into the WebAudio buffer,
the user is listening from RAM. The network is irrelevant for the rest of
that track. All three error paths (browser offline event, XHR failure,
HTML5 audio error, stall watchdog) consult `isCurrentTrackFullyBuffered()`
before escalating, and short-circuit if the RAM buffer will carry the
playback to the end. Only genuine stalls — current track not yet buffered
and audio actually stopped advancing — trigger the pause-and-probe loop.

This combination of vendored patches at the engine layer and guards at
the React layer is what lets Listen survive mid-track wifi drops without
stopping the music.

## Equalizer

Listen ships a 10-band graphic equalizer that runs as post-processing
between Gapless-5's `masterOut` and the speakers. Implementation is split
across three files:

- [equalizer.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/equalizer.ts) — `BiquadFilterNode` chain, presets, ramped gain changes.
- [equalizer-prefs.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/equalizer-prefs.ts) — localStorage persistence of enabled state, preset, custom gains, and adaptive flags.
- [use-equalizer.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/hooks/use-equalizer.ts) — React hook that subscribes to prefs and keeps the engine chain in sync.

### Bands

32, 64, 125, 250, 500, 1K, 2K, 4K, 8K, 16K Hz — peaking filters with
Q ≈ 1.41 (roughly one octave bandwidth per band). Gains clamp to
±12 dB.

### Ramping

Gain changes don't snap; they ramp over 80 ms via `cancelScheduledValues`
+ `setValueAtTime` + `linearRampToValueAtTime`. Drag a slider, switch a
preset, or jump tracks in adaptive mode — the biquads glide to the new
curve without zipper or click artefacts. `cancelScheduledValues` on
every call prevents queued ramps from stacking during a drag.

### Presets

~20 presets covering both general-purpose (rock, pop, jazz, classical,
acoustic, electronic, hip-hop, bass boost, treble boost, vocal) and
underground genres tuned specifically for each style's mixing
conventions: black metal (tremolo picking presence, scooped mids),
death metal (kick + guitar body, classic mid scoop), thrash (V-shape),
doom (massive low end, dark top), hardcore, punk, shoegaze, post-rock,
etc.

### Adaptive mode

Feature-adaptive EQ reads the per-track analysis payload from
`/api/tracks/{id}/eq-features` and applies a "nudge, don't sculpt"
heuristic ([adaptive-eq.ts](https://github.com/diego-ninja/crate/blob/main/app/listen/src/lib/adaptive-eq.ts)):

- bright tracks (spectral complexity high) get their 4–8K shelf tamed
- dark tracks get a gentle air lift
- hot masters (loudness > -10 LUFS) get a subtle 1–2K pullback
- compressed tracks (dynamic range < 6 dB) get a mild V-shape
- high-energy tracks reinforce sub/kick, low-energy warm the low mids
- total adjustment clamps to ±4 dB per band
- highly dynamic tracks (DR > 14) escape hatch to flat

### Genre-adaptive mode

The alternative mode picks a preset from the track's primary genre via
the taxonomy graph. The backend resolves inheritance: a canonical slug
with its own `eq_gains` returns directly; a slug with `NULL` walks up
through parents BFS until it finds one. `/api/tracks/{id}/genre`
returns the resolved gains along with `source: "direct" | "inherited"`
and `inheritedFrom: { slug, name }` for UI transparency.

Adaptive and Genre-adaptive are mutually exclusive; enabling one
disables the other in both localStorage and runtime state.

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
