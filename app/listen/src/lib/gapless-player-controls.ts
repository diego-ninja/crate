import { Gapless5 } from "@/lib/gapless5/gapless5";
import type { AudioRecoveryController } from "./gapless-player-audio-recovery";
import {
  animateVolume,
  applyVolume,
  getAppliedVolume,
  getLastVolume,
  setLastVolume,
  stopFade,
} from "./gapless-player-volume";

const DEFAULT_FADE_MS = 220;
const RESUMED_AUDIO_CONTEXT_RAMP_MS = 24;

export interface GaplessPlayerControlHost {
  audioRecovery: AudioRecoveryController;
  getAudioContext: () => AudioContext | null;
  getCrossfadeDurationMs: () => number;
  getPlayer: () => Gapless5 | null;
  isTauriDesktopRuntime: () => boolean;
  setLastPlaybackRate: (rate: number) => void;
  setPlaybackActive: (active: boolean) => void;
}

export interface GaplessPlayerControls {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  gotoTrack: (indexOrUrl: number | string, forcePlay?: boolean) => void;
  seekTo: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  getPosition: () => number;
  getCurrentBufferedAheadSeconds: () => number;
  getCurrentTrackDuration: () => number;
  getCurrentTrackUrl: () => string;
  getTrackIndex: () => number;
  getTracks: () => string[];
  setShuffle: (enabled: boolean) => void;
  updateCrossfade: () => void;
  setCrossfadeDuration: (durationMs: number) => void;
  fadeOutAndPause: (durationMs?: number) => Promise<void>;
  fadeInAndPlay: (durationMs?: number) => Promise<void>;
  restoreVolume: () => void;
  setLoop: (enabled: boolean) => void;
  setSingleMode: (enabled: boolean) => void;
}

export function createGaplessPlayerControls(
  host: GaplessPlayerControlHost,
): GaplessPlayerControls {
  const play = async (): Promise<void> => {
    stopFade();
    const shouldRampAfterResume =
      !host.isTauriDesktopRuntime() &&
      host.getAudioContext()?.state === "suspended";
    await host.audioRecovery.prepare("play", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    host.setPlaybackActive(true);
    const player = host.getPlayer();
    if (shouldRampAfterResume && player) {
      applyVolume(0);
      player.play();
      animateVolume(0, getLastVolume(), RESUMED_AUDIO_CONTEXT_RAMP_MS);
      return;
    }
    player?.play();
  };

  const pause = (): void => {
    stopFade();
    host.setPlaybackActive(false);
    host.getPlayer()?.pause();
  };

  const stop = (): void => {
    stopFade();
    host.setPlaybackActive(false);
    host.getPlayer()?.stop();
  };

  const next = (): void => {
    void host.audioRecovery
      .prepare("next", {
        rebuildIfTauriOutputMayBeStale: true,
      })
      .then(() => {
        host.setPlaybackActive(true);
        host.getPlayer()?.next(undefined, true, true);
      });
  };

  const prev = (): void => {
    host.getPlayer()?.prev(undefined, false);
  };

  const gotoTrack = (indexOrUrl: number | string, forcePlay = false): void => {
    if (!forcePlay) {
      host.getPlayer()?.gotoTrack(indexOrUrl, forcePlay);
      return;
    }
    void host.audioRecovery
      .prepare("gotoTrack", {
        rebuildIfTauriOutputMayBeStale: true,
      })
      .then(() => {
        host.setPlaybackActive(true);
        host.getPlayer()?.gotoTrack(indexOrUrl, forcePlay);
      });
  };

  const seekTo = (positionMs: number): void => {
    host.getPlayer()?.setPosition(positionMs);
  };

  const setVolume = (volume: number): void => {
    setLastVolume(volume);
    applyVolume(volume);
  };

  const setPlaybackRate = (rate: number): void => {
    const safeRate = Math.max(0.25, Math.min(rate, 4));
    host.setLastPlaybackRate(safeRate);
    host.getPlayer()?.setPlaybackRate(safeRate);
  };

  const getPosition = (): number => host.getPlayer()?.getPosition() ?? 0;

  const getCurrentBufferedAheadSeconds = (): number =>
    host.getPlayer()?.getCurrentBufferedAheadSeconds() ?? 0;

  const getCurrentTrackDuration = (): number =>
    host.getPlayer()?.currentLength() ?? 0;

  const getCurrentTrackUrl = (): string => host.getPlayer()?.getTrack() ?? "";

  const getTrackIndex = (): number => host.getPlayer()?.getIndex() ?? -1;

  const getTracks = (): string[] => host.getPlayer()?.getTracks() ?? [];

  /**
   * @deprecated Shuffle is owned by the React layer (PlayerContext reorders
   * the queue and feeds the engine sequentially). Kept for API completeness;
   * do not call — using Gapless-5's shuffle alongside a pre-shuffled queue
   * causes a double-shuffle.
   */
  const setShuffle = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    if (enabled && !player.isShuffled()) {
      player.shuffle(true);
    } else if (!enabled && player.isShuffled()) {
      player.toggleShuffle();
    }
  };

  const updateCrossfade = (): void => {
    host.getPlayer()?.setCrossfade(host.getCrossfadeDurationMs());
  };

  const setCrossfadeDuration = (durationMs: number): void => {
    host.getPlayer()?.setCrossfade(Math.max(0, durationMs));
  };

  const fadeOutAndPause = (durationMs = DEFAULT_FADE_MS): Promise<void> => {
    if (!host.getPlayer()) return Promise.resolve();
    const startVolume = getAppliedVolume();
    return new Promise((resolve) => {
      animateVolume(startVolume, 0, durationMs, () => {
        host.getPlayer()?.pause();
        host.setPlaybackActive(false);
        applyVolume(getLastVolume());
        resolve();
      });
    });
  };

  const fadeInAndPlay = async (durationMs = DEFAULT_FADE_MS): Promise<void> => {
    if (!host.getPlayer()) return Promise.resolve();
    stopFade();
    await host.audioRecovery.prepare("fadeInAndPlay", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    applyVolume(0);
    host.setPlaybackActive(true);
    host.getPlayer()?.play();
    return new Promise((resolve) => {
      animateVolume(0, getLastVolume(), durationMs, resolve);
    });
  };

  const restoreVolume = (): void => {
    applyVolume(getLastVolume());
  };

  const setLoop = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    player.loop = enabled;
  };

  const setSingleMode = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    player.singleMode = enabled;
  };

  return {
    play,
    pause,
    stop,
    next,
    prev,
    gotoTrack,
    seekTo,
    setVolume,
    setPlaybackRate,
    getPosition,
    getCurrentBufferedAheadSeconds,
    getCurrentTrackDuration,
    getCurrentTrackUrl,
    getTrackIndex,
    getTracks,
    setShuffle,
    updateCrossfade,
    setCrossfadeDuration,
    fadeOutAndPause,
    fadeInAndPlay,
    restoreVolume,
    setLoop,
    setSingleMode,
  };
}
