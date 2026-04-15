/**
 * Gapless audio player wrapper around Gapless-5.
 *
 * Provides crossfade, gapless playback, and exposes the AnalyserNode
 * for the visualizer. Replaces the raw HTMLAudioElement approach.
 */

import { Gapless5 } from "@regosen/gapless-5";
import { getCrossfadeDurationPreference } from "./player-playback-prefs";

export interface GaplessPlayerCallbacks {
  onTimeUpdate?: (positionMs: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onPlay?: (trackPath: string) => void;
  onPause?: (trackPath: string) => void;
  onTrackFinished?: (trackPath: string) => void;
  onAllFinished?: () => void;
  onNext?: (from: string, to: string) => void;
  onError?: (trackPath: string, error: unknown) => void;
  onBuffering?: (trackPath: string) => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void;
}

let instance: Gapless5 | null = null;
let currentCallbacks: GaplessPlayerCallbacks = {};
let currentAnalyser: AnalyserNode | null = null;
let lastVolume = 1.0;

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

export function initPlayer(callbacks: GaplessPlayerCallbacks = {}): Gapless5 {
  if (instance) {
    currentCallbacks = callbacks;
    return instance;
  }

  currentCallbacks = callbacks;

  instance = new Gapless5({
    useHTML5Audio: true,
    useWebAudio: true,
    crossfade: getCrossfadeMs(),
    crossfadeShape: "EqualPower",
    volume: lastVolume,
    logLevel: "Info",
  });

  instance.ontimeupdate = (posMs: number) => {
    currentCallbacks.onTimeUpdate?.(posMs);
  };

  instance.onplay = (path: string, analyser: AnalyserNode | null) => {
    if (analyser && analyser !== currentAnalyser) {
      currentAnalyser = analyser;
      currentCallbacks.onAnalyserReady?.(analyser);
    }
    currentCallbacks.onPlay?.(path);
  };

  instance.onpause = (path: string) => {
    currentCallbacks.onPause?.(path);
  };

  instance.onfinishedtrack = (path: string) => {
    currentCallbacks.onTrackFinished?.(path);
  };

  instance.onfinishedall = () => {
    currentCallbacks.onAllFinished?.();
  };

  instance.onnext = (from: string, to: string) => {
    currentCallbacks.onNext?.(from, to);
  };

  instance.onerror = (path: string, err: unknown) => {
    currentCallbacks.onError?.(path, err);
  };

  instance.onloadstart = (path: string) => {
    currentCallbacks.onBuffering?.(path);
  };

  instance.onload = () => {
    // Track loaded — clear buffering state if needed
  };

  instance.onswitchtowebaudio = () => {
    // WebAudio loaded during HTML5 playback — analyser available
    return currentAnalyser;
  };

  return instance;
}

export function destroyPlayer(): void {
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

export function play(): void {
  instance?.play();
}

export function pause(): void {
  instance?.pause();
}

export function stop(): void {
  instance?.stop();
}

export function next(): void {
  instance?.next();
}

export function prev(): void {
  instance?.prev();
}

export function seekTo(positionMs: number): void {
  instance?.setPosition(positionMs);
}

export function setVolume(vol: number): void {
  lastVolume = vol;
  instance?.setVolume(vol);
}

export function getPosition(): number {
  return instance?.getPosition() ?? 0;
}

export function getCurrentTrackUrl(): string {
  return instance?.getTrack() ?? "";
}

export function getTrackIndex(): number {
  return instance?.getIndex() ?? -1;
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

export function setLoop(enabled: boolean): void {
  if (!instance) return;
  instance.loop = enabled;
}
