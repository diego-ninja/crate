import {
  useContext,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import type { Track } from "@/contexts/player-types";
import {
  PlayerActionsContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerContextValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import {
  clampIndex,
  resolveQueueFromUrls,
} from "@/contexts/player-queue-helpers";
import {
  getEffectiveCrossfadeSeconds,
  getPredictableNextTrack,
  getTrackCacheKey,
  MAX_RECENT,
  saveRecentlyPlayed,
} from "@/contexts/player-utils";
import {
  addTrack as gpAddTrack,
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
  loadQueue as gpLoadQueue,
  pause as gpPause,
  play as gpPlay,
  seekTo as gpSeekTo,
  setCrossfadeDuration as gpSetCrossfadeDuration,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { usePlayerAuthSync } from "@/contexts/use-player-auth-sync";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";
import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import { usePlayerRuntimeState } from "@/contexts/use-player-runtime-state";
import { useSoftInterruption } from "@/contexts/use-soft-interruption";
import { usePlayerShortcuts } from "@/contexts/use-player-shortcuts";
import { useMediaSession } from "@/contexts/use-media-session";
import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "@/lib/player-playback-prefs";

export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
export type { CrossfadeTransition } from "@/contexts/player-context";
export { shouldRestartTrackBeforePrev } from "@/contexts/player-queue-helpers";

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
  const {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    analyserVersion,
    crossfadeTransition,
    shuffle,
    playSource,
    repeat,
    smartCrossfadeEnabled,
    recentlyPlayed,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    setVolumeState,
    setAnalyserVersion,
    setCrossfadeTransition,
    setSmartCrossfadeEnabled,
    setRecentlyPlayed,
    setInfinitePlaybackEnabled,
    setSmartPlaylistSuggestionsEnabled,
    setSmartPlaylistSuggestionsCadence,
    crossfadeTimerRef,
    queueRef,
    currentIndexRef,
    currentTrackRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    isBufferingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    callbacksRef,
    unshuffledQueueRef,
    engineTrackMapRef,
    resetEngineTrackMap,
    commitQueue,
    buildEngineUrls,
    registerEngineTrack,
    unregisterEngineTrack,
    clearPrevRestartLatch,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
  } = usePlayerRuntimeState();

  // queue, currentIndex, currentTrack, currentTime, duration, isPlaying are
  // kept in sync with their refs by their respective commit* helpers.
  // Only repeat, shuffle and playSource use setState directly, so mirror
  // them into refs here.
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    smartCrossfadeEnabledRef.current = smartCrossfadeEnabled;
  }, [playSource, repeat, shuffle, smartCrossfadeEnabled]);

  const syncEffectiveCrossfade = useCallback(() => {
    const nextTrack = getPredictableNextTrack(
      queueRef.current,
      currentIndexRef.current,
      repeatRef.current,
      shuffleRef.current,
    );
    const effectiveSeconds = getEffectiveCrossfadeSeconds(
      currentTrackRef.current,
      nextTrack,
      playSourceRef.current,
      shuffleRef.current,
      getCrossfadeDurationPreference(),
      smartCrossfadeEnabledRef.current,
    );
    const effectiveMs = Math.max(0, effectiveSeconds * 1000);
    effectiveCrossfadeMsRef.current = effectiveMs;
    gpSetCrossfadeDuration(effectiveMs);
    return effectiveMs;
  }, []);

  usePlaybackPersistence({
    queue,
    currentIndex,
    isPlaying,
    shuffle,
    queueRef,
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    shuffleRef,
    unshuffledQueueRef,
  });

  const { user: authUser } = useAuth();
  usePlayerAuthSync({
    authUser,
    currentTrack,
    isPlaying,
  });

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

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);

  const {
    beginSoftInterruption,
    cancelSoftInterruption,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  } = useSoftInterruption({
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    bufferingIntentRef,
    commitIsBuffering,
  });

  /**
   * Read queue/index/duration from the engine and reconcile React state
   * to match. Call after any engine-initiated change (onnext/onprev, or
   * when we've just told the engine something and need to resync).
   *
   * No-op at the state level when nothing actually changed thanks to
   * identity guards — safe to call generously.
   */
  const pullFromEngine = useCallback((sourceQueue?: Track[]) => {
    const resolvedQueue = resolveQueueFromUrls(
      gpGetTracks(),
      sourceQueue ?? queueRef.current,
      engineTrackMapRef.current,
    );
    const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
    const resolvedTrack = resolvedQueue[resolvedIndex];
    const resolvedDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);

    // Identity guards: avoid spurious state updates + cascading
    // re-renders when the engine just reports the same queue/index
    // we already hold (happens on every onNext, onPrev, onTimeUpdate
    // fallback etc. — most calls are no-ops at the state level).
    const prevQueue = queueRef.current;
    const sameQueue =
      resolvedQueue.length === prevQueue.length &&
      resolvedQueue.every((track, i) => track === prevQueue[i]);
    if (!sameQueue) commitQueue(resolvedQueue);

    if (resolvedIndex !== currentIndexRef.current) {
      commitCurrentIndex(resolvedIndex);
    }
    if (resolvedDuration !== durationRef.current) {
      commitDuration(resolvedDuration);
    }
    rememberActiveTrack(resolvedTrack);

    return {
      resolvedQueue,
      resolvedIndex,
      resolvedTrack,
    };
  }, [commitCurrentIndex, commitDuration, commitQueue, rememberActiveTrack]);

  /**
   * Replace the engine queue + React queue in one shot. Used for changes
   * that need a full reload (shuffle toggle, removing current track,
   * reordering the current track, radio/intelligence insert).
   *
   * For incremental mutations (addToQueue, playNext, removeFromQueue of
   * a non-current track, reordering non-current tracks) prefer the
   * gpInsert/gpRemove helpers — they don't interrupt playback.
   */
  const pushToEngine = useCallback((
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
      engineTrackMapRef.current = new Map();
      commitQueue([]);
      commitCurrentIndex(0);
      commitCurrentTime(0);
      commitDuration(0);
      commitIsPlaying(false);
      commitIsBuffering(false);
      activatedTrackKeyRef.current = null;
      return;
    }

    gpLoadQueue(buildEngineUrls(nextQueue), nextIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    // NOTE: no gpSetShuffle here. The React queue is the source of truth
    // for play order; loadQueue normalizes Gapless's shuffledIndices so
    // the engine plays our list sequentially in the exact order passed.

    // Commits queue/index/duration internally.
    pullFromEngine(nextQueue);

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
    buildEngineUrls,
    markSeekPosition,
    pullFromEngine,
  ]);

  /**
   * Advance the React cursor to a new index. Caller is responsible for
   * moving the engine (gpNext/gpPrev/gpGotoTrack) BEFORE calling this so
   * the duration read is from the new track.
   */
  const advanceCursorTo = useCallback((index: number) => {
    clearPrevRestartLatch();
    commitCurrentIndex(index);
    commitCurrentTime(0);
    commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
    rememberActiveTrack(queueRef.current[index]);
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
  }, [clearPrevRestartLatch, commitCurrentIndex, commitCurrentTime, commitDuration, commitIsBuffering, rememberActiveTrack]);

  // Domain-level actions for usePlaybackIntelligence. Verb-oriented
  // instead of raw state setters — the hook no longer needs to reason
  // about engine sync, de-duplication or playback sequencing.
  const appendIntelligenceTracks = useCallback((tracks: Track[]) => {
    const queue = queueRef.current;
    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const unique: Track[] = [];
    for (const track of tracks) {
      const key = getTrackCacheKey(track);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      unique.push(track);
    }
    if (unique.length === 0) return;

    const nextQueue = [...queue, ...unique];
    for (const track of unique) {
      gpAddTrack(registerEngineTrack(track));
    }
    commitQueue(nextQueue);

    // Keep the un-shuffled snapshot in sync so restoring original order
    // later (toggle shuffle off / reload after shuffle-on session) doesn't
    // silently drop radio-refill or continuation tracks fetched while
    // shuffle was active.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
    }
  }, [commitQueue, recentlyPlayed, registerEngineTrack]);

  const insertSuggestionAfterCurrent = useCallback((candidates: Track[]) => {
    const queue = queueRef.current;
    const insertionIndex = currentIndexRef.current + 1;
    if (insertionIndex <= 0 || insertionIndex > queue.length) return;
    if (queue[insertionIndex]?.isSuggested) return;

    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const suggestion = candidates.find((t) => {
      const k = getTrackCacheKey(t);
      return !!k && !existingKeys.has(k);
    });
    if (!suggestion) return;

    const marked: Track = {
      ...suggestion,
      isSuggested: true,
      suggestionSource: "playlist",
    };
    const nextQueue = [...queue];
    nextQueue.splice(insertionIndex, 0, marked);
    gpInsertTrack(insertionIndex, registerEngineTrack(marked));
    commitQueue(nextQueue);

    // Mirror into the un-shuffled snapshot. We don't know where the
    // suggestion would live in the original sequence, so we append it
    // at the end — good enough for restore fidelity (no track lost).
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, marked];
    }
  }, [commitQueue, recentlyPlayed, registerEngineTrack]);

  const appendAndAdvance = useCallback((tracks: Track[]) => {
    const queue = queueRef.current;
    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const unique: Track[] = [];
    for (const track of tracks) {
      const key = getTrackCacheKey(track);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      unique.push(track);
    }
    if (unique.length === 0) {
      commitIsBuffering(false);
      return;
    }

    const nextQueue = [...queue, ...unique];
    for (const track of unique) {
      gpAddTrack(registerEngineTrack(track));
    }
    commitQueue(nextQueue);

    // Mirror into the un-shuffled snapshot so shuffle-off/reload
    // doesn't drop the freshly-fetched continuation tracks.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
    }

    // Advance to the first newly appended track. The old session is
    // ending by user request (they hit next at the end of the album),
    // so flush it explicitly before starting the new one.
    const nextIndex = queue.length;
    const outgoing = queueRef.current[currentIndexRef.current];
    flushCurrentPlayEvent("skipped", outgoing);
    gpGotoTrack(nextIndex, true);
    advanceCursorTo(nextIndex);
    const incoming = nextQueue[nextIndex];
    if (incoming) startTrackerSession(incoming, playSourceRef.current);
    commitIsPlaying(true);
  }, [
    advanceCursorTo,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    recentlyPlayed,
    registerEngineTrack,
    startTrackerSession,
  ]);

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
    actions: {
      appendTracks: appendIntelligenceTracks,
      insertSuggestionAfterCurrent,
      appendAndAdvance,
      setBuffering: commitIsBuffering,
    },
  });

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        crossfadeSeconds?: number;
        smartCrossfadeEnabled?: boolean;
        infinitePlaybackEnabled?: boolean;
        smartPlaylistSuggestionsEnabled?: boolean;
        smartPlaylistSuggestionsCadence?: number;
      }>).detail;
      syncEffectiveCrossfade();
      if (typeof detail?.smartCrossfadeEnabled === "boolean") {
        setSmartCrossfadeEnabled(detail.smartCrossfadeEnabled);
      } else {
        setSmartCrossfadeEnabled(getSmartCrossfadePreference());
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
  }, [syncEffectiveCrossfade]);

  useEffect(() => {
    syncEffectiveCrossfade();
  }, [syncEffectiveCrossfade, queue, currentIndex, playSource, repeat, shuffle, smartCrossfadeEnabled]);

  const {
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    tryRestoreAutoplay,
    cancelRestoreAutoplay,
  } = useRestoreOnMount({
    isPlayingRef,
    queueRef,
    repeatRef,
    bufferingIntentRef,
    buildEngineUrls,
    pullFromEngine,
    commitIsBuffering,
    commitCurrentTime,
    markSeekPosition,
  });
  usePlayerEngineCallbacks({
    callbacksRef,
    crossfadeTimerRef,
    currentIndexRef,
    currentTrackRef,
    playSourceRef,
    durationRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    bufferingIntentRef,
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    engineTrackMapRef,
    queueRef,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    clearPrevRestartLatch,
    clearStallTimer,
    scheduleStallProtection,
    cancelRestoreAutoplay,
    tryRestoreAutoplay,
    cancelSoftInterruption,
    beginSoftInterruption,
    isSoftInterrupted,
    ensureTrackerSession,
    startTrackerSession,
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
    pullFromEngine,
    setAnalyserVersion,
    setCrossfadeTransition,
  });

  // Engine already booted synchronously at render body; initialize
  // volume from the stored preference.
  useEffect(() => {
    gpSetVolume(volume);
  }, [volume]);

  useEffect(() => {
    gpSetLoop(repeat === "all");
    gpSetSingleMode(repeat === "one");
  }, [repeat]);

  // NOTE: no gpSetShuffle effect. Shuffle is handled in React by reordering
  // the queue in toggleShuffle(); the engine always plays sequentially.
  //
  // The restore-on-mount flow + autoplay timeout live in useRestoreOnMount.
  // Online/offline listeners + stall timers live in useSoftInterruption.

  const {
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
  } = usePlayerQueueActions({
    queueRef,
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    unshuffledQueueRef,
    bufferingIntentRef,
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    lastNonZeroVolumeRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    activatedTrackKeyRef,
    setPlaySource,
    setShuffleState,
    setRepeatState,
    setVolumeState,
    buildEngineUrls,
    registerEngineTrack,
    unregisterEngineTrack,
    resetEngineTrackMap,
    rememberActiveTrack,
    startTrackerSession,
    flushCurrentPlayEvent,
    markSeekPosition,
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    resetPlaybackIntelligence,
    continueInfinitePlayback,
    clearPrevRestartLatch,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  });

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
    () => ({ currentTime, duration, isPlaying, isBuffering, volume, analyserVersion, crossfadeTransition }),
    [analyserVersion, crossfadeTransition, currentTime, duration, isPlaying, isBuffering, volume],
  );

  const actionsValue = useMemo<PlayerActionsValue>(
    () => ({
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      smartCrossfadeEnabled,
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
      smartCrossfadeEnabled,
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
