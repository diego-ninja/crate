import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  addTrack as gpAddTrack,
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  getPosition as gpGetPosition,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
  loadQueue as gpLoadQueue,
  next as gpNext,
  pause as gpPause,
  play as gpPlay,
  removeTrack as gpRemoveTrack,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import {
  clampIndex,
  shouldRestartTrackBeforePrev,
  shuffleKeepingCurrent,
} from "@/contexts/player-queue-helpers";
import { getStreamUrl, getTrackCacheKey, STORAGE_KEY } from "@/contexts/player-utils";

const SOFT_PAUSE_FADE_MS = 220;
const PREV_DOUBLE_TAP_WINDOW_MS = 1500;

function shouldUseImmediateTransportAction(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

interface UsePlayerQueueActionsParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  repeatRef: MutableRefObject<RepeatMode>;
  shuffleRef: MutableRefObject<boolean>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  prevRestartTrackKeyRef: MutableRefObject<string | null>;
  prevRestartedAtRef: MutableRefObject<number>;
  activatedTrackKeyRef: MutableRefObject<string | null>;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  setShuffleState: Dispatch<SetStateAction<boolean>>;
  setRepeatState: Dispatch<SetStateAction<RepeatMode>>;
  setVolumeState: Dispatch<SetStateAction<number>>;
  buildEngineUrls: (tracks: Track[]) => string[];
  registerEngineTrack: (track: Track) => string;
  unregisterEngineTrack: (track: Track) => void;
  resetEngineTrackMap: () => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  flushCurrentPlayEvent: (reason: "completed" | "skipped" | "interrupted", track?: Track) => void;
  markSeekPosition: (seconds: number) => void;
  cancelSoftInterruption: () => void;
  cancelRestoreAutoplay: () => void;
  resetPlaybackIntelligence: () => void;
  continueInfinitePlayback: () => boolean;
  clearPrevRestartLatch: () => void;
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  pullFromEngine: (sourceQueue?: Track[]) => { resolvedTrack: Track | undefined };
  pushToEngine: (
    queue: Track[],
    requestedIndex: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => void;
  advanceCursorTo: (index: number) => void;
}

export function usePlayerQueueActions({
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
}: UsePlayerQueueActionsParams) {
  const startQueuePlayback = useCallback((tracks: Track[], startIndex: number, source?: PlaySource) => {
    if (!tracks.length) return;
    const normalizedIndex = clampIndex(startIndex, tracks.length);
    const restartingSameQueueAtSameIndex =
      queueRef.current.length === tracks.length
      && currentIndexRef.current === normalizedIndex
      && queueRef.current.every((track, index) => getStreamUrl(track) === getStreamUrl(tracks[index]!));

    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");

    gpLoadQueue(buildEngineUrls(tracks), normalizedIndex, { restartIfSameIndex: true });
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");

    commitCurrentTime(0);
    bufferingIntentRef.current = !restartingSameQueueAtSameIndex;
    commitIsBuffering(!restartingSameQueueAtSameIndex);
    const nextSource = source || (tracks.length > 1
      ? { type: "queue" as const, name: "Queue" }
      : { type: "track" as const, name: tracks[normalizedIndex]!.title });
    setPlaySource(nextSource);

    const { resolvedTrack } = pullFromEngine(tracks);
    if (resolvedTrack) {
      rememberActiveTrack(resolvedTrack);
      startTrackerSession(resolvedTrack, nextSource);
    }

    gpPlay();
  }, [
    buildEngineUrls,
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    commitCurrentTime,
    commitIsBuffering,
    currentIndexRef,
    flushCurrentPlayEvent,
    rememberActiveTrack,
    resetPlaybackIntelligence,
    pullFromEngine,
    queueRef,
    startTrackerSession,
  ]);

  const play = useCallback((track: Track, source?: PlaySource) => {
    startQueuePlayback([track], 0, source || { type: "track", name: track.title });
  }, [startQueuePlayback]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (!tracks.length) return;
    const track = tracks[clampIndex(startIndex, tracks.length)];
    if (!track) return;
    startQueuePlayback(
      tracks,
      startIndex,
      source || (tracks.length > 1
        ? { type: "queue", name: "Queue" }
        : { type: "track", name: track.title }),
    );
  }, [startQueuePlayback]);

  const pause = useCallback(() => {
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    if (shouldUseImmediateTransportAction()) {
      gpPause();
      return;
    }
    void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPause();
    });
  }, [cancelSoftInterruption, commitIsBuffering]);

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    if (shouldUseImmediateTransportAction()) {
      gpRestoreVolume();
      gpPlay();
      return;
    }
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [cancelSoftInterruption, commitIsBuffering, queueRef]);

  const advanceToTrack = useCallback((targetIndex: number) => {
    const outgoing = queueRef.current[currentIndexRef.current];
    flushCurrentPlayEvent("skipped", outgoing);
    advanceCursorTo(targetIndex);
    const incoming = queueRef.current[targetIndex];
    if (incoming) startTrackerSession(incoming, playSourceRef.current);
  }, [advanceCursorTo, currentIndexRef, flushCurrentPlayEvent, playSourceRef, queueRef, startTrackerSession]);

  const next = useCallback(() => {
    if (!queueRef.current.length) return;

    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < queueRef.current.length) {
      gpNext();
      advanceToTrack(nextIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      gpGotoTrack(0, true);
      advanceToTrack(0);
      return;
    }

    if (continueInfinitePlayback()) {
      flushCurrentPlayEvent("skipped", queueRef.current[currentIndexRef.current]);
    }
  }, [advanceToTrack, continueInfinitePlayback, currentIndexRef, flushCurrentPlayEvent, queueRef, repeatRef]);

  const prev = useCallback(() => {
    if (!queueRef.current.length) return;
    const activeTrack = queueRef.current[currentIndexRef.current];
    const activeTrackKey = activeTrack ? getTrackCacheKey(activeTrack) : null;
    const now = performance.now();
    const justRestartedCurrentTrack =
      !!activeTrackKey &&
      prevRestartTrackKeyRef.current === activeTrackKey &&
      now - prevRestartedAtRef.current < PREV_DOUBLE_TAP_WINDOW_MS;
    const currentPositionSeconds = Math.max(currentTimeRef.current, gpGetPosition() / 1000);

    if (shouldRestartTrackBeforePrev({
      currentTimeSeconds: currentPositionSeconds,
      justRestartedCurrentTrack,
    })) {
      gpSeekTo(0);
      commitCurrentTime(0);
      markSeekPosition(0);
      prevRestartTrackKeyRef.current = activeTrackKey;
      prevRestartedAtRef.current = now;
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      return;
    }

    if (currentIndexRef.current > 0) {
      const targetIndex = currentIndexRef.current - 1;
      clearPrevRestartLatch();
      gpGotoTrack(targetIndex, true);
      advanceToTrack(targetIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      const wrappedIndex = queueRef.current.length - 1;
      clearPrevRestartLatch();
      gpGotoTrack(wrappedIndex, true);
      advanceToTrack(wrappedIndex);
    }
  }, [
    advanceToTrack,
    bufferingIntentRef,
    clearPrevRestartLatch,
    commitCurrentTime,
    commitIsBuffering,
    currentIndexRef,
    currentTimeRef,
    markSeekPosition,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    queueRef,
    repeatRef,
  ]);

  const seek = useCallback((time: number) => {
    const shouldResumeBufferingFlow = isPlayingRef.current;
    bufferingIntentRef.current = shouldResumeBufferingFlow;
    gpSeekTo(time * 1000);
    commitCurrentTime(time);
    commitIsBuffering(shouldResumeBufferingFlow);
    markSeekPosition(time);
  }, [bufferingIntentRef, commitCurrentTime, commitIsBuffering, isPlayingRef, markSeekPosition]);

  const setVolume = useCallback((volume: number) => {
    gpSetVolume(volume);
    setVolumeState(volume);
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
    try {
      localStorage.setItem("listen-player-volume", String(volume));
    } catch {
      // ignore persistence failures
    }
  }, [lastNonZeroVolumeRef, setVolumeState]);

  const clearQueue = useCallback(() => {
    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    bufferingIntentRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    gpPause();
    gpLoadQueue([], 0);
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
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    pendingRestoreTimeRef,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    setPlaySource,
  ]);

  const toggleShuffle = useCallback(() => {
    const previousQueue = queueRef.current;
    if (!previousQueue.length) {
      setShuffleState((value) => !value);
      return;
    }

    const enabling = !shuffleRef.current;
    const activeTrack = previousQueue[currentIndexRef.current];

    if (enabling) {
      unshuffledQueueRef.current = previousQueue.slice();
      const nextQueue = shuffleKeepingCurrent(previousQueue, currentIndexRef.current);
      setShuffleState(true);
      pushToEngine(nextQueue, 0, {
        autoplay: isPlayingRef.current,
        positionMs: gpGetPosition(),
      });
      return;
    }

    const original = unshuffledQueueRef.current ?? previousQueue;
    unshuffledQueueRef.current = null;
    const nextIndex = activeTrack
      ? Math.max(
          0,
          original.findIndex((track) => getTrackCacheKey(track) === getTrackCacheKey(activeTrack)),
        )
      : 0;

    setShuffleState(false);
    pushToEngine(original, nextIndex, {
      autoplay: isPlayingRef.current,
      positionMs: gpGetPosition(),
    });
  }, [
    currentIndexRef,
    isPlayingRef,
    pushToEngine,
    queueRef,
    resetEngineTrackMap,
    setShuffleState,
    shuffleRef,
    unshuffledQueueRef,
  ]);

  const cycleRepeat = useCallback(() => {
    setRepeatState((previousMode) => {
      if (previousMode === "off") return "all";
      if (previousMode === "all") return "one";
      return "off";
    });
  }, [setRepeatState]);

  const jumpTo = useCallback((index: number) => {
    if (index < 0 || index >= queueRef.current.length) return;
    pendingRestoreTimeRef.current = 0;
    gpGotoTrack(index, true);
    advanceToTrack(index);
    commitIsPlaying(true);
  }, [advanceToTrack, commitIsPlaying, pendingRestoreTimeRef, queueRef]);

  const playNext = useCallback((track: Track) => {
    const insertAt = currentIndexRef.current + 1;
    const nextQueue = [...queueRef.current];
    nextQueue.splice(insertAt, 0, track);

    gpInsertTrack(insertAt, registerEngineTrack(track));
    commitQueue(nextQueue);

    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
    }
  }, [commitQueue, currentIndexRef, queueRef, registerEngineTrack, unshuffledQueueRef]);

  const addToQueue = useCallback((track: Track) => {
    const nextQueue = [...queueRef.current, track];
    gpAddTrack(registerEngineTrack(track));
    commitQueue(nextQueue);

    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
    }
  }, [commitQueue, queueRef, registerEngineTrack, unshuffledQueueRef]);

  const removeFromQueue = useCallback((index: number) => {
    const previousQueue = queueRef.current;
    if (index < 0 || index >= previousQueue.length) return;

    const removedTrack = previousQueue[index];
    const removingCurrent = index === currentIndexRef.current;
    const nextQueue = previousQueue.filter((_, queueIndex) => queueIndex !== index);

    if (unshuffledQueueRef.current && removedTrack) {
      const removedKey = getTrackCacheKey(removedTrack);
      unshuffledQueueRef.current = unshuffledQueueRef.current.filter(
        (track) => getTrackCacheKey(track) !== removedKey,
      );
    }

    if (removingCurrent) {
      flushCurrentPlayEvent("skipped");
      const nextIndex = Math.min(currentIndexRef.current, nextQueue.length - 1);
      pushToEngine(nextQueue, nextIndex, {
        autoplay: isPlayingRef.current && nextQueue.length > 0,
        positionMs: 0,
      });
      return;
    }

    gpRemoveTrack(index);
    if (removedTrack) unregisterEngineTrack(removedTrack);
    const nextIndex = index < currentIndexRef.current
      ? currentIndexRef.current - 1
      : currentIndexRef.current;
    commitQueue(nextQueue);
    if (nextIndex !== currentIndexRef.current) {
      commitCurrentIndex(nextIndex);
    }
  }, [
    commitCurrentIndex,
    commitQueue,
    currentIndexRef,
    flushCurrentPlayEvent,
    isPlayingRef,
    pushToEngine,
    queueRef,
    unregisterEngineTrack,
    unshuffledQueueRef,
  ]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
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
        positionMs: gpGetPosition(),
      });
      return;
    }

    gpRemoveTrack(fromIndex);
    unregisterEngineTrack(moved);
    gpInsertTrack(toIndex, registerEngineTrack(moved));

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
  }, [
    commitCurrentIndex,
    commitQueue,
    currentIndexRef,
    isPlayingRef,
    pushToEngine,
    queueRef,
    registerEngineTrack,
    unregisterEngineTrack,
    unshuffledQueueRef,
  ]);

  return {
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
  };
}
