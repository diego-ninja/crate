/**
 * Gapless audio player wrapper around Gapless-5.
 *
 * Provides crossfade, gapless playback, and exposes the AnalyserNode
 * for the visualizer. Replaces the raw HTMLAudioElement approach.
 */

import { Gapless5 } from "@regosen/gapless-5";
import { getCrossfadeDurationPreference } from "./player-playback-prefs";

// The package's TS declarations don't expose these enums as named imports,
// but the runtime constants are stable in gapless5.js:
// LogLevel.Warning = 3, CrossfadeShape.EqualPower = 3.
const GAPLESS_LOG_LEVEL_WARNING = 3;
const GAPLESS_CROSSFADE_EQUAL_POWER = 3;

export interface GaplessPlayerCallbacks {
  onTimeUpdate?: (positionMs: number, trackIndex: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onPlayRequest?: (trackPath: string) => void;
  onPlay?: (trackPath: string) => void;
  onPause?: (trackPath: string) => void;
  onTrackFinished?: (trackPath: string) => void;
  onAllFinished?: () => void;
  onPrev?: (from: string, to: string) => void;
  onNext?: (from: string, to: string) => void;
  onLoad?: (trackPath: string, fullyLoaded: boolean, durationMs: number) => void;
  onError?: (trackPath: string, error: unknown) => void;
  onBuffering?: (trackPath: string) => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void;
}

let instance: Gapless5 | null = null;
let currentCallbacks: GaplessPlayerCallbacks = {};
let currentAnalyser: AnalyserNode | null = null;
let lastVolume = 1.0;
let appliedVolume = 1.0;
let fadeFrame: number | null = null;

const DEFAULT_FADE_MS = 220;

function getCrossfadeMs(): number {
  const seconds = getCrossfadeDurationPreference();
  return seconds * 1000;
}

export function getPlayer(): Gapless5 | null {
  return instance;
}

export function getAnalyserNode(): AnalyserNode | null {
  return currentAnalyser;
}

function setAnalyser(analyser: AnalyserNode | null) {
  if (!analyser || analyser === currentAnalyser) return;
  currentAnalyser = analyser;
  currentCallbacks.onAnalyserReady?.(analyser);
}

function stopFade() {
  if (fadeFrame != null) {
    cancelAnimationFrame(fadeFrame);
    fadeFrame = null;
  }
}

function applyVolume(vol: number) {
  const clamped = Math.max(0, Math.min(vol, 1));
  appliedVolume = clamped;
  instance?.setVolume(clamped);
}

function animateVolume(
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
) {
  stopFade();
  const start = performance.now();
  const safeDuration = Math.max(0, durationMs);
  if (safeDuration === 0) {
    applyVolume(to);
    onDone?.();
    return;
  }

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / safeDuration);
    applyVolume(from + (to - from) * progress);
    if (progress >= 1) {
      fadeFrame = null;
      onDone?.();
      return;
    }
    fadeFrame = requestAnimationFrame(tick);
  };

  fadeFrame = requestAnimationFrame(tick);
}

export function initPlayer(callbacks: GaplessPlayerCallbacks = {}): Gapless5 {
  if (instance) {
    currentCallbacks = callbacks;
    return instance;
  }

  currentCallbacks = callbacks;

  instance = new Gapless5({
    useHTML5Audio: true,
    useWebAudio: true,
    analyserPrecision: 2048,
    crossfade: getCrossfadeMs(),
    crossfadeShape: GAPLESS_CROSSFADE_EQUAL_POWER,
    volume: lastVolume,
    logLevel: GAPLESS_LOG_LEVEL_WARNING,
  });
  appliedVolume = lastVolume;

  instance.ontimeupdate = (posMs, trackIndex) => {
    currentCallbacks.onTimeUpdate?.(posMs, trackIndex);
  };

  instance.onplayrequest = (path) => {
    currentCallbacks.onPlayRequest?.(path);
  };

  instance.onplay = (path, analyser) => {
    setAnalyser(analyser);
    currentCallbacks.onPlay?.(path);
  };

  instance.onpause = (path) => {
    currentCallbacks.onPause?.(path);
  };

  instance.onprev = (from, to) => {
    currentCallbacks.onPrev?.(from, to);
  };

  instance.onfinishedtrack = (path) => {
    currentCallbacks.onTrackFinished?.(path);
  };

  instance.onfinishedall = () => {
    currentCallbacks.onAllFinished?.();
  };

  instance.onnext = (from, to) => {
    currentCallbacks.onNext?.(from, to);
  };

  instance.onerror = (path, err) => {
    currentCallbacks.onError?.(path, err);
  };

  instance.onloadstart = (path) => {
    currentCallbacks.onBuffering?.(path);
  };

  instance.onload = (path, fullyLoaded) => {
    const durationMs = getCurrentTrackDuration();
    currentCallbacks.onLoad?.(path, fullyLoaded, durationMs);
    currentCallbacks.onDurationChange?.(durationMs);
  };

  // Runtime (gapless5.js:309) calls this as (trackPath, analyser).
  instance.onswitchtowebaudio = (_path, analyser) => {
    setAnalyser(analyser);
  };

  return instance;
}

export function destroyPlayer(): void {
  stopFade();
  if (instance) {
    try {
      instance.stop();
      instance.removeAllTracks();
    } catch { /* ignore */ }
    instance = null;
    currentAnalyser = null;
  }
}

// ── Convenience methods ──────────────────────────────────────────

export function loadQueue(urls: string[], startIndex = 0): void {
  if (!instance) return;

  // Idempotent: if the incoming URL list is identical to what the engine
  // already has, don't rebuild the queue — just align the current track.
  // Avoids interrupting playback on structurally identical resyncs
  // (shuffle toggle, reorder-to-same, etc.).
  const currentUrls = instance.getTracks();
  const same =
    urls.length === currentUrls.length &&
    urls.every((url, i) => url === currentUrls[i]);
  if (same) {
    if (urls.length > 0 && instance.getIndex() !== startIndex) {
      instance.gotoTrack(startIndex);
    }
    return;
  }

  instance.removeAllTracks();
  for (const url of urls) {
    instance.addTrack(url);
  }
  if (urls.length > 0) {
    instance.gotoTrack(startIndex);
  }
}

export function addTrack(url: string): void {
  instance?.addTrack(url);
}

export function insertTrack(index: number, url: string): void {
  instance?.insertTrack(index, url);
}

export function removeTrack(indexOrUrl: number | string): void {
  instance?.removeTrack(indexOrUrl);
}

export function replaceTrack(index: number, url: string): void {
  instance?.replaceTrack(index, url);
}

export function play(): void {
  stopFade();
  instance?.play();
}

export function pause(): void {
  stopFade();
  instance?.pause();
}

export function stop(): void {
  stopFade();
  instance?.stop();
}

/**
 * Sequential skip forward. Enables crossfade when transitioning to the
 * next track (auto-advance uses the same internal path).
 */
export function next(): void {
  instance?.next(undefined, true, true);
}

/**
 * Sequential skip backward. Gapless-5's prev() doesn't support crossfade,
 * so this is always a hard cut.
 */
export function prev(): void {
  instance?.prev(undefined, false);
}

/**
 * Jump to an arbitrary track. Does NOT crossfade — use next()/prev()
 * for sequential skips that should respect the crossfade setting.
 */
export function gotoTrack(indexOrUrl: number | string, forcePlay = false): void {
  instance?.gotoTrack(indexOrUrl, forcePlay);
}

export function seekTo(positionMs: number): void {
  instance?.setPosition(positionMs);
}

export function setVolume(vol: number): void {
  lastVolume = vol;
  applyVolume(vol);
}

export function getPosition(): number {
  return instance?.getPosition() ?? 0;
}

export function getCurrentTrackDuration(): number {
  return instance?.currentLength() ?? 0;
}

export function getCurrentTrackUrl(): string {
  return instance?.getTrack() ?? "";
}

export function getTrackIndex(): number {
  return instance?.getIndex() ?? -1;
}

export function getTracks(): string[] {
  return instance?.getTracks() ?? [];
}

export function setShuffle(enabled: boolean): void {
  if (!instance) return;
  if (enabled && !instance.isShuffled()) {
    instance.shuffle(true);
  } else if (!enabled && instance.isShuffled()) {
    instance.toggleShuffle();
  }
}

export function updateCrossfade(): void {
  instance?.setCrossfade(getCrossfadeMs());
}

export function setCrossfadeDuration(durationMs: number): void {
  instance?.setCrossfade(Math.max(0, durationMs));
}

export function fadeOutAndPause(durationMs = DEFAULT_FADE_MS): Promise<void> {
  if (!instance) return Promise.resolve();
  const startVolume = appliedVolume;
  return new Promise((resolve) => {
    animateVolume(startVolume, 0, durationMs, () => {
      instance?.pause();
      applyVolume(lastVolume);
      resolve();
    });
  });
}

export function fadeInAndPlay(durationMs = DEFAULT_FADE_MS): Promise<void> {
  if (!instance) return Promise.resolve();
  stopFade();
  applyVolume(0);
  instance.play();
  return new Promise((resolve) => {
    animateVolume(0, lastVolume, durationMs, resolve);
  });
}

export function setLoop(enabled: boolean): void {
  if (!instance) return;
  instance.loop = enabled;
}

export function setSingleMode(enabled: boolean): void {
  if (!instance) return;
  instance.singleMode = enabled;
}
