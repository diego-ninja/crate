import { useEffect } from "react";
import type { MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import { saveQueue } from "@/contexts/player-utils";

const CHECKPOINT_INTERVAL_MS = 5000;

interface UsePlaybackPersistenceOptions {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  shuffle: boolean;
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  shuffleRef: MutableRefObject<boolean>;
  /**
   * Snapshot of the original (un-shuffled) queue order. Persisted so a
   * reload while shuffle is on can reverse-toggle back to the sequence
   * the user started from.
   */
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
}

/**
 * Persists the player state to localStorage across three triggers:
 *
 *   1. Structural changes (queue / currentIndex / play-pause) — write
 *      immediately on the corresponding state update.
 *   2. Periodic checkpoint every 5s while a queue is loaded, so a tab
 *      crash doesn't lose more than a few seconds of resume position.
 *   3. pagehide / beforeunload — final snapshot on tab close or SPA
 *      navigation away (pagehide covers iOS Safari; beforeunload covers
 *      most desktop browsers).
 *
 * Critically does NOT write on currentTime changes (fires ~37 times/sec
 * from Gapless ontimeupdate) — serializing the full queue that often
 * becomes a real main-thread tax on larger queues.
 */
export function usePlaybackPersistence({
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
}: UsePlaybackPersistenceOptions): void {
  const persistNow = (playing: boolean) => {
    saveQueue(queueRef.current, currentIndexRef.current, {
      currentTime: currentTimeRef.current,
      wasPlaying: playing,
      shuffle: shuffleRef.current,
      unshuffledQueue: unshuffledQueueRef.current,
    });
  };

  // Structural: immediate writes on queue / cursor / play-pause / shuffle changes.
  useEffect(() => {
    persistNow(isPlaying);
  }, [queue, currentIndex, isPlaying, shuffle]);

  // Periodic checkpoint so a crash mid-playback doesn't erase resume
  // position. No-op when the queue is empty.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!queueRef.current.length) return;
      persistNow(isPlayingRef.current);
    }, CHECKPOINT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Unload: final snapshot for resume on next session. Both events fire
  // to cover iOS Safari (pagehide) and desktop (beforeunload).
  useEffect(() => {
    const handler = () => {
      if (!queueRef.current.length) return;
      persistNow(isPlayingRef.current);
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, []);
}
