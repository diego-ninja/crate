import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import type { RepeatMode, Track } from "@/contexts/player-types";
import { toStartupEngineTracks } from "@/contexts/player-engine-adapter";
import { getStoredQueue } from "@/contexts/player-utils";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  loadQueue as gpLoadQueue,
  pause as gpPause,
  play as gpPlay,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  stop as gpStop,
} from "@/lib/gapless-player";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";

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
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  pullFromEngine: (sourceQueue?: Track[]) => unknown;
  pushToEngine: (
    queue: Track[],
    index: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => void;
  commitIsBuffering: (buffering: boolean) => void;
  commitCurrentTime: (time: number) => void;
  markSeekPosition: (time: number) => void;
  allowAutoplayRestore?: boolean;
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
  pushToEngine,
  commitIsBuffering,
  commitCurrentTime,
  markSeekPosition,
  allowAutoplayRestore = true,
}: UseRestoreOnMountOptions): RestoreController {
  const [stored] = useState(getStoredQueue);
  const pendingRestoreTimeRef = useRef(
    stored.currentTime > 0 ? stored.currentTime : 0,
  );
  const resumeAfterReloadRef = useRef(
    allowAutoplayRestore && stored.wasPlaying,
  );
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
  }, [
    bufferingIntentRef,
    cancelRestoreAutoplay,
    commitIsBuffering,
    isPlayingRef,
    queueRef,
  ]);

  // One-shot restore of saved queue + cursor on first render.
  useEffect(() => {
    if (playerReadyRef.current) return;
    playerReadyRef.current = true;

    if (!stored.queue.length) return;

    const restoredQueue = stored.queue;
    const restoredIndex = Math.max(
      0,
      Math.min(stored.currentIndex, restoredQueue.length - 1),
    );
    pendingRestoreTimeRef.current =
      stored.currentTime > 0 ? stored.currentTime : 0;

    if (shouldUseAndroidNativePlayer()) {
      gpPause();
      gpStop();
      gpLoadQueue([], 0);
      resumeAfterReloadRef.current = false;
      // Mount restoration must push the recovered queue into the player engine.
      // react-doctor-disable-next-line no-pass-data-to-parent, no-pass-live-state-to-parent
      pushToEngine(restoredQueue, restoredIndex, {
        autoplay: allowAutoplayRestore && stored.wasPlaying,
        positionMs: Math.max(0, pendingRestoreTimeRef.current * 1000),
      });
      return;
    }

    void (async () => {
      const engineTracks = await toStartupEngineTracks(
        restoredQueue,
        restoredIndex,
      );
      const engineUrls = engineTracks.map((track) => track.url);
      gpLoadQueue(buildEngineUrls(restoredQueue, engineUrls), restoredIndex);
      gpSetLoop(repeatRef.current === "all");
      gpSetSingleMode(repeatRef.current === "one");

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
    })().catch((error) => {
      console.error("[gapless] failed to restore queue playback:", error);
      commitIsBuffering(false);
    });
  }, [
    buildEngineUrls,
    commitIsBuffering,
    commitCurrentTime,
    markSeekPosition,
    pullFromEngine,
    pushToEngine,
    repeatRef,
    stored,
    allowAutoplayRestore,
  ]);

  // Timer cleanup on unmount.
  useEffect(() => () => cancelRestoreAutoplay(), [cancelRestoreAutoplay]);

  return {
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    restoredShuffle: stored.shuffle,
    restoredUnshuffledQueue: stored.unshuffledQueue,
    tryRestoreAutoplay,
    cancelRestoreAutoplay,
  };
}
