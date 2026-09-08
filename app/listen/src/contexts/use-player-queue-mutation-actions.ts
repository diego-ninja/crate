import { useCallback, type MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import { toFreshEngineTrack } from "@/contexts/player-engine-adapter";
import {
  addTrack as gpAddTrack,
  insertTrack as gpInsertTrack,
  removeTrack as gpRemoveTrack,
} from "@/lib/gapless-player";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";

type QueueCommitter = (queue: Track[]) => void;
type IndexCommitter = (index: number) => void;

type PushToEngine = (
  queue: Track[],
  requestedIndex: number,
  options?: {
    autoplay?: boolean;
    positionMs?: number;
    preservePlayback?: boolean;
  },
) => void;

export interface UsePlayerQueueMutationActionsParams {
  queueRef: MutableRefObject<Track[]>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
  registerEngineTrack: (track: Track) => string;
  unregisterEngineTrack: (track: Track) => void;
  commitQueue: QueueCommitter;
  commitCurrentIndex: IndexCommitter;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped" | "interrupted",
    track?: Track,
  ) => void;
  pushToEngine: PushToEngine;
}

function playbackPositionMs(currentTimeSeconds: number): number {
  return Math.max(0, Math.round(currentTimeSeconds * 1000));
}

export function usePlayerQueueMutationActions({
  queueRef,
  jamQueueLockedRef,
  currentIndexRef,
  currentTimeRef,
  isPlayingRef,
  unshuffledQueueRef,
  registerEngineTrack,
  unregisterEngineTrack,
  commitQueue,
  commitCurrentIndex,
  flushCurrentPlayEvent,
  pushToEngine,
}: UsePlayerQueueMutationActionsParams) {
  const playNext = useCallback(
    (track: Track) => {
      if (jamQueueLockedRef.current) return;
      const insertAt = currentIndexRef.current + 1;
      const nextQueue = [...queueRef.current];
      nextQueue.splice(insertAt, 0, track);

      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(track, undefined, {
            target: "android-native",
          });
          return nativeEngine.insertTrack(insertAt, engineTrack);
        })().catch((error) => {
          console.error("[native-player] failed to insert track:", error);
        });
      } else {
        gpInsertTrack(insertAt, registerEngineTrack(track));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
      }
    },
    [
      commitQueue,
      currentIndexRef,
      jamQueueLockedRef,
      queueRef,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      if (jamQueueLockedRef.current) return;
      const nextQueue = [...queueRef.current, track];
      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(track, undefined, {
            target: "android-native",
          });
          return nativeEngine.appendTracks([engineTrack]);
        })().catch((error) => {
          console.error("[native-player] failed to append track:", error);
        });
      } else {
        gpAddTrack(registerEngineTrack(track));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
      }
    },
    [
      commitQueue,
      jamQueueLockedRef,
      queueRef,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (jamQueueLockedRef.current) return;
      const previousQueue = queueRef.current;
      if (index < 0 || index >= previousQueue.length) return;

      const removedTrack = previousQueue[index];
      const removingCurrent = index === currentIndexRef.current;
      const nextQueue = previousQueue.filter(
        (_, queueIndex) => queueIndex !== index,
      );

      if (unshuffledQueueRef.current && removedTrack) {
        const removedKey = getTrackCacheKey(removedTrack);
        unshuffledQueueRef.current = unshuffledQueueRef.current.filter(
          (track) => getTrackCacheKey(track) !== removedKey,
        );
      }

      if (removingCurrent) {
        flushCurrentPlayEvent("skipped");
        const nextIndex = Math.min(
          currentIndexRef.current,
          nextQueue.length - 1,
        );
        pushToEngine(nextQueue, nextIndex, {
          autoplay: isPlayingRef.current && nextQueue.length > 0,
          positionMs: 0,
        });
        return;
      }

      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.removeTrack(index).catch((error) => {
          console.error("[native-player] failed to remove track:", error);
        });
      } else {
        gpRemoveTrack(index);
        if (removedTrack) unregisterEngineTrack(removedTrack);
      }
      const nextIndex =
        index < currentIndexRef.current
          ? currentIndexRef.current - 1
          : currentIndexRef.current;
      commitQueue(nextQueue);
      if (nextIndex !== currentIndexRef.current) {
        commitCurrentIndex(nextIndex);
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      flushCurrentPlayEvent,
      isPlayingRef,
      jamQueueLockedRef,
      pushToEngine,
      queueRef,
      unregisterEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (jamQueueLockedRef.current) return;
      const previousQueue = queueRef.current;
      if (
        fromIndex < 0 ||
        fromIndex >= previousQueue.length ||
        toIndex < 0 ||
        toIndex >= previousQueue.length ||
        fromIndex === toIndex
      ) {
        return;
      }

      const nextQueue = [...previousQueue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      if (!moved) return;
      nextQueue.splice(toIndex, 0, moved);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = null;
      }

      const activeIndex = currentIndexRef.current;
      const movingCurrent = fromIndex === activeIndex;
      if (movingCurrent) {
        pushToEngine(nextQueue, toIndex, {
          autoplay: isPlayingRef.current,
          positionMs: playbackPositionMs(currentTimeRef.current),
        });
        return;
      }

      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.reorderTrack(fromIndex, toIndex).catch((error) => {
          console.error("[native-player] failed to reorder queue:", error);
        });
      } else {
        gpRemoveTrack(fromIndex);
        unregisterEngineTrack(moved);
        gpInsertTrack(toIndex, registerEngineTrack(moved));
      }

      let nextIndex = activeIndex;
      if (fromIndex < activeIndex && toIndex >= activeIndex) {
        nextIndex = activeIndex - 1;
      } else if (fromIndex > activeIndex && toIndex <= activeIndex) {
        nextIndex = activeIndex + 1;
      }

      commitQueue(nextQueue);
      if (nextIndex !== activeIndex) {
        commitCurrentIndex(nextIndex);
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      currentTimeRef,
      isPlayingRef,
      jamQueueLockedRef,
      pushToEngine,
      queueRef,
      registerEngineTrack,
      unregisterEngineTrack,
      unshuffledQueueRef,
    ],
  );

  return { addToQueue, playNext, removeFromQueue, reorderQueue };
}
