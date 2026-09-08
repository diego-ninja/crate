import { useCallback } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import {
  addTrack as gpAddTrack,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
} from "@/lib/gapless-player";
import {
  toFreshEngineTrack,
  toFreshEngineTracks,
} from "@/contexts/player-engine-adapter";

interface Ref<T> {
  current: T;
}

interface UsePlayerIntelligenceActionsOptions {
  advanceCursorTo: (index: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitQueue: (queue: Track[]) => void;
  currentIndexRef: Ref<number>;
  flushCurrentPlayEvent: (reason: "skipped", expectedTrack?: Track) => void;
  playSourceRef: Ref<PlaySource | null>;
  queueRef: Ref<Track[]>;
  recentlyPlayed: Track[];
  registerEngineTrack: (track: Track) => string;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  unshuffledQueueRef: Ref<Track[] | null>;
}

export interface PlayerIntelligenceActions {
  appendAndAdvance: (tracks: Track[]) => void;
  appendIntelligenceTracks: (tracks: Track[]) => void;
  insertSuggestionAfterCurrent: (candidates: Track[]) => void;
}

export function selectUniqueTracks(
  candidates: Track[],
  excludedTracks: Track[],
): Track[] {
  const existingKeys = new Set(
    excludedTracks.map((track) => getTrackCacheKey(track)),
  );
  const unique: Track[] = [];
  for (const track of candidates) {
    const key = getTrackCacheKey(track);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    unique.push(track);
  }
  return unique;
}

export function usePlayerIntelligenceActions({
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
}: UsePlayerIntelligenceActionsOptions): PlayerIntelligenceActions {
  const appendIntelligenceTracks = useCallback(
    (tracks: Track[]) => {
      const queue = queueRef.current;
      const unique = selectUniqueTracks(tracks, [...queue, ...recentlyPlayed]);
      if (unique.length === 0) return;

      const nextQueue = [...queue, ...unique];
      const nativePlayerActive = shouldUseAndroidNativePlayer();
      if (nativePlayerActive) {
        void (async () => {
          const engineTracks = await toFreshEngineTracks(unique, undefined, {
            target: "android-native",
          });
          return androidNativeEngine.appendTracks(engineTracks);
        })().catch((error) => {
          console.error(
            "[native-player] failed to append intelligence tracks:",
            error,
          );
        });
      } else {
        for (const track of unique) {
          gpAddTrack(registerEngineTrack(track));
        }
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
      }
    },
    [
      commitQueue,
      queueRef,
      recentlyPlayed,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const insertSuggestionAfterCurrent = useCallback(
    (candidates: Track[]) => {
      const queue = queueRef.current;
      const insertionIndex = currentIndexRef.current + 1;
      if (insertionIndex <= 0 || insertionIndex > queue.length) return;
      if (queue[insertionIndex]?.isSuggested) return;

      const [suggestion] = selectUniqueTracks(candidates, [
        ...queue,
        ...recentlyPlayed,
      ]);
      if (!suggestion) return;

      const marked: Track = {
        ...suggestion,
        isSuggested: true,
        suggestionSource: "playlist",
      };
      const nextQueue = [...queue];
      nextQueue.splice(insertionIndex, 0, marked);
      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(marked, undefined, {
            target: "android-native",
          });
          return androidNativeEngine.insertTrack(insertionIndex, engineTrack);
        })().catch((error) => {
          console.error(
            "[native-player] failed to insert suggested track:",
            error,
          );
        });
      } else {
        gpInsertTrack(insertionIndex, registerEngineTrack(marked));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, marked];
      }
    },
    [
      commitQueue,
      currentIndexRef,
      queueRef,
      recentlyPlayed,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const appendAndAdvance = useCallback(
    (tracks: Track[]) => {
      const queue = queueRef.current;
      const unique = selectUniqueTracks(tracks, [...queue, ...recentlyPlayed]);
      if (unique.length === 0) {
        commitIsBuffering(false);
        return;
      }

      const nextQueue = [...queue, ...unique];
      const nativePlayerActive = shouldUseAndroidNativePlayer();
      if (nativePlayerActive) {
        void (async () => {
          const engineTracks = await toFreshEngineTracks(unique, undefined, {
            target: "android-native",
          });
          await androidNativeEngine.appendTracks(engineTracks);
          return androidNativeEngine.jumpTo(queue.length, true);
        })().catch((error) => {
          console.error("[native-player] failed to append and advance:", error);
        });
      } else {
        for (const track of unique) {
          gpAddTrack(registerEngineTrack(track));
        }
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
      }

      const nextIndex = queue.length;
      const outgoing = queueRef.current[currentIndexRef.current];
      flushCurrentPlayEvent("skipped", outgoing);
      if (!nativePlayerActive) {
        gpGotoTrack(nextIndex, true);
      }
      advanceCursorTo(nextIndex);
      const incoming = nextQueue[nextIndex];
      if (incoming) startTrackerSession(incoming, playSourceRef.current);
      commitIsPlaying(true);
    },
    [
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
    ],
  );

  return {
    appendAndAdvance,
    appendIntelligenceTracks,
    insertSuggestionAfterCurrent,
  };
}
