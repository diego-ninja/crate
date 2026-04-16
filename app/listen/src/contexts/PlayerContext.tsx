import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  getStoredQueue,
  getStoredRecentlyPlayed,
  getStoredVolume,
  getStreamUrl,
  getTrackCacheKey,
  MAX_RECENT,
  saveQueue,
  saveRecentlyPlayed,
  STORAGE_KEY,
} from "@/contexts/player-utils";
import {
  addTrack as gpAddTrack,
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getPosition as gpGetPosition,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  gotoTrack as gpGotoTrack,
  initPlayer as initGaplessPlayer,
  insertTrack as gpInsertTrack,
  loadQueue as gpLoadQueue,
  next as gpNext,
  pause as gpPause,
  play as gpPlay,
  prev as gpPrev,
  removeTrack as gpRemoveTrack,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setShuffle as gpSetShuffle,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
  updateCrossfade as gpUpdateCrossfade,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { apiFetch } from "@/lib/api";
import { usePlayerShortcuts } from "@/contexts/use-player-shortcuts";
import { useMediaSession } from "@/contexts/use-media-session";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "@/lib/player-playback-prefs";

export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

interface PlayerStateValue {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  analyserVersion: number;
}

interface PlayerActionsValue {
  queue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  recentlyPlayed: Track[];
  currentTrack: Track | undefined;
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

type PlayerContextValue = PlayerStateValue & PlayerActionsValue;

const PlayerStateContext = createContext<PlayerStateValue | null>(null);
const PlayerActionsContext = createContext<PlayerActionsValue | null>(null);

const SOFT_PAUSE_FADE_MS = 220;
const STREAM_STALL_GRACE_MS = 2500;
const RECOVERY_RETRY_MS = 3000;
const STREAM_PROBE_TIMEOUT_MS = 4000;

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function resolveQueueFromUrls(urls: string[], sourceQueue: Track[]): Track[] {
  if (!urls.length) return sourceQueue;

  const buckets = new Map<string, Track[]>();
  for (const track of sourceQueue) {
    const url = getStreamUrl(track);
    const bucket = buckets.get(url);
    if (bucket) bucket.push(track);
    else buckets.set(url, [track]);
  }

  const resolved: Track[] = [];
  for (const url of urls) {
    const bucket = buckets.get(url);
    if (bucket?.length) {
      resolved.push(bucket.shift()!);
      continue;
    }
    const fallback = sourceQueue.find((track) => getStreamUrl(track) === url);
    if (fallback) resolved.push(fallback);
  }

  return resolved.length > 0 ? resolved : sourceQueue;
}

export function usePlayerState(): PlayerStateValue {
  const ctx = useContext(PlayerStateContext);
  if (!ctx) throw new Error("usePlayerState must be used within PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActionsValue {
  const ctx = useContext(PlayerActionsContext);
  if (!ctx) throw new Error("usePlayerActions must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const actions = usePlayerActions();
  return { ...state, ...actions };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const stored = useRef(getStoredQueue());
  const [queue, setQueueState] = useState<Track[]>(stored.current.queue);
  const [currentIndex, setCurrentIndexState] = useState(clampIndex(stored.current.currentIndex, stored.current.queue.length));
  const [isPlaying, setIsPlayingState] = useState(false);
  const [isBuffering, setIsBufferingState] = useState(false);
  const [currentTime, setCurrentTimeState] = useState(0);
  const [duration, setDurationState] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [analyserVersion, setAnalyserVersion] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [playSource, setPlaySource] = useState<PlaySource | null>(null);
  const [repeat, setRepeatState] = useState<RepeatMode>("off");
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );

  const currentTrack = queue[currentIndex];

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTrackRef = useRef(currentTrack);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playSourceRef = useRef(playSource);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const pendingRestoreTimeRef = useRef(stored.current.currentTime > 0 ? stored.current.currentTime : 0);
  const resumeAfterReloadRef = useRef(stored.current.wasPlaying);
  const restoreAutoplayAttemptedRef = useRef(false);
  const restoreAutoplayTimerRef = useRef<number | null>(null);
  const playerReadyRef = useRef(false);
  const restoredEngineRef = useRef(false);
  const shouldAutoplayRef = useRef(false);
  const bufferingIntentRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(getStoredVolume(), 0.5));
  const activatedTrackKeyRef = useRef<string | null>(null);
  const softInterruptionReasonRef = useRef<"offline" | "stream" | null>(null);
  const shouldAutoResumeAfterInterruptionRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const recoveryProbeInFlightRef = useRef(false);

  const commitQueue = useCallback((nextQueue: Track[]) => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  }, []);

  const commitCurrentIndex = useCallback((nextIndex: number) => {
    currentIndexRef.current = nextIndex;
    currentTrackRef.current = queueRef.current[nextIndex];
    setCurrentIndexState(nextIndex);
  }, []);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTimeState(nextTime);
  }, []);

  const commitDuration = useCallback((nextDuration: number) => {
    durationRef.current = nextDuration;
    setDurationState(nextDuration);
  }, []);

  const commitIsPlaying = useCallback((nextIsPlaying: boolean) => {
    isPlayingRef.current = nextIsPlaying;
    setIsPlayingState(nextIsPlaying);
  }, []);

  const commitIsBuffering = useCallback((nextIsBuffering: boolean) => {
    setIsBufferingState(nextIsBuffering);
  }, []);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current != null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const clearRestoreAutoplayTimer = useCallback(() => {
    if (restoreAutoplayTimerRef.current != null) {
      window.clearTimeout(restoreAutoplayTimerRef.current);
      restoreAutoplayTimerRef.current = null;
    }
  }, []);

  // queue, currentIndex, currentTrack, currentTime, duration, isPlaying are
  // kept in sync with their refs by their respective commit* helpers.
  // Only repeat, shuffle and playSource use setState directly, so mirror
  // them into refs here.
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
  }, [playSource, repeat, shuffle]);

  useEffect(() => {
    saveQueue(queue, currentIndex, currentTime, isPlaying);
  }, [queue, currentIndex, currentTime, isPlaying]);

  const addToRecentlyPlayed = useCallback((track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }, []);

  const rememberActiveTrack = useCallback((track: Track | undefined) => {
    if (!track) {
      activatedTrackKeyRef.current = null;
      return;
    }
    const trackKey = getTrackCacheKey(track);
    if (activatedTrackKeyRef.current === trackKey) return;
    activatedTrackKeyRef.current = trackKey;
    addToRecentlyPlayed(track);
  }, [addToRecentlyPlayed]);

  const getPlaybackSnapshot = useCallback(() => ({
    currentTime: currentTimeRef.current,
    duration: durationRef.current,
  }), []);

  const probeCurrentTrackAvailability = useCallback(async () => {
    const track = currentTrackRef.current;
    if (!track) return false;

    const online = await isRuntimeOnline();
    if (!online) return false;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), STREAM_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(getStreamUrl(track), {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      response.body?.cancel().catch(() => {});
      return response.ok || response.status === 206;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const maybeResumeAfterInterruptionRef = useRef<() => Promise<void>>(async () => {});

  const scheduleRecoveryCheck = useCallback((delay = RECOVERY_RETRY_MS) => {
    clearRecoveryTimer();
    if (!shouldAutoResumeAfterInterruptionRef.current) return;
    recoveryTimerRef.current = window.setTimeout(() => {
      void maybeResumeAfterInterruptionRef.current();
    }, delay);
  }, [clearRecoveryTimer]);

  const {
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(currentTrack, playSource, getPlaybackSnapshot);

  const postTrackHistory = useCallback((track: Track) => {
    apiFetch("/api/me/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        track_id: track.libraryTrackId ?? null,
        track_storage_id: track.storageId ?? null,
        track_path: track.path || track.id,
        title: track.title,
        artist: track.artist,
        album: track.album || "",
      }),
    }).catch(() => {});
  }, []);

  const syncSelectionFromEngine = useCallback((sourceQueue?: Track[]) => {
    const resolvedQueue = resolveQueueFromUrls(gpGetTracks(), sourceQueue ?? queueRef.current);
    const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
    const resolvedTrack = resolvedQueue[resolvedIndex];
    const resolvedDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);

    commitQueue(resolvedQueue);
    commitCurrentIndex(resolvedIndex);
    commitDuration(resolvedDuration);
    rememberActiveTrack(resolvedTrack);

    return {
      resolvedQueue,
      resolvedIndex,
      resolvedTrack,
    };
  }, [commitCurrentIndex, commitDuration, commitQueue, rememberActiveTrack]);

  const beginSoftInterruption = useCallback((reason: "offline" | "stream") => {
    if (!currentTrackRef.current) return;
    if (softInterruptionReasonRef.current) {
      if (reason === "offline") {
        softInterruptionReasonRef.current = reason;
      }
      scheduleRecoveryCheck(reason === "offline" ? 0 : RECOVERY_RETRY_MS);
      return;
    }

    softInterruptionReasonRef.current = reason;
    shouldAutoResumeAfterInterruptionRef.current = true;
    recoveryProbeInFlightRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
    bufferingIntentRef.current = false;
    commitIsBuffering(true);

    if (isPlayingRef.current) {
      void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {});
    } else {
      gpPause();
    }

    scheduleRecoveryCheck(reason === "offline" ? 0 : RECOVERY_RETRY_MS);
  }, [clearRecoveryTimer, clearStallTimer, commitIsBuffering, scheduleRecoveryCheck]);

  const cancelSoftInterruption = useCallback(() => {
    softInterruptionReasonRef.current = null;
    shouldAutoResumeAfterInterruptionRef.current = false;
    recoveryProbeInFlightRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
  }, [clearRecoveryTimer, clearStallTimer]);

  const scheduleStallProtection = useCallback(() => {
    clearStallTimer();
    if (bufferingIntentRef.current || !isPlayingRef.current || softInterruptionReasonRef.current) return;
    stallTimerRef.current = window.setTimeout(() => {
      if (bufferingIntentRef.current || !isPlayingRef.current || softInterruptionReasonRef.current) return;
      void isRuntimeOnline().then((online) => {
        beginSoftInterruption(online ? "stream" : "offline");
      });
    }, STREAM_STALL_GRACE_MS);
  }, [beginSoftInterruption, clearStallTimer]);

  maybeResumeAfterInterruptionRef.current = async () => {
    if (!shouldAutoResumeAfterInterruptionRef.current) return;
    if (!currentTrackRef.current || recoveryProbeInFlightRef.current) return;
    recoveryProbeInFlightRef.current = true;
    commitIsBuffering(true);
    try {
      const available = await probeCurrentTrackAvailability();
      if (!available) {
        scheduleRecoveryCheck();
        return;
      }
      bufferingIntentRef.current = true;
      await gpFadeInAndPlay(SOFT_PAUSE_FADE_MS);
    } catch {
      scheduleRecoveryCheck();
    } finally {
      recoveryProbeInFlightRef.current = false;
    }
  };

  const syncEngineQueue = useCallback((
    nextQueue: Track[],
    requestedIndex: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => {
    const nextIndex = clampIndex(requestedIndex, nextQueue.length);
    const autoplay = options?.autoplay ?? isPlayingRef.current;
    const positionMs = options?.positionMs ?? 0;

    if (nextQueue.length === 0) {
      bufferingIntentRef.current = false;
      gpPause();
      gpLoadQueue([], 0);
      commitQueue([]);
      commitCurrentIndex(0);
      commitCurrentTime(0);
      commitDuration(0);
      commitIsPlaying(false);
      commitIsBuffering(false);
      activatedTrackKeyRef.current = null;
      return;
    }

    gpLoadQueue(nextQueue.map(getStreamUrl), nextIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    gpSetShuffle(shuffleRef.current);

    // Commits queue/index/duration internally.
    syncSelectionFromEngine(nextQueue);

    if (positionMs > 0) {
      gpSeekTo(positionMs);
      const positionSeconds = positionMs / 1000;
      commitCurrentTime(positionSeconds);
      markSeekPosition(positionSeconds);
    } else {
      commitCurrentTime(0);
    }

    if (autoplay) {
      bufferingIntentRef.current = true;
      commitIsBuffering(true);
      gpPlay();
    } else {
      bufferingIntentRef.current = false;
      gpPause();
      commitIsPlaying(false);
      commitIsBuffering(false);
    }
  }, [
    commitCurrentTime,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    commitCurrentIndex,
    commitDuration,
    markSeekPosition,
    syncSelectionFromEngine,
  ]);

  /**
   * Advance the React cursor to a new index. Caller is responsible for
   * moving the engine (gpNext/gpPrev/gpGotoTrack) BEFORE calling this so
   * the duration read is from the new track.
   */
  const advanceCursorTo = useCallback((index: number) => {
    commitCurrentIndex(index);
    commitCurrentTime(0);
    commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
    rememberActiveTrack(queueRef.current[index]);
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
  }, [commitCurrentIndex, commitCurrentTime, commitDuration, commitIsBuffering, rememberActiveTrack]);

  const setQueueSynced = useCallback<Dispatch<SetStateAction<Track[]>>>((update) => {
    const prevQueue = queueRef.current;
    const nextQueue = typeof update === "function" ? update(prevQueue) : update;
    const sameCurrentTrack =
      prevQueue[currentIndexRef.current] &&
      nextQueue[clampIndex(currentIndexRef.current, nextQueue.length)] &&
      getTrackCacheKey(prevQueue[currentIndexRef.current]!) ===
        getTrackCacheKey(nextQueue[clampIndex(currentIndexRef.current, nextQueue.length)]!);

    syncEngineQueue(
      nextQueue,
      clampIndex(currentIndexRef.current, nextQueue.length),
      {
        autoplay: isPlayingRef.current,
        positionMs: sameCurrentTrack ? gpGetPosition() : 0,
      },
    );
  }, [syncEngineQueue]);

  const setCurrentIndexSynced = useCallback<Dispatch<SetStateAction<number>>>((update) => {
    const prevIndex = currentIndexRef.current;
    const nextIndexRaw = typeof update === "function" ? update(prevIndex) : update;
    const nextIndex = clampIndex(nextIndexRaw, queueRef.current.length);
    const shouldPlay = shouldAutoplayRef.current || isPlayingRef.current;

    if (queueRef.current.length === 0) return;
    if (nextIndex === prevIndex && !shouldAutoplayRef.current) return;

    gpGotoTrack(nextIndex, shouldPlay);
    advanceCursorTo(nextIndex);
    if (!shouldPlay) {
      commitIsBuffering(false);
    }
    if (shouldPlay) {
      commitIsPlaying(true);
    }
    shouldAutoplayRef.current = false;
  }, [advanceCursorTo, commitIsBuffering, commitIsPlaying]);

  const setCurrentTimeSynced = useCallback<Dispatch<SetStateAction<number>>>((update) => {
    const nextTime = typeof update === "function" ? update(currentTimeRef.current) : update;
    commitCurrentTime(nextTime);
  }, [commitCurrentTime]);

  const setDurationSynced = useCallback<Dispatch<SetStateAction<number>>>((update) => {
    const nextDuration = typeof update === "function" ? update(durationRef.current) : update;
    commitDuration(nextDuration);
  }, [commitDuration]);

  const setIsPlayingSynced = useCallback<Dispatch<SetStateAction<boolean>>>((update) => {
    const nextValue = typeof update === "function" ? update(isPlayingRef.current) : update;
    commitIsPlaying(nextValue);
  }, [commitIsPlaying]);

  const setIsBufferingSynced = useCallback<Dispatch<SetStateAction<boolean>>>((update) => {
    const nextValue = typeof update === "function" ? update(isBuffering) : update;
    commitIsBuffering(nextValue);
  }, [commitIsBuffering, isBuffering]);

  const {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  } = usePlaybackIntelligence({
    queue,
    currentIndex,
    isPlaying,
    playSource,
    shuffle,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    recentlyPlayed,
    shouldAutoplayRef,
    setQueue: setQueueSynced,
    setCurrentIndex: setCurrentIndexSynced,
    setCurrentTime: setCurrentTimeSynced,
    setDuration: setDurationSynced,
    setIsPlaying: setIsPlayingSynced,
    setIsBuffering: setIsBufferingSynced,
  });

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        crossfadeSeconds?: number;
        infinitePlaybackEnabled?: boolean;
        smartPlaylistSuggestionsEnabled?: boolean;
        smartPlaylistSuggestionsCadence?: number;
      }>).detail;
      if (typeof detail?.crossfadeSeconds === "number") {
        setCrossfadeSeconds(detail.crossfadeSeconds);
      } else {
        setCrossfadeSeconds(getCrossfadeDurationPreference());
      }
      if (typeof detail?.infinitePlaybackEnabled === "boolean") {
        setInfinitePlaybackEnabled(detail.infinitePlaybackEnabled);
      } else {
        setInfinitePlaybackEnabled(getInfinitePlaybackPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsEnabled === "boolean") {
        setSmartPlaylistSuggestionsEnabled(detail.smartPlaylistSuggestionsEnabled);
      } else {
        setSmartPlaylistSuggestionsEnabled(getSmartPlaylistSuggestionsPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsCadence === "number") {
        setSmartPlaylistSuggestionsCadence(detail.smartPlaylistSuggestionsCadence);
      } else {
        setSmartPlaylistSuggestionsCadence(getSmartPlaylistSuggestionsCadencePreference());
      }
    };

    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    return () => {
      window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    };
  }, []);

  // Mutable ref so the stable proxy registered with Gapless-5 always reads
  // the freshest callback implementations without re-registering listeners.
  const callbacksRef = useRef<GaplessPlayerCallbacks>({});

  callbacksRef.current = {
      onTimeUpdate: (positionMs, trackIndex) => {
        const positionSeconds = positionMs / 1000;
        clearStallTimer();
        commitCurrentTime(positionSeconds);
        recordProgress(positionSeconds);
        // Safety net: if the engine's trackIndex diverges from ours
        // (shouldn't happen — onnext/onprev already sync it), realign.
        if (trackIndex !== currentIndexRef.current && trackIndex >= 0) {
          syncSelectionFromEngine();
        }
      },
      onDurationChange: (durationMs) => {
        commitDuration(Math.max(durationMs / 1000, 0));
      },
      onLoad: (_path, _fullyLoaded, durationMs) => {
        const durationSeconds = Math.max(durationMs / 1000, 0);
        if (durationSeconds > 0) {
          commitDuration(durationSeconds);
        }
        if (pendingRestoreTimeRef.current > 0) {
          gpSeekTo(pendingRestoreTimeRef.current * 1000);
          commitCurrentTime(pendingRestoreTimeRef.current);
          markSeekPosition(pendingRestoreTimeRef.current);
          pendingRestoreTimeRef.current = 0;
        }
        if (!isPlayingRef.current) {
          commitIsBuffering(false);
        }
        bufferingIntentRef.current = false;
        clearStallTimer();
        if (resumeAfterReloadRef.current && !restoreAutoplayAttemptedRef.current && queueRef.current.length > 0) {
          restoreAutoplayAttemptedRef.current = true;
          bufferingIntentRef.current = true;
          commitIsBuffering(true);
          void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
            gpPlay();
          });
          clearRestoreAutoplayTimer();
          restoreAutoplayTimerRef.current = window.setTimeout(() => {
            if (!isPlayingRef.current) {
              resumeAfterReloadRef.current = false;
              bufferingIntentRef.current = false;
              commitIsBuffering(false);
            }
          }, 2500);
        }
      },
      onPlayRequest: () => {
        bufferingIntentRef.current = true;
      },
      onPlay: () => {
        // Note: onnext/onprev already sync the engine selection before
        // onPlay fires, so no sync needed here — just flip UI state.
        resumeAfterReloadRef.current = false;
        clearRestoreAutoplayTimer();
        cancelSoftInterruption();
        commitIsPlaying(true);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
      },
      onPause: () => {
        if (bufferingIntentRef.current && isPlayingRef.current) {
          commitIsBuffering(true);
          return;
        }
        if (softInterruptionReasonRef.current) {
          commitIsPlaying(false);
          commitIsBuffering(true);
          return;
        }
        clearStallTimer();
        commitIsPlaying(false);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
      },
      onPrev: () => {
        commitCurrentTime(0);
        commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
        syncSelectionFromEngine();
      },
      onNext: () => {
        commitCurrentTime(0);
        commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
        syncSelectionFromEngine();
      },
      onTrackFinished: (path) => {
        // During a crossfade auto-advance, Gapless-5 fires onnext BEFORE
        // onfinishedtrack, so React state may already point to the incoming
        // track. Resolve the outgoing track by URL; pass it explicitly to
        // flushCurrentPlayEvent so the tracker drops the flush if sessionRef
        // has already rotated (instead of attributing to the wrong song).
        const endedTrack = queueRef.current.find((t) => getStreamUrl(t) === path);
        if (!endedTrack) return;
        flushCurrentPlayEvent("completed", endedTrack);
        postTrackHistory(endedTrack);
      },
      onAllFinished: () => {
        resumeAfterReloadRef.current = false;
        clearRestoreAutoplayTimer();
        cancelSoftInterruption();
        commitIsPlaying(false);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
      },
      onError: (_path, err) => {
        console.error("[gapless] error:", err);
        clearRestoreAutoplayTimer();
        void isRuntimeOnline().then((online) => {
          beginSoftInterruption(online ? "stream" : "offline");
        });
      },
      onBuffering: () => {
        if (bufferingIntentRef.current || isPlayingRef.current) {
          commitIsBuffering(true);
        }
        scheduleStallProtection();
      },
      onAnalyserReady: () => {
        setAnalyserVersion((version) => version + 1);
      },
  };

  // Register once with a stable proxy that reads from callbacksRef.
  useEffect(() => {
    const proxy: GaplessPlayerCallbacks = {
      onTimeUpdate: (ms, idx) => callbacksRef.current.onTimeUpdate?.(ms, idx),
      onDurationChange: (ms) => callbacksRef.current.onDurationChange?.(ms),
      onLoad: (path, full, ms) => callbacksRef.current.onLoad?.(path, full, ms),
      onPlayRequest: (path) => callbacksRef.current.onPlayRequest?.(path),
      onPlay: (path) => callbacksRef.current.onPlay?.(path),
      onPause: (path) => callbacksRef.current.onPause?.(path),
      onPrev: (from, to) => callbacksRef.current.onPrev?.(from, to),
      onNext: (from, to) => callbacksRef.current.onNext?.(from, to),
      onTrackFinished: (path) => callbacksRef.current.onTrackFinished?.(path),
      onAllFinished: () => callbacksRef.current.onAllFinished?.(),
      onError: (path, err) => callbacksRef.current.onError?.(path, err),
      onBuffering: (path) => callbacksRef.current.onBuffering?.(path),
      onAnalyserReady: (analyser) => callbacksRef.current.onAnalyserReady?.(analyser),
    };
    initGaplessPlayer(proxy);
  }, []);

  useEffect(() => {
    gpSetVolume(volume);
  }, [volume]);

  useEffect(() => {
    gpUpdateCrossfade();
  }, [crossfadeSeconds]);

  useEffect(() => {
    gpSetLoop(repeat === "all");
    gpSetSingleMode(repeat === "one");
  }, [repeat]);

  useEffect(() => {
    gpSetShuffle(shuffle);
  }, [shuffle]);

  useEffect(() => {
    if (playerReadyRef.current) return;
    playerReadyRef.current = true;

    if (!stored.current.queue.length || restoredEngineRef.current) return;
    restoredEngineRef.current = true;

    const restoredQueue = stored.current.queue;
    const restoredIndex = clampIndex(stored.current.currentIndex, restoredQueue.length);
    gpLoadQueue(restoredQueue.map(getStreamUrl), restoredIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    gpSetShuffle(shuffleRef.current);
    pendingRestoreTimeRef.current = stored.current.currentTime > 0 ? stored.current.currentTime : 0;

    // syncSelectionFromEngine already commits queue/index/duration and
    // updates currentTrackRef via commitCurrentIndex.
    syncSelectionFromEngine(restoredQueue);
  }, [syncSelectionFromEngine]);

  useEffect(() => {
    const handleOffline = () => {
      if (!currentTrackRef.current) return;
      if (isPlayingRef.current || isBuffering) {
        beginSoftInterruption("offline");
      }
    };
    const handleRestored = () => {
      if (!shouldAutoResumeAfterInterruptionRef.current) return;
      scheduleRecoveryCheck(0);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleRestored);
    window.addEventListener("crate:network-restored", handleRestored as EventListener);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleRestored);
      window.removeEventListener("crate:network-restored", handleRestored as EventListener);
    };
  }, [beginSoftInterruption, isBuffering, scheduleRecoveryCheck]);

  useEffect(() => () => {
    clearStallTimer();
    clearRecoveryTimer();
    clearRestoreAutoplayTimer();
  }, [clearRecoveryTimer, clearRestoreAutoplayTimer, clearStallTimer]);

  const startQueuePlayback = useCallback((tracks: Track[], startIndex: number, source?: PlaySource) => {
    if (!tracks.length) return;
    const normalizedIndex = clampIndex(startIndex, tracks.length);

    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    restoreAutoplayAttemptedRef.current = false;
    clearRestoreAutoplayTimer();
    shouldAutoplayRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");

    // Load engine first; syncSelectionFromEngine commits queue/index/duration.
    gpLoadQueue(tracks.map(getStreamUrl), normalizedIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    gpSetShuffle(shuffleRef.current);

    commitCurrentTime(0);
    commitIsBuffering(true);
    setPlaySource(source || (tracks.length > 1
      ? { type: "queue", name: "Queue" }
      : { type: "track", name: tracks[normalizedIndex]!.title }));

    const { resolvedTrack } = syncSelectionFromEngine(tracks);
    if (resolvedTrack) rememberActiveTrack(resolvedTrack);

    bufferingIntentRef.current = true;
    gpPlay();
  }, [
    cancelSoftInterruption,
    clearRestoreAutoplayTimer,
    commitCurrentTime,
    commitIsBuffering,
    flushCurrentPlayEvent,
    rememberActiveTrack,
    resetPlaybackIntelligence,
    syncSelectionFromEngine,
  ]);

  const play = useCallback((track: Track, source?: PlaySource) => {
    startQueuePlayback([track], 0, source || { type: "track", name: track.title });
  }, [startQueuePlayback]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (!tracks.length) return;
    const track = tracks[clampIndex(startIndex, tracks.length)];
    if (!track) return;
    startQueuePlayback(
      tracks,
      startIndex,
      source || (tracks.length > 1 ? { type: "queue", name: "Queue" } : { type: "track", name: track.title }),
    );
  }, [startQueuePlayback]);

  const pause = useCallback(() => {
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPause();
    });
  }, [cancelSoftInterruption, commitIsBuffering]);

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPlay();
    });
  }, [cancelSoftInterruption, commitIsBuffering]);

  const next = useCallback(() => {
    if (!queueRef.current.length) return;

    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < queueRef.current.length) {
      flushCurrentPlayEvent("skipped");
      // Sequential skip: gpNext() preserves crossfade via Gapless-5's
      // native next() path (crossfadeEnabled=true).
      gpNext();
      advanceCursorTo(nextIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      flushCurrentPlayEvent("skipped");
      // Wrapping to index 0 is a jump, not a sequential skip — no crossfade.
      gpGotoTrack(0, true);
      advanceCursorTo(0);
      return;
    }

    if (continueInfinitePlayback()) {
      flushCurrentPlayEvent("skipped");
    }
  }, [advanceCursorTo, continueInfinitePlayback, flushCurrentPlayEvent]);

  const prev = useCallback(() => {
    if (!queueRef.current.length) return;
    if (currentTimeRef.current > 3) {
      gpSeekTo(0);
      commitCurrentTime(0);
      markSeekPosition(0);
      return;
    }

    if (currentIndexRef.current > 0) {
      flushCurrentPlayEvent("skipped");
      // Sequential skip backward. Gapless-5 prev() doesn't crossfade.
      gpPrev();
      advanceCursorTo(currentIndexRef.current - 1);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      const wrappedIndex = queueRef.current.length - 1;
      flushCurrentPlayEvent("skipped");
      gpGotoTrack(wrappedIndex, true);
      advanceCursorTo(wrappedIndex);
    }
  }, [advanceCursorTo, commitCurrentTime, flushCurrentPlayEvent, markSeekPosition]);

  const seek = useCallback((time: number) => {
    const shouldResumeBufferingFlow = isPlayingRef.current;
    bufferingIntentRef.current = shouldResumeBufferingFlow;
    gpSeekTo(time * 1000);
    commitCurrentTime(time);
    commitIsBuffering(shouldResumeBufferingFlow);
    markSeekPosition(time);
  }, [commitCurrentTime, commitIsBuffering, markSeekPosition]);

  const setVolume = useCallback((vol: number) => {
    gpSetVolume(vol);
    setVolumeState(vol);
    if (vol > 0) {
      lastNonZeroVolumeRef.current = vol;
    }
    try {
      localStorage.setItem("listen-player-volume", String(vol));
    } catch {
      /* ignore */
    }
  }, []);

  const clearQueue = useCallback(() => {
    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    restoreAutoplayAttemptedRef.current = false;
    clearRestoreAutoplayTimer();
    shouldAutoplayRef.current = false;
    bufferingIntentRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    gpPause();
    gpLoadQueue([], 0);
    commitQueue([]);
    commitCurrentIndex(0);
    commitCurrentTime(0);
    commitDuration(0);
    commitIsPlaying(false);
    commitIsBuffering(false);
    setPlaySource(null);
    activatedTrackKeyRef.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [
    cancelSoftInterruption,
    clearRestoreAutoplayTimer,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    resetPlaybackIntelligence,
  ]);

  const toggleShuffle = useCallback(() => {
    if (!queueRef.current.length) {
      setShuffleState((value) => !value);
      return;
    }

    const nextShuffle = !shuffleRef.current;
    setShuffleState(nextShuffle);
    gpSetShuffle(nextShuffle);
    // syncSelectionFromEngine already commits queue and index internally.
    syncSelectionFromEngine(queueRef.current);
  }, [syncSelectionFromEngine]);

  const cycleRepeat = useCallback(() => {
    setRepeatState((prevMode) => {
      if (prevMode === "off") return "all";
      if (prevMode === "all") return "one";
      return "off";
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    if (index < 0 || index >= queueRef.current.length) return;
    pendingRestoreTimeRef.current = 0;
    shouldAutoplayRef.current = false;
    flushCurrentPlayEvent("skipped");
    gpGotoTrack(index, true);
    advanceCursorTo(index);
    commitIsPlaying(true);
  }, [advanceCursorTo, commitIsPlaying, flushCurrentPlayEvent]);

  const playNext = useCallback((track: Track) => {
    // Insert at currentIndex + 1 without reloading the queue, so the
    // currently playing track keeps playing uninterrupted.
    const insertAt = currentIndexRef.current + 1;
    const nextQueue = [...queueRef.current];
    nextQueue.splice(insertAt, 0, track);

    gpInsertTrack(insertAt, getStreamUrl(track));
    commitQueue(nextQueue);
  }, [commitQueue]);

  const addToQueue = useCallback((track: Track) => {
    // Append without reloading.
    const nextQueue = [...queueRef.current, track];
    gpAddTrack(getStreamUrl(track));
    commitQueue(nextQueue);
  }, [commitQueue]);

  const removeFromQueue = useCallback((index: number) => {
    const prevQueue = queueRef.current;
    if (index < 0 || index >= prevQueue.length) return;

    const removingCurrent = index === currentIndexRef.current;
    const nextQueue = prevQueue.filter((_, queueIndex) => queueIndex !== index);

    if (removingCurrent) {
      flushCurrentPlayEvent("skipped");
      // Removing the currently playing track: recreate the engine queue,
      // so playback advances to the next valid item.
      const nextIndex = Math.min(currentIndexRef.current, nextQueue.length - 1);
      syncEngineQueue(nextQueue, nextIndex, {
        autoplay: isPlayingRef.current && nextQueue.length > 0,
        positionMs: 0,
      });
      return;
    }

    // Removing a non-current track: use incremental op, keep playback.
    gpRemoveTrack(index);
    const nextIndex =
      index < currentIndexRef.current
        ? currentIndexRef.current - 1
        : currentIndexRef.current;
    commitQueue(nextQueue);
    if (nextIndex !== currentIndexRef.current) {
      commitCurrentIndex(nextIndex);
    }
  }, [commitCurrentIndex, commitQueue, flushCurrentPlayEvent, syncEngineQueue]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const prevQueue = queueRef.current;
    if (
      fromIndex < 0 ||
      fromIndex >= prevQueue.length ||
      toIndex < 0 ||
      toIndex >= prevQueue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const nextQueue = [...prevQueue];
    const [moved] = nextQueue.splice(fromIndex, 1);
    if (!moved) return;
    nextQueue.splice(toIndex, 0, moved);

    let nextIndex = currentIndexRef.current;
    if (fromIndex === currentIndexRef.current) {
      nextIndex = toIndex;
    } else if (fromIndex < currentIndexRef.current && toIndex >= currentIndexRef.current) {
      nextIndex = currentIndexRef.current - 1;
    } else if (fromIndex > currentIndexRef.current && toIndex <= currentIndexRef.current) {
      nextIndex = currentIndexRef.current + 1;
    }

    syncEngineQueue(nextQueue, nextIndex, {
      autoplay: isPlayingRef.current,
      positionMs: gpGetPosition(),
    });
  }, [syncEngineQueue]);

  usePlayerShortcuts({
    hasCurrentTrack: !!currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    lastNonZeroVolume: lastNonZeroVolumeRef.current,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  });

  useMediaSession({ currentTrack, isPlaying, currentTime, duration, pause, resume, next, prev, seek });

  const stateValue = useMemo<PlayerStateValue>(
    () => ({ currentTime, duration, isPlaying, isBuffering, volume, analyserVersion }),
    [analyserVersion, currentTime, duration, isPlaying, isBuffering, volume],
  );

  const actionsValue = useMemo<PlayerActionsValue>(
    () => ({
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      recentlyPlayed,
      currentTrack,
      play,
      playAll,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    }),
    [
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      recentlyPlayed,
      currentTrack,
      play,
      playAll,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        {children}
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
