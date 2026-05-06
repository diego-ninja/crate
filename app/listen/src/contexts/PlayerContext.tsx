import {
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import type { Track } from "@/contexts/player-types";
import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerContextValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import {
} from "@/contexts/player-queue-helpers";
import {
  getTrackCacheKey,
} from "@/contexts/player-utils";
import {
  addTrack as gpAddTrack,
  destroyPlayer as gpDestroyPlayer,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";
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
  getInfinitePlaybackPreference,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPolicy,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";

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

export function usePlayerProgress(): PlayerProgressValue {
  const ctx = useContext(PlayerProgressContext);
  if (!ctx) throw new Error("usePlayerProgress must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const progress = usePlayerProgress();
  const actions = usePlayerActions();
  return { ...state, ...progress, ...actions };
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
    playbackDeliveryPolicy,
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
    setPlaybackDeliveryPolicy,
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

  const getPlaybackSnapshot = useCallback(() => ({
    currentTime: currentTimeRef.current,
    duration: durationRef.current,
  }), []);

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateSession: rotateTrackerSession,
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
  const {
    syncEffectiveCrossfade,
    rememberActiveTrack,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  } = usePlayerEngineSync({
    queueRef,
    currentIndexRef,
    currentTrackRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    durationRef,
    bufferingIntentRef,
    activatedTrackKeyRef,
    engineTrackMapRef,
    setRecentlyPlayed,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    buildEngineUrls,
    clearPrevRestartLatch,
    markSeekPosition,
  });

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
        playbackDeliveryPolicy?: PlaybackDeliveryPolicy;
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
      if (detail?.playbackDeliveryPolicy) {
        setPlaybackDeliveryPolicy(detail.playbackDeliveryPolicy);
      } else {
        setPlaybackDeliveryPolicy(getPlaybackDeliveryPolicyPreference());
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

  useEffect(() => {
    preparePlaybackDelivery(queue, currentIndex, playbackDeliveryPolicy);
  }, [currentIndex, playbackDeliveryPolicy, queue]);

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
    rotateTrackerSession,
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

  const clearQueueRef = useRef(clearQueue);
  useEffect(() => {
    clearQueueRef.current = clearQueue;
  }, [clearQueue]);

  useEffect(() => {
    const handleAuthRuntimeReset = () => {
      clearQueueRef.current();
    };
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, handleAuthRuntimeReset);
    return () => {
      window.removeEventListener(AUTH_RUNTIME_RESET_EVENT, handleAuthRuntimeReset);
    };
  }, []);

  useEffect(() => {
    return () => {
      gpDestroyPlayer();
    };
  }, []);

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
    () => ({ isPlaying, isBuffering, volume, analyserVersion, crossfadeTransition }),
    [analyserVersion, crossfadeTransition, isPlaying, isBuffering, volume],
  );

  const progressValue = useMemo<PlayerProgressValue>(
    () => ({ currentTime, duration }),
    [currentTime, duration],
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
        <PlayerProgressContext.Provider value={progressValue}>
          {children}
        </PlayerProgressContext.Provider>
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
