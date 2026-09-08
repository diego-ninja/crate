import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";
import { usePlayerEnginePreferenceRuntime } from "@/contexts/use-player-engine-preference-runtime";
import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";
import { usePlayerIntelligenceActions } from "@/contexts/use-player-intelligence-actions";
import { useNativePlaybackRuntime } from "@/contexts/use-native-playback-runtime";
import { usePlayerPlaybackObservability } from "@/contexts/use-player-playback-observability";
import { usePlayerPreferenceRuntime } from "@/contexts/use-player-preference-runtime";
import { usePlayerTrackRecovery } from "@/contexts/use-player-track-recovery";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { useSoftInterruption } from "@/contexts/use-soft-interruption";
import { useEqualizerRuntime } from "@/hooks/use-equalizer-runtime";
import { recordPlaybackStall } from "@/lib/playback-network-quality";

import type { usePlayerRuntimeState } from "./use-player-runtime-state";

export type PlayerPlaybackRuntimeState = ReturnType<
  typeof usePlayerRuntimeState
>;

export function usePlayerPlaybackRuntime({
  connectEnabled,
  runtime,
}: {
  connectEnabled: boolean;
  runtime: PlayerPlaybackRuntimeState;
}) {
  const {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    volume,
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    recentlyPlayed,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    playbackDeliveryPolicy,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    queueRef,
    currentIndexRef,
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    callbacksRef,
    unshuffledQueueRef,
    engineTrackMapRef,
    crossfadeTimerRef,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    setAnalyserVersion,
    setCrossfadeTransition,
    setRecentlyPlayed,
    setPlaybackDeliveryPolicy,
    setInfinitePlaybackEnabled,
    setSmartCrossfadeEnabled,
    setSmartPlaylistSuggestionsEnabled,
    setSmartPlaylistSuggestionsCadence,
    buildEngineUrls,
    registerEngineTrack,
    clearPrevRestartLatch,
  } = runtime;

  usePlayerEnginePreferenceRuntime({
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    volume,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  });

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

  useEqualizerRuntime(currentTrack);

  const {
    startTrackerSession,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordCurrentPlaybackQoe,
  } = usePlayerPlaybackObservability({
    currentTrackRef,
    currentTimeRef,
    durationRef,
    playbackDeliveryPolicy,
    setPlaybackDeliveryPolicy,
  });
  const { preResolveNextTrack, recoverActiveTrackRef } = usePlayerTrackRecovery(
    {
      buildEngineUrls,
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      queueRef,
      repeatRef,
    },
  );

  const {
    beginSoftInterruption,
    cancelSoftInterruption,
    requireUserGestureToResume,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  } = useSoftInterruption({
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    bufferingIntentRef,
    commitIsPlaying,
    commitIsBuffering,
    onPlaybackStall: () => {
      recordPlaybackStall();
      recordCurrentPlaybackQoe("stall_start");
    },
    onPlaybackStallEnded: (durationMs, bufferedAheadSeconds) => {
      recordCurrentPlaybackQoe("stall_end", {
        durationMs,
        bufferedAheadSeconds,
      });
    },
    onPlaybackRecovered: (attempt) => {
      recordCurrentPlaybackQoe("recovery", { attempt });
    },
    recoverCurrentTrack: () => recoverActiveTrackRef.current(),
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

  const {
    appendAndAdvance,
    appendIntelligenceTracks,
    insertSuggestionAfterCurrent,
  } = usePlayerIntelligenceActions({
    advanceCursorTo,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    currentIndexRef,
    flushCurrentPlayEvent,
    playSourceRef,
    queueRef,
    recentlyPlayed,
    registerEngineTrack,
    startTrackerSession,
    unshuffledQueueRef,
  });

  const { continueInfinitePlayback, resetPlaybackIntelligence } =
    usePlaybackIntelligence({
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

  useNativePlaybackRuntime({
    beginSoftInterruption,
    bufferingIntentRef,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    currentTimeRef,
    currentTrackRef,
    effectiveCrossfadeMsRef,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    lastNonZeroVolumeRef,
    playSourceRef,
    queueRef,
    recordProgress,
    rememberActiveTrack,
    repeatRef,
    rotateTrackerSession,
  });

  usePlayerPreferenceRuntime({
    currentIndex,
    playbackDeliveryPolicy,
    playSource,
    queue,
    repeat,
    setInfinitePlaybackEnabled,
    setPlaybackDeliveryPolicy,
    setSmartCrossfadeEnabled,
    setSmartPlaylistSuggestionsCadence,
    setSmartPlaylistSuggestionsEnabled,
    shuffle,
    smartCrossfadeEnabled,
    syncEffectiveCrossfade,
  });

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
    pushToEngine,
    commitIsBuffering,
    commitCurrentTime,
    markSeekPosition,
    allowAutoplayRestore: !connectEnabled,
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
    requireUserGestureToResume,
    beginSoftInterruption,
    isSoftInterrupted,
    ensureTrackerSession,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordPlaybackStarted: (durationMs) => {
      recordCurrentPlaybackQoe("startup", { durationMs });
    },
    onActivePlaybackStarted: preResolveNextTrack,
    pullFromEngine,
    setAnalyserVersion,
    setCrossfadeTransition,
  });

  return {
    advanceCursorTo,
    appendAndAdvance,
    beginSoftInterruption,
    cancelRestoreAutoplay,
    cancelSoftInterruption,
    continueInfinitePlayback,
    flushCurrentPlayEvent,
    markSeekPosition,
    pullFromEngine,
    pushToEngine,
    rememberActiveTrack,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    pendingRestoreTimeRef,
    requireUserGestureToResume,
    startTrackerSession,
  };
}
