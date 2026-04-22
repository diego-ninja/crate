/**
 * Gapless audio player wrapper around Gapless-5.
 *
 * Provides crossfade, gapless playback, and exposes the AnalyserNode
 * for the visualizer. Replaces the raw HTMLAudioElement approach.
 */

import { Gapless5 } from "@/lib/gapless5/gapless5";
import { createEqChain, isFlatGains, type EqChain, type EqGains } from "@/lib/equalizer";
import { getCrossfadeDurationPreference } from "./player-playback-prefs";

// Gapless-5 doesn't expose its playlist internals on the public type,
// but we need a couple of fields to keep play order in sync. Centralized
// here so the unsafe cast lives in one place.
interface GaplessPlaylistInternal {
  shuffledIndices: number[];
  sources: unknown[];
}
type GaplessInternal = Gapless5 & { playlist?: GaplessPlaylistInternal };
function getPlaylistInternal(): GaplessPlaylistInternal | null {
  return (instance as GaplessInternal | null)?.playlist ?? null;
}

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
// True once the current track's audio is fully decoded into the
// WebAudio buffer (RAM). In that state, network loss cannot stop
// playback — the consumer (soft-interruption logic) can use this to
// decide whether it's worth pausing on an offline event.
let currentTrackFullyBuffered = false;
// Holds the resolver of the currently-running fade so a new fade can
// settle the previous promise cleanly (instead of leaking it forever).
let fadeSettle: (() => void) | null = null;
// Active equalizer chain (null = direct output, no processing).
let eqChain: EqChain | null = null;
let eqEnabled = false;

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

/**
 * True when the current track's audio has been fully decoded into the
 * WebAudio buffer — i.e. the playback does not depend on the network
 * any more. Useful for deciding whether an offline event should pause
 * the player at all (if RAM has the whole thing, it shouldn't).
 */
export function isCurrentTrackFullyBuffered(): boolean {
  return currentTrackFullyBuffered;
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
  // Settle any pending fade promise from the previous animation so
  // awaiters of fadeInAndPlay / fadeOutAndPause never hang.
  if (fadeSettle) {
    const settle = fadeSettle;
    fadeSettle = null;
    settle();
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

  // Register onDone as the fade settler. It will be called either on
  // completion (progress >= 1) or on cancellation (stopFade).
  fadeSettle = onDone ?? null;

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / safeDuration);
    applyVolume(from + (to - from) * progress);
    if (progress >= 1) {
      fadeFrame = null;
      const settle = fadeSettle;
      fadeSettle = null;
      settle?.();
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
    // Only keep the current + next track loaded at once. Default is -1
    // (no limit) which fires dozens of parallel XHR+HTML5 loads on
    // large playlists, saturating the browser connection pool and
    // causing noticeable latency before the current track starts.
    loadLimit: 2,
  });
  appliedVolume = lastVolume;

  instance.ontimeupdate = (posMs, trackIndex) => {
    currentCallbacks.onTimeUpdate?.(posMs, trackIndex);
  };

  instance.onplayrequest = (path) => {
    currentCallbacks.onPlayRequest?.(path);
  };

  instance.onplay = (path, analyser) => {
    // analyser is only emitted when WebAudio is the live source.
    // Presence here means the track's buffer is already decoded in RAM
    // (the "switched" case where onplay replaces onswitchtowebaudio).
    currentTrackFullyBuffered = analyser != null;
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
    // HTML5 → WebAudio switch. From this moment the track plays from
    // RAM; network failures are survivable.
    currentTrackFullyBuffered = true;
    setAnalyser(analyser);
  };

  return instance;
}

export function destroyPlayer(): void {
  stopFade();
  if (eqChain) {
    eqChain.dispose();
    eqChain = null;
  }
  eqEnabled = false;
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
  // Avoids interrupting playback on structurally identical resyncs.
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

  // CRITICAL: Gapless-5's playlist.add() inserts into shuffledIndices at
  // a random position on every call (gapless5.js:814). When shuffleMode
  // is on, the queue ends up in random order instead of the order we
  // passed in. Normalize shuffledIndices to identity so the engine's
  // play order matches the caller's URL list exactly.
  //
  // This makes the React queue the single source of truth for play
  // order. If the UI wants shuffle, it reorders the React queue itself
  // and we feed the engine that same order.
  const playlist = getPlaylistInternal();
  if (playlist && urls.length > 0) {
    playlist.shuffledIndices = urls.map((_, i) => i);
  }

  if (urls.length > 0) {
    instance.gotoTrack(startIndex);
  }
}

/**
 * Gapless-5's playlist.add() inserts into shuffledIndices at a random
 * position. After any add/insert we rewrite shuffledIndices to identity
 * so the engine's play order stays in sync with the caller's queue
 * (which is already in the desired play order per loadQueue's contract).
 */
function normalizeShuffledIndices() {
  const playlist = getPlaylistInternal();
  if (!playlist) return;
  playlist.shuffledIndices = playlist.sources.map((_, i) => i);
}

export function addTrack(url: string): void {
  instance?.addTrack(url);
  normalizeShuffledIndices();
}

export function insertTrack(index: number, url: string): void {
  instance?.insertTrack(index, url);
  normalizeShuffledIndices();
}

export function removeTrack(indexOrUrl: number | string): void {
  instance?.removeTrack(indexOrUrl);
  normalizeShuffledIndices();
}

export function replaceTrack(index: number, url: string): void {
  instance?.replaceTrack(index, url);
  // replaceTrack swaps in-place, no shuffledIndices change needed.
}

/**
 * Resume the AudioContext if it's suspended. Mobile browsers require
 * a user gesture to activate the context — we call this from every
 * user-initiated play path so the first tap always unlocks audio.
 */
function ensureContextResumed(): void {
  const ctx = (instance as any)?.context as AudioContext | undefined;
  if (ctx?.state === "suspended") {
    void ctx.resume();
  }
}

export function play(): void {
  stopFade();
  ensureContextResumed();
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
  if (forcePlay) ensureContextResumed();
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

/**
 * @deprecated Shuffle is owned by the React layer (PlayerContext reorders
 * the queue and feeds the engine sequentially). Kept for API completeness;
 * do not call — using Gapless-5's shuffle alongside a pre-shuffled queue
 * causes a double-shuffle (see loadQueue for the details).
 */
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
  ensureContextResumed();
  applyVolume(0);
  instance.play();
  return new Promise((resolve) => {
    animateVolume(0, lastVolume, durationMs, resolve);
  });
}

/**
 * Restore applied volume to the last user-set value. Useful after a
 * cancelled fade leaves the player muted.
 */
export function restoreVolume(): void {
  applyVolume(lastVolume);
}

export function setLoop(enabled: boolean): void {
  if (!instance) return;
  instance.loop = enabled;
}

export function setSingleMode(enabled: boolean): void {
  if (!instance) return;
  instance.singleMode = enabled;
}

// ── Equalizer ────────────────────────────────────────────────────

/**
 * Enable/disable the post-processing equalizer and/or update its gains.
 * Safe to call at any time — no-op until the engine is initialised.
 *
 * When `enabled` is true and `gains` is non-flat, a BiquadFilter chain
 * is spliced between masterOut and destination via our vendored patch.
 * When disabled or flat, the chain is torn down so there is zero
 * processing overhead.
 */
export function setEqualizer(enabled: boolean, gains: EqGains): void {
  if (!instance) return;
  const patched = instance as Gapless5 & {
    setOutputChain: (i: AudioNode | null, o: AudioNode | null) => void;
    context?: AudioContext;
  };
  if (typeof patched.setOutputChain !== "function" || !patched.context) return;

  eqEnabled = enabled;

  // If the user wants flat output, skip the chain entirely — biquads
  // at 0 dB aren't quite a no-op (minor numerical error) and why pay
  // for unused DSP.
  const shouldProcess = enabled && !isFlatGains(gains);

  if (!shouldProcess) {
    if (eqChain) {
      patched.setOutputChain(null, null);
      eqChain.dispose();
      eqChain = null;
    }
    return;
  }

  if (!eqChain) {
    eqChain = createEqChain(patched.context);
    patched.setOutputChain(eqChain.input, eqChain.output);
  }
  eqChain.setGains(gains);
}

/** True if the equalizer chain is currently spliced into the output. */
export function isEqualizerActive(): boolean {
  return eqEnabled && eqChain !== null;
}
