import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { shuffleKeepingCurrent } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey, STORAGE_KEY } from "@/contexts/player-utils";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { getPosition as gpGetPosition } from "@/lib/gapless-player";
import { castStop, isCastSessionActive } from "@/lib/cast-sender";
import type { EngineRepeatMode } from "@/lib/playback-engine";

type QueueCommitter = (queue: Track[]) => void;
type IndexCommitter = (index: number) => void;
type TimeCommitter = (time: number) => void;
type DurationCommitter = (duration: number) => void;
type PlaybackCommitter = (isPlaying: boolean) => void;
type BufferingCommitter = (isBuffering: boolean) => void;

function toEngineRepeatMode(repeat: RepeatMode): EngineRepeatMode {
  return repeat;
}

function playbackPositionMs(currentTimeSeconds: number): number {
  if (shouldUseAndroidNativePlayer()) {
    return Math.max(0, Math.round(currentTimeSeconds * 1000));
  }
  return gpGetPosition();
}

export interface UsePlayerQueueStateActionsParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  shuffleRef: MutableRefObject<boolean>;
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  activatedTrackKeyRef: MutableRefObject<string | null>;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  setShuffleState: Dispatch<SetStateAction<boolean>>;
  setRepeatState: Dispatch<SetStateAction<RepeatMode>>;
  resetEngineTrackMap: () => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped" | "interrupted",
    track?: Track,
  ) => void;
  cancelSoftInterruption: () => void;
  cancelRestoreAutoplay: () => void;
  resetPlaybackIntelligence: () => void;
  commitQueue: QueueCommitter;
  commitCurrentIndex: IndexCommitter;
  commitCurrentTime: TimeCommitter;
  commitDuration: DurationCommitter;
  commitIsPlaying: PlaybackCommitter;
  commitIsBuffering: BufferingCommitter;
  pushToEngine: (
    queue: Track[],
    requestedIndex: number,
    options?: {
      autoplay?: boolean;
      positionMs?: number;
      preservePlayback?: boolean;
    },
  ) => void;
  silenceGaplessEngine: () => void;
  stopNativeEngineIfAvailable: (context: string) => void;
}

export function usePlayerQueueStateActions({
  queueRef,
  currentIndexRef,
  currentTimeRef,
  isPlayingRef,
  jamQueueLockedRef,
  shuffleRef,
  unshuffledQueueRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  resumeAfterReloadRef,
  activatedTrackKeyRef,
  setPlaySource,
  setShuffleState,
  setRepeatState,
  resetEngineTrackMap,
  flushCurrentPlayEvent,
  cancelSoftInterruption,
  cancelRestoreAutoplay,
  resetPlaybackIntelligence,
  commitQueue,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  pushToEngine,
  silenceGaplessEngine,
  stopNativeEngineIfAvailable,
}: UsePlayerQueueStateActionsParams) {
  const clearQueue = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (isCastSessionActive()) {
      void castStop().catch((error) => {
        console.error("[cast] failed to stop:", error);
      });
    }
    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    bufferingIntentRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    stopNativeEngineIfAvailable("clear queue");
    silenceGaplessEngine();
    resetEngineTrackMap();
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
      // ignore persistence failures
    }
  }, [
    activatedTrackKeyRef,
    bufferingIntentRef,
    cancelRestoreAutoplay,
    cancelSoftInterruption,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    jamQueueLockedRef,
    pendingRestoreTimeRef,
    resetEngineTrackMap,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    setPlaySource,
    silenceGaplessEngine,
    stopNativeEngineIfAvailable,
  ]);

  const toggleShuffle = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    const previousQueue = queueRef.current;
    if (!previousQueue.length) {
      setShuffleState((value) => !value);
      return;
    }

    const enabling = !shuffleRef.current;
    const activeTrack = previousQueue[currentIndexRef.current];

    if (enabling) {
      unshuffledQueueRef.current = previousQueue.slice();
      const nextQueue = shuffleKeepingCurrent(
        previousQueue,
        currentIndexRef.current,
      );
      setShuffleState(true);
      pushToEngine(nextQueue, 0, {
        autoplay: isPlayingRef.current,
        positionMs: playbackPositionMs(currentTimeRef.current),
      });
      return;
    }

    const original = unshuffledQueueRef.current ?? previousQueue;
    unshuffledQueueRef.current = null;
    const nextIndex = activeTrack
      ? Math.max(
          0,
          original.findIndex(
            (track) =>
              getTrackCacheKey(track) === getTrackCacheKey(activeTrack),
          ),
        )
      : 0;

    setShuffleState(false);
    pushToEngine(original, nextIndex, {
      autoplay: isPlayingRef.current,
      positionMs: playbackPositionMs(currentTimeRef.current),
    });
  }, [
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    jamQueueLockedRef,
    pushToEngine,
    queueRef,
    setShuffleState,
    shuffleRef,
    unshuffledQueueRef,
  ]);

  const cycleRepeat = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    setRepeatState((previousMode) => {
      const nextMode =
        previousMode === "off" ? "all" : previousMode === "all" ? "one" : "off";
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine
          .setRepeat(toEngineRepeatMode(nextMode))
          .catch((error) => {
            console.error("[native-player] failed to set repeat:", error);
          });
      }
      return nextMode;
    });
  }, [jamQueueLockedRef, setRepeatState]);

  return { clearQueue, toggleShuffle, cycleRepeat };
}
