# Listen Player Preloading Roadmap

## Goal

Improve playback continuity in `listen` progressively, without jumping straight into a risky full player rewrite.

This roadmap is split into four phases so we can ship value early:

- Phase A: next-track preloading
- Phase B: dual-deck playback architecture
- Phase C: gapless playback
- Phase D: crossfade

## Constraints

- `listen` is `Navidrome first` for playback
- fallback playback remains Crate streaming by path
- mobile/PWA behavior matters
- avoid excessive network use on metered/mobile connections
- keep queue semantics stable while we evolve internals

## Phase A - Next-Track Preloading

### Goal

Reduce audible gaps and loading stalls by prebuffering the next predictable track.

### Scope

- keep the current single `HTMLAudioElement` as the active deck
- add a hidden preload audio element
- preload only when the next track is predictable
- start preloading near the end of the current track

### Rules

- preload only when:
  - there is a next track in queue
  - shuffle is off
  - repeat mode does not make the next transition ambiguous
- use the same final playback URL resolution as the active player
- clear preload when queue/order/current track changes

### Expected Outcome

- fewer end-of-track stalls
- better readiness for phase B
- low implementation risk

## Phase B - Dual-Deck Architecture

### Goal

Move from one active audio element to two coordinated decks:

- current deck
- next deck

### Scope

- deck A plays current track
- deck B preloads next track
- on transition, swap roles instead of cold-loading the next track

### Expected Outcome

- deterministic transition path
- cleaner foundation for gapless and crossfade

## Phase C - Gapless Playback

### Goal

Achieve truly seamless transitions for compatible formats and playback paths.

### Scope

- switch decks without a pause between tracks
- preserve queue/repeat/shuffle semantics
- detect when playback path/format makes gapless realistic

### Notes

- perfect gapless may differ between:
  - Navidrome/Subsonic stream path
  - direct Crate stream fallback
- the implementation should be best-effort and feature-detected

## Phase D - Crossfade

### Goal

Allow a controlled overlap between the current track tail and the next track intro.

### Scope

- short configurable fade window
- deck A fades out while deck B fades in
- disable or degrade gracefully when not compatible

### Notes

- crossfade should sit on top of the dual-deck architecture
- it should not be attempted before phase B is stable
- crossfade must yield to continuous album playback

## Playback Policy

- `gapless` is the base behavior whenever playback is sequential and the next deck is ready
- `crossfade` is an opt-in user preference layered on top of the same dual-deck architecture
- for continuous album playback, `gapless` takes priority and `crossfade` is suppressed
- initial continuous-album detection is heuristic:
  - playback source is `album`
  - shuffle is off
  - current and next track belong to the same album and artist

## Delivery Order

1. Phase A: ship now
2. Phase B: hidden architecture refactor, no heavy UI change
3. Phase C: opt-in gapless behavior
4. Phase D: optional crossfade on top

## Current Status

- buffering state + keyboard shortcuts already implemented
- Phase A initial next-track preloading implemented in `PlayerContext`
- Phase B/C/D were explored and then intentionally rolled back from runtime after regressions in playback controls and visualizers
- current runtime is back on the stable single-deck player, with the roadmap preserved for a safer second implementation pass
