import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import type { RepeatMode, Track } from "@/contexts/player-types";
import { getStoredQueue } from "@/contexts/player-utils";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  loadQueue as gpLoadQueue,
  play as gpPlay,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
} from "@/lib/gapless-player";

const SOFT_PAUSE_FADE_MS = 220;
const AUTOPLAY_TIMEOUT_MS = 2500;

interface UseRestoreOnMountOptions {
  isPlayingRef: MutableRefObject<boolean>;
  queueRef: MutableRefObject<Track[]>;
  repeatRef: MutableRefObject<RepeatMode>;
  /**
   * Set true while the restore autoplay is in flight so onPause/onBuffering
   * callbacks can distinguish "we're trying to start" from "we actually
   * stopped". Cleared when the attempt succeeds or times out.
   */
  bufferingIntentRef: MutableRefObject<boolean>;
  buildEngineUrls: (tracks: Track[]) => string[];
  pullFromEngine: (sourceQueue?: Track[]) => unknown;
  commitIsBuffering: (buffering: boolean) => void;
  commitCurrentTime: (time: number) => void;
  markSeekPosition: (time: number) => void;
}

export interface RestoreController {
  /**
   * How much time (seconds) the engine should seek to once its onLoad
   * fires for the restored track. Set on mount, consumed by the onLoad
   * callback in PlayerContext, then zeroed.
   */
  pendingRestoreTimeRef: MutableRefObject<number>;
  /**
   * True if the restored session was playing when last unloaded. When
   * the first onLoad fires, we attempt to resume playback. Reset to
   * false once the restoration attempt succeeds or times out.
   */
  resumeAfterReloadRef: MutableRefObject<boolean>;
  /**
   * Shuffle state at persistence time. The queue stored in localStorage
   * IS the shuffled order; the caller must initialize its shuffle flag
   * from this value so the UI matches what's actually loaded.
   */
  restoredShuffle: boolean;
  /**
   * Original (un-shuffled) queue snapshot captured at the time shuffle
   * was turned on. Null if shuffle wasn't active at persistence. Caller
   * hydrates its `unshuffledQueueRef` from this so toggling shuffle off
   * after a reload restores the pre-shuffle order.
   */
  restoredUnshuffledQueue: Track[] | null;
  /**
   * One-shot autoplay trigger for the restored session. Caller invokes
   * this from the engine's onLoad callback; the hook handles the fade +
   * timeout internally.
   */
  tryRestoreAutoplay: () => void;
  /** Cancel any pending autoplay timeout and mark restore as dismissed. */
  cancelRestoreAutoplay: () => void;
}

/**
 * Restores the persisted player state (queue, current index, position,
 * was-playing flag) on mount. Runs exactly once per provider lifetime.
 *
 * Split from PlayerContext so the restoration lifecycle (one-shot
 * autoplay with fade + safety timeout) is isolated from the steady-state
 * engine callbacks.
 */
export function useRestoreOnMount({
  isPlayingRef,
  queueRef,
  repeatRef,
  bufferingIntentRef,
  buildEngineUrls,
  pullFromEngine,
  commitIsBuffering,
  commitCurrentTime,
  markSeekPosition,
}: UseRestoreOnMountOptions): RestoreController {
  const storedRef = useRef(getStoredQueue());
  const pendingRestoreTimeRef = useRef(
    storedRef.current.currentTime > 0 ? storedRef.current.currentTime : 0,
  );
  const resumeAfterReloadRef = useRef(storedRef.current.wasPlaying);
  const restoreAutoplayAttemptedRef = useRef(false);
  const restoreAutoplayTimerRef = useRef<number | null>(null);
  const playerReadyRef = useRef(false);

  const cancelRestoreAutoplay = useCallback(() => {
    if (restoreAutoplayTimerRef.current != null) {
      window.clearTimeout(restoreAutoplayTimerRef.current);
      restoreAutoplayTimerRef.current = null;
    }
  }, []);

  const tryRestoreAutoplay = useCallback(() => {
    if (!resumeAfterReloadRef.current) return;
    if (restoreAutoplayAttemptedRef.current) return;
    if (queueRef.current.length === 0) return;

    restoreAutoplayAttemptedRef.current = true;
    bufferingIntentRef.current = true;
    commitIsBuffering(true);

    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });

    cancelRestoreAutoplay();
    restoreAutoplayTimerRef.current = window.setTimeout(() => {
      if (!isPlayingRef.current) {
        resumeAfterReloadRef.current = false;
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
      }
    }, AUTOPLAY_TIMEOUT_MS);
  }, [bufferingIntentRef, cancelRestoreAutoplay, commitIsBuffering, isPlayingRef, queueRef]);

  // One-shot restore of saved queue + cursor on first render.
  useEffect(() => {
    if (playerReadyRef.current) return;
    playerReadyRef.current = true;

    if (!storedRef.current.queue.length) return;

    const restoredQueue = storedRef.current.queue;
    const restoredIndex = Math.max(
      0,
      Math.min(storedRef.current.currentIndex, restoredQueue.length - 1),
    );
    gpLoadQueue(buildEngineUrls(restoredQueue), restoredIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    pendingRestoreTimeRef.current =
      storedRef.current.currentTime > 0 ? storedRef.current.currentTime : 0;

    // pullFromEngine commits queue/index/duration internally.
    pullFromEngine(restoredQueue);

    // If we have a saved position, seek to it right away so the UI
    // reflects it before any onLoad fires. The engine seeks properly
    // once the track is loaded (via pendingRestoreTimeRef in onLoad).
    if (pendingRestoreTimeRef.current > 0) {
      gpSeekTo(pendingRestoreTimeRef.current * 1000);
      commitCurrentTime(pendingRestoreTimeRef.current);
      markSeekPosition(pendingRestoreTimeRef.current);
    }
  }, [buildEngineUrls, commitCurrentTime, markSeekPosition, pullFromEngine, repeatRef]);

  // Timer cleanup on unmount.
  useEffect(() => () => cancelRestoreAutoplay(), [cancelRestoreAutoplay]);

  return {
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    restoredShuffle: storedRef.current.shuffle,
    restoredUnshuffledQueue: storedRef.current.unshuffledQueue,
    tryRestoreAutoplay,
    cancelRestoreAutoplay,
  };
}
