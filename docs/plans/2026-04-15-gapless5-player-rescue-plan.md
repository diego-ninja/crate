# Gapless-5 Player Rescue and Integration Plan

## Context

The current `feat/playback-resilience` branch aims to make Gapless-5 the main playback engine for `listen`, with:

- gapless playback
- crossfade
- smoother pause/resume with fade in/out
- better buffering and retry behavior
- tighter visualizer integration

That direction is correct, but the current implementation is hybrid:

- Gapless-5 has been introduced as a playback engine
- the legacy shared `HTMLAudioElement` is still kept alive and still drives important parts of the app
- `PlayerContext` mutates React queue state independently of the engine queue
- visualizer, telemetry, restore, media session, and buffering are still partially attached to the legacy element

This leaves the player in a split-brain state: one engine is playing audio, while another element is still treated as the source of truth by the rest of the app.

## Goal

Make Gapless-5 the **only real playback engine** in `listen`, fully integrated with:

- PlayerContext state
- queue mutations
- track transitions
- history/scrobble/play events
- media session
- keyboard controls
- visualizer
- restore/resume
- buffering/retry behavior
- fade in / fade out

The target is **not** a rollback to the old player. The target is a clean, complete migration to Gapless-5.

## Non-goals

- No changes to `admin` playback
- No broad UI redesign
- No changes to unrelated identity/social/storage work
- No multi-engine fallback architecture in the final result

## Current critical issues

### 1. Wrong OAuth host

In [app/crate/api/auth.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/auth.py), provider login URLs were changed to `admin.{DOMAIN}`. In this repo:

- `admin.*` is frontend
- `listen.*` is frontend
- `api.*` is FastAPI

So OAuth start URLs must point to the API host, not the frontend host.

### 2. React playback state is not driven by the engine

In [app/listen/src/contexts/PlayerContext.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/PlayerContext.tsx):

- Gapless-5 is initialized
- but track completion and transition logic still lives on the legacy `audio` element
- `currentIndex`, `currentTrack`, history flushing, and media session are not truly driven by Gapless track changes

### 3. Queue state diverges from engine state

Queue mutation helpers:

- `playNext`
- `addToQueue`
- `removeFromQueue`
- `reorderQueue`
- radio refill
- infinite playback continuation

currently update React state but do not update the real engine queue.

### 4. Legacy audio element is still exposed as if it were the player

`audioElement: audioRef.current` is still exposed from `PlayerContext`, but Gapless-5 is now the real playback engine. This breaks:

- visualizer input
- currentTime/duration reads
- buffering/retry logic
- any consumer reading `paused`, `volume`, or `currentTime`

### 5. Restore, preload, and retry still depend on the old engine

Several effects still:

- assign `audio.src`
- preload the next track manually on a secondary audio element
- restore playback position through the legacy element
- attach buffering/error listeners to the wrong element

## Target architecture

## 1. One engine only

Gapless-5 becomes the only playback engine in `listen`.

The app must no longer depend on:

- `audioRef` as a playback source
- `preloadAudioRef` as a preloading source
- `audio.src = ...`
- `audio.play()`
- `audio.pause()`
- `audio.ended`
- `audio.timeupdate`

Those are implementation details of the old player and must leave the playback hot path.

## 2. PlayerContext becomes orchestration only

`PlayerContext` should own:

- queue
- currentIndex
- currentTrack
- playSource
- isPlaying
- isBuffering
- currentTime
- duration
- volume
- repeat
- shuffle
- recentlyPlayed

But it should **not** directly drive playback with DOM media APIs.

Instead, `PlayerContext` listens to events coming from the engine adapter and updates React state accordingly.

## 3. A single engine adapter layer

We should consolidate the public engine interface in [app/listen/src/lib/gapless-player.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/lib/gapless-player.ts).

It should expose:

- `initPlayer(callbacks)`
- `destroyPlayer()`
- `loadQueue(urls, startIndex)`
- `replaceQueue(urls, startIndex, preservePlaybackState?)`
- `play()`
- `pause()`
- `stop()`
- `next()`
- `prev()`
- `seekTo(ms)`
- `setVolume(vol)`
- `setShuffle(enabled)`
- `setRepeat(mode)`
- `getCurrentTrackUrl()`
- `getTrackIndex()`
- `getPosition()`
- `getAnalyserNode()`

And callback hooks:

- `onPlay`
- `onPause`
- `onTrackFinished`
- `onQueueFinished`
- `onTrackChanged`
- `onTimeUpdate`
- `onDurationChange`
- `onBufferingStart`
- `onBufferingEnd`
- `onError`
- `onAnalyserReady`

Important:

- The adapter must be the only code that talks directly to Gapless-5.
- `PlayerContext` should not call `getPlayer()?.gotoTrack(...)` directly.

## 4. Queue synchronization model

React queue and engine queue must never drift.

Recommended model:

- React keeps canonical queue state for rendering and app logic
- every queue mutation computes a `nextQueue` and a `nextIndex`
- immediately after that, `gapless-player.replaceQueue(nextQueueUrls, nextIndex, ...)` is called

This applies to:

- `play`
- `playAll`
- `jumpTo`
- `playNext`
- `addToQueue`
- `removeFromQueue`
- `reorderQueue`
- radio continuation
- infinite playback
- suggestion insertion

If we skip this, we keep the split-brain bug.

## 5. Visualizer consumes analyser, not legacy audio element

Current consumers:

- [app/listen/src/hooks/use-audio-visualizer.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/hooks/use-audio-visualizer.ts)
- [app/listen/src/components/player/visualizer/useMusicVisualizer.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/visualizer/useMusicVisualizer.ts)
- [app/listen/src/components/player/ExtendedPlayer.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/ExtendedPlayer.tsx)
- [app/listen/src/components/player/FullscreenPlayer.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/FullscreenPlayer.tsx)

Need to change the contract from:

- `audioElement`

to:

- `analyserNode`
- or `getAnalyserNode`
- plus playback state if required

The visualizer must observe the real engine audio graph, not a compatibility element.

## 6. Telemetry must follow track transitions from the engine

The logic in:

- [app/listen/src/contexts/use-play-event-tracker.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/use-play-event-tracker.ts)
- [app/listen/src/contexts/PlayerContext.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/PlayerContext.tsx)

must move from legacy `ended`-based behavior to engine-driven track lifecycle events.

We need three explicit transition points:

- current track started
- current track interrupted/skipped
- current track completed

The engine adapter should emit enough information so `PlayerContext` can flush the correct event before state advances.

## 7. Media session and keyboard shortcuts must depend on real state

These should continue working via:

- [app/listen/src/contexts/use-media-session.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/use-media-session.ts)
- [app/listen/src/contexts/use-player-shortcuts.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/use-player-shortcuts.ts)

But they must only read state produced by the engine.

They should not inspect a stale `audioElement`.

## 8. Restore/resume must load through Gapless-5

Restoring a previous session should do:

1. restore saved queue
2. restore saved index
3. initialize Gapless queue with that track list
4. seek to saved position through the engine
5. update React state from the engine

We should not restore position by assigning `audio.src` on the old media element.

## 9. Retry and buffering should be engine-aware

The new [app/listen/src/lib/audio-engine.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/lib/audio-engine.ts) has useful ideas:

- fade out during stalls
- retry with backoff
- resume on reconnect

But right now it is tied to a legacy `HTMLAudioElement`.

We need to decide:

- either rework this into a Gapless-aware helper
- or keep only the simpler parts for now and defer advanced retry until the main integration is stable

Recommendation:

- keep buffering state
- keep fade in/out support
- keep reconnect signaling
- defer advanced retry logic unless Gapless gives us strong control over the underlying media state

## 10. Remove `audioElement` from PlayerContext public contract

Final public contract should not expose a fake player element.

Instead expose:

- `currentTime`
- `duration`
- `isPlaying`
- `isBuffering`
- `volume`
- `analyserNode` or `getAnalyserNode`

Only expose an `audioElement` again if it is guaranteed to be the actual source of playback.

## Delivery phases

## Phase 1: Hotfix critical non-player regression

### 1.1 Fix OAuth host

Update [app/crate/api/auth.py](/Users/diego/Code/Ninja/musicdock/app/crate/api/auth.py):

- provider `login_url` must point to the API host
- `return_to` keeps redirecting to `admin` or `listen`

Acceptance:

- Google login starts correctly from `listen`
- Google login starts correctly from `admin`

## Phase 2: Consolidate Gapless adapter

### 2.1 Make gapless-player.ts the only engine entrypoint

Refactor [app/listen/src/lib/gapless-player.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/lib/gapless-player.ts):

- add missing callbacks for state transitions
- add queue replacement API
- normalize event naming
- ensure duration updates are available
- expose analyser safely

### 2.2 Decide whether dual-deck.ts survives

Review [app/listen/src/lib/dual-deck.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/lib/dual-deck.ts):

- if Gapless-5 already handles gapless/crossfade correctly, remove it from the active design
- do not keep an unused second playback abstraction in parallel

Acceptance:

- one adapter only
- no direct `getPlayer()` calls outside the adapter layer

## Phase 3: Rewrite PlayerContext around the engine

### 3.1 Remove legacy playback control

In [app/listen/src/contexts/PlayerContext.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/contexts/PlayerContext.tsx):

- remove `audio.src` / `audio.play()` / `audio.pause()` playback control
- remove legacy preload/autoplay hot-path
- stop depending on `audio` events for track transition logic

### 3.2 Subscribe to engine callbacks

`PlayerContext` should subscribe once to engine lifecycle callbacks and keep React state in sync from those callbacks.

### 3.3 Make engine transitions authoritative

Track changes must be driven by engine events, not guessed from queued React updates.

Acceptance:

- next track after natural finish updates UI correctly
- current track title/art/metadata update immediately
- repeat/shuffle are honored by the engine and the UI stays in sync

## Phase 4: Queue synchronization

### 4.1 Implement `replaceQueue`

Every queue mutation should update both:

- React state
- engine queue

### 4.2 Audit all mutation sources

Must cover:

- player controls
- queue panel
- drag-and-drop reorder
- radio continuation
- infinite playback
- smart suggestions

Acceptance:

- queue UI and engine always reflect the same tracks, order, and current index

## Phase 5: Restore/resume migration

### 5.1 Remove legacy restore path

Replace saved-position restore in `PlayerContext` with engine-based restore.

### 5.2 Persist engine position correctly

Saved position must come from the actual engine position, not a stale DOM element.

Acceptance:

- reload mid-track resumes the correct track at the correct time

## Phase 6: Visualizer migration

### 6.1 Replace audioElement dependency

Update:

- [app/listen/src/hooks/use-audio-visualizer.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/hooks/use-audio-visualizer.ts)
- [app/listen/src/components/player/visualizer/useMusicVisualizer.ts](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/visualizer/useMusicVisualizer.ts)
- [app/listen/src/components/player/ExtendedPlayer.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/ExtendedPlayer.tsx)
- [app/listen/src/components/player/FullscreenPlayer.tsx](/Users/diego/Code/Ninja/musicdock/app/listen/src/components/player/FullscreenPlayer.tsx)

so they depend on the analyser provided by the engine.

### 6.2 Remove shared analyser assumptions tied to the old audio element

Acceptance:

- visualizer responds to the real currently playing track
- no silent analyser from an idle element

## Phase 7: Telemetry and scrobble correctness

### 7.1 Flush playback events from engine transitions

Make sure:

- skip flushes previous track correctly
- natural completion records completion correctly
- pause does not fake completion

### 7.2 Keep history and play-events exactly once

Acceptance:

- no duplicate history rows for one finish
- no stale track reported after auto-advance

## Phase 8: Fade and buffering polish

### 8.1 Pause/resume fade

Implement fade-out on pause and fade-in on resume through the real engine.

### 8.2 Buffering state

Map engine buffering signals into:

- `isBuffering`
- any retry or reconnect UI state

### 8.3 Retry strategy

Only keep retry logic that works against the real engine state.

Acceptance:

- pause/resume feels smooth
- buffering indicator reflects real playback stalls

## Phase 9: Remove stale compatibility paths

Once the above is green:

- remove `audioElement` from public `PlayerContext` contract
- remove legacy preload path
- remove legacy ended/timeupdate/seek listeners
- remove dead code paths in `PlayerContext`
- remove any unused wrappers not part of the final design

## Validation checklist

## Core playback

- Play a single track
- Pause / resume
- Seek forward / backward
- Next / previous
- Change volume
- Mute / unmute if present

## Queue

- Play album
- Play playlist
- Play radio
- Add to queue
- Play next
- Remove from queue
- Reorder queue
- Jump to queue item

## Transitions

- Natural end advances correctly
- Repeat one works
- Repeat all works
- Shuffle works
- Gapless transition between continuous tracks works
- Crossfade works where enabled

## Integration

- Media session metadata stays correct
- Lock screen / headset controls work
- Visualizer reacts to the actual playing audio
- Recently played updates correctly
- History entry is written once
- Play event stats are correct

## Recovery

- Reload page with active queue restores state
- Resume at saved position works
- Temporary network loss does not corrupt state
- Reconnect does not produce duplicate playback

## Acceptance criteria for merge

This work should not be considered complete until all of the following are true:

- Gapless-5 is the only playback engine
- no split-brain between engine and React queue
- no stale legacy `audioElement` exposed as current playback source
- visualizer is attached to the real analyser
- history/scrobble/play-events are correct
- restore/resume works
- OAuth still works from both `admin` and `listen`

## Recommended execution order

1. Fix OAuth host regression
2. Consolidate `gapless-player.ts`
3. Rewrite `PlayerContext` around engine callbacks
4. Implement queue synchronization
5. Migrate restore/resume
6. Migrate visualizer
7. Fix telemetry/scrobble transitions
8. Add fade/buffering polish
9. Remove legacy playback paths
10. Run full manual validation matrix

## Notes

- The current legacy player can be used as a behavioral reference, but not as part of the final architecture.
- The final state must be a clean Gapless-5 integration, not a coexistence model.
