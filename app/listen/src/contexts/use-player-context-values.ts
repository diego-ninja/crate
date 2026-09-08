import { useMemo } from "react";

import type {
  PlayerActionsValue,
  PlayerProgressValue,
  PlayerStateValue,
} from "@/contexts/player-context";

interface PlayerContextValuesInput {
  actions: PlayerActionsValue;
  progress: PlayerProgressValue;
  state: PlayerStateValue;
}

export function usePlayerContextValues({
  actions,
  progress,
  state,
}: PlayerContextValuesInput) {
  const stateValue = useMemo(
    () => ({
      analyserVersion: state.analyserVersion,
      crossfadeTransition: state.crossfadeTransition,
      isBuffering: state.isBuffering,
      isPlaying: state.isPlaying,
      volume: state.volume,
    }),
    [
      state.analyserVersion,
      state.crossfadeTransition,
      state.isBuffering,
      state.isPlaying,
      state.volume,
    ],
  );

  const progressValue = useMemo(
    () => ({
      currentTime: progress.currentTime,
      duration: progress.duration,
    }),
    [progress.currentTime, progress.duration],
  );

  const actionsValue = useMemo(
    () => ({
      addToQueue: actions.addToQueue,
      captureQueueSnapshot: actions.captureQueueSnapshot,
      clearQueue: actions.clearQueue,
      connect: actions.connect,
      currentIndex: actions.currentIndex,
      currentTrack: actions.currentTrack,
      cycleRepeat: actions.cycleRepeat,
      enterJamSession: actions.enterJamSession,
      jamQueueLocked: actions.jamQueueLocked,
      jamTransport: actions.jamTransport,
      jumpTo: actions.jumpTo,
      leaveJamSession: actions.leaveJamSession,
      next: actions.next,
      pause: actions.pause,
      play: actions.play,
      playAll: actions.playAll,
      playNext: actions.playNext,
      playSource: actions.playSource,
      prev: actions.prev,
      publishConnectState: actions.publishConnectState,
      queue: actions.queue,
      reorderQueue: actions.reorderQueue,
      removeFromQueue: actions.removeFromQueue,
      repeat: actions.repeat,
      restoreQueueSnapshot: actions.restoreQueueSnapshot,
      recentlyPlayed: actions.recentlyPlayed,
      resume: actions.resume,
      seek: actions.seek,
      setJamTransport: actions.setJamTransport,
      setPlaybackRate: actions.setPlaybackRate,
      setVolume: actions.setVolume,
      shuffle: actions.shuffle,
      smartCrossfadeEnabled: actions.smartCrossfadeEnabled,
      syncJamQueue: actions.syncJamQueue,
      toggleShuffle: actions.toggleShuffle,
    }),
    [
      actions.addToQueue,
      actions.captureQueueSnapshot,
      actions.clearQueue,
      actions.connect,
      actions.currentIndex,
      actions.currentTrack,
      actions.cycleRepeat,
      actions.enterJamSession,
      actions.jamQueueLocked,
      actions.jamTransport,
      actions.jumpTo,
      actions.leaveJamSession,
      actions.next,
      actions.pause,
      actions.play,
      actions.playAll,
      actions.playNext,
      actions.playSource,
      actions.prev,
      actions.publishConnectState,
      actions.queue,
      actions.reorderQueue,
      actions.removeFromQueue,
      actions.repeat,
      actions.restoreQueueSnapshot,
      actions.recentlyPlayed,
      actions.resume,
      actions.seek,
      actions.setJamTransport,
      actions.setPlaybackRate,
      actions.setVolume,
      actions.shuffle,
      actions.smartCrossfadeEnabled,
      actions.syncJamQueue,
      actions.toggleShuffle,
    ],
  );

  return { actionsValue, progressValue, stateValue };
}
