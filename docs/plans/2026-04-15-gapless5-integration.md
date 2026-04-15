# Gapless-5 Integration Plan

## Goal
Replace raw HTMLAudioElement playback with Gapless-5 for crossfade, gapless, and resilient playback.

## Strategy
Gapless-5 manages its own queue and audio elements internally. PlayerContext keeps its React state (queue, currentIndex, isPlaying, etc) but delegates all audio operations to gapless-player.ts.

## What changes

### PlayerContext removes:
- audioRef / preloadAudioRef (Gapless-5 owns the elements)
- getSharedAudio calls
- All audio.addEventListener (replaced by Gapless-5 callbacks)
- audio.src assignments
- audio.play() / audio.pause() direct calls
- preload logic (Gapless-5 handles this)

### PlayerContext keeps:
- Queue state (queue[], currentIndex, shuffle, repeat)
- UI state (isPlaying, isBuffering, currentTime, duration)
- Play event tracking / scrobbling
- Recently played
- Infinite playback / smart suggestions
- Volume (delegated to gapless-player.setVolume)

### Mapping:
| PlayerContext action | Before | After |
|---------------------|--------|-------|
| play(track) | audio.src = url; audio.play() | loadQueue([url]); gp.play() |
| playAll(tracks, i) | audio.src = url; audio.play() | loadQueue(urls); gp.gotoTrack(i) |
| pause | audio.pause() | gp.pause() with fade |
| resume | audio.play() | gp.play() with fade |
| next | setCurrentIndex(i+1) | gp.next() |
| prev | setCurrentIndex(i-1) | gp.prev() |
| seek | audio.currentTime = t | gp.setPosition(ms) |
| volume | audio.volume = v | gp.setVolume(v) |
| timeupdate | audio event | gp.ontimeupdate |
| ended | audio event | gp.onfinishedtrack |
| error | audio event | gp.onerror |

### Visualizer:
- gp.onplay provides AnalyserNode directly
- use-audio-visualizer reads from getAnalyserNode() instead of creating its own
