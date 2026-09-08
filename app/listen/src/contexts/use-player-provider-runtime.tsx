import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { JamTransportControls } from "@/contexts/player-context";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayerConnectTransport } from "@/contexts/use-player-connect-transport";
import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import { usePlayerRuntimeState } from "@/contexts/use-player-runtime-state";
import { useJamQueueSession } from "@/contexts/use-jam-queue-session";
import { usePlayerLifecycleRuntime } from "@/contexts/use-player-lifecycle-runtime";
import { usePlayerConnectState } from "@/contexts/use-player-connect-state";
import { usePlayerContextValues } from "@/contexts/use-player-context-values";
import { usePlayerPlatformIntegrations } from "@/contexts/use-player-platform-integrations";
import { usePlayerPlaybackRuntime } from "@/contexts/use-player-playback-runtime";
import { getEffectivePlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { PlayerProviderSurface } from "@/contexts/PlayerProviderSurface";

export function usePlayerProviderRuntime(children: ReactNode) {
  const [jamTransport, setJamTransportState] =
    useState<JamTransportControls | null>(null);
  const setJamTransport = useCallback(
    (controls: JamTransportControls | null) => {
      setJamTransportState(controls);
    },
    [],
  );
  const runtimeState = usePlayerRuntimeState();
  const {
    queue,
    currentIndex,
    jamQueueLocked,
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
    playbackDeliveryPolicy,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    setVolumeState,
    queueRef,
    jamQueueLockedRef,
    currentIndexRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    isPlayingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    unshuffledQueueRef,
    resetEngineTrackMap,
    commitQueue,
    commitJamQueueLocked,
    buildEngineUrls,
    registerEngineTrack,
    unregisterEngineTrack,
    clearPrevRestartLatch,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
  } = runtimeState;

  const { user: authUser } = useAuth();
  const {
    connectEnabled,
    connectV1Enabled,
    connectV2Enabled,
    connectV2PublishRef,
    suppressNextConnectClaimRef,
    buildConnectSnapshotPayload,
    publishConnectState,
  } = usePlayerConnectState({
    authUser,
    currentTrack,
    isPlaying,
    queue,
    currentIndex,
    shuffle,
    repeat,
    playSource,
    queueRef,
    currentIndexRef,
    currentTimeRef,
    durationRef,
    isPlayingRef,
    shuffleRef,
    repeatRef,
    playSourceRef,
    unshuffledQueueRef,
  });
  const {
    advanceCursorTo,
    cancelRestoreAutoplay,
    cancelSoftInterruption,
    continueInfinitePlayback,
    flushCurrentPlayEvent,
    markSeekPosition,
    pendingRestoreTimeRef,
    pullFromEngine,
    pushToEngine,
    rememberActiveTrack,
    requireUserGestureToResume,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    startTrackerSession,
  } = usePlayerPlaybackRuntime({
    connectEnabled,
    runtime: runtimeState,
  });
  // NOTE: no gpSetShuffle effect. Shuffle is handled in React by reordering
  // the queue in toggleShuffle(); the engine always plays sequentially.
  //
  // The restore-on-mount flow + autoplay timeout live in useRestoreOnMount.
  // Online/offline listeners + stall timers live in useSoftInterruption.

  const ensureJamQueueLockedRef = useRef<(() => void) | null>(null);
  const ensureJamQueueLocked = useCallback(() => {
    ensureJamQueueLockedRef.current?.();
  }, []);

  const {
    play,
    playAll,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    setPlaybackRate,
    clearQueue,
    toggleShuffle,
    cycleRepeat,
    jumpTo,
    playNext,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    syncJamQueue,
  } = usePlayerQueueActions({
    queueRef,
    jamQueueLockedRef,
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
    ensureJamQueueLocked,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
    publishConnectState,
    playbackDeliveryPolicy: getEffectivePlaybackDeliveryPolicy(
      playbackDeliveryPolicy,
    ),
  });

  const clearQueueRef = useRef(clearQueue);
  useEffect(() => {
    clearQueueRef.current = clearQueue;
  }, [clearQueue]);

  const {
    captureQueueSnapshot,
    enterJamSession,
    leaveJamSession,
    restoreQueueSnapshot,
  } = useJamQueueSession({
    commitCurrentTime,
    commitJamQueueLocked,
    currentIndexRef,
    currentTimeRef,
    ensureJamQueueLockedRef,
    isPlayingRef,
    jamQueueLockedRef,
    playSourceRef,
    pushToEngine,
    queueRef,
    repeatRef,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    shuffleRef,
    unshuffledQueueRef,
  });

  const { clearTransferPlaybackGuard, connectValue } =
    usePlayerConnectTransport({
      authUser,
      buildConnectSnapshotPayload,
      commitCurrentTime,
      commitDuration,
      connectEnabled,
      connectV1Enabled,
      connectV2Enabled,
      connectV2PublishRef,
      currentIndex,
      currentTimeRef,
      isBuffering,
      isPlaying,
      isPlayingRef,
      next,
      pendingRestoreTimeRef,
      pause,
      playSource,
      playSourceRef,
      prev,
      publishConnectState,
      pushToEngine,
      queue,
      queueRef,
      repeat,
      repeatRef,
      requireUserGestureToResume,
      resume,
      seek,
      setPlaySource,
      setRepeatState,
      setShuffleState,
      setVolume,
      shuffle,
      shuffleRef,
      suppressNextConnectClaimRef,
      unshuffledQueueRef,
      volume,
    });

  const { playbackNeedsUserGesture, resumeAfterUserGesture } =
    usePlayerLifecycleRuntime({
      clearQueueRef,
      clearTransferPlaybackGuard,
      currentTrack,
      isPlaying,
      resume,
    });

  usePlayerPlatformIntegrations({
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    lastNonZeroVolume: lastNonZeroVolumeRef.current,
    isPlayingRef,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  });

  const { actionsValue, progressValue, stateValue } = usePlayerContextValues({
    actions: {
      queue,
      currentIndex,
      jamQueueLocked,
      jamTransport,
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
      setPlaybackRate,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      enterJamSession,
      leaveJamSession,
      setJamTransport,
      syncJamQueue,
      captureQueueSnapshot,
      restoreQueueSnapshot,
      publishConnectState,
      connect: connectValue,
    },
    progress: { currentTime, duration },
    state: {
      analyserVersion,
      crossfadeTransition,
      isBuffering,
      isPlaying,
      volume,
    },
  });

  return (
    <PlayerProviderSurface
      actionsValue={actionsValue}
      currentTrack={currentTrack}
      playbackNeedsUserGesture={playbackNeedsUserGesture}
      progressValue={progressValue}
      resumeAfterUserGesture={resumeAfterUserGesture}
      stateValue={stateValue}
    >
      {children}
    </PlayerProviderSurface>
  );
}
