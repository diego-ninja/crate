import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { clampIndex, resolveQueueFromUrls } from "@/contexts/player-queue-helpers";
import {
  getEffectiveCrossfadeSeconds,
  getPredictableNextTrack,
  getTrackCacheKey,
  MAX_RECENT,
  saveRecentlyPlayed,
} from "@/contexts/player-utils";
import {
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  loadQueue as gpLoadQueue,
  pause as gpPause,
  play as gpPlay,
  seekTo as gpSeekTo,
  setCrossfadeDuration as gpSetCrossfadeDuration,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
} from "@/lib/gapless-player";
import { getCrossfadeDurationPreference } from "@/lib/player-playback-prefs";

interface UsePlayerEngineSyncParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTrackRef: MutableRefObject<Track | undefined>;
  repeatRef: MutableRefObject<RepeatMode>;
  shuffleRef: MutableRefObject<boolean>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  smartCrossfadeEnabledRef: MutableRefObject<boolean>;
  effectiveCrossfadeMsRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  durationRef: MutableRefObject<number>;
  bufferingIntentRef: MutableRefObject<boolean>;
  activatedTrackKeyRef: MutableRefObject<string | null>;
  engineTrackMapRef: MutableRefObject<Map<string, Track[]>>;
  setRecentlyPlayed: Dispatch<SetStateAction<Track[]>>;
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  buildEngineUrls: (tracks: Track[]) => string[];
  clearPrevRestartLatch: () => void;
  markSeekPosition: (seconds: number) => void;
}

export function usePlayerEngineSync({
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
}: UsePlayerEngineSyncParams) {
  const syncEffectiveCrossfade = useCallback(() => {
    const nextTrack = getPredictableNextTrack(
      queueRef.current,
      currentIndexRef.current,
      repeatRef.current,
      shuffleRef.current,
    );
    const effectiveSeconds = getEffectiveCrossfadeSeconds(
      currentTrackRef.current,
      nextTrack,
      playSourceRef.current,
      shuffleRef.current,
      getCrossfadeDurationPreference(),
      smartCrossfadeEnabledRef.current,
    );
    const effectiveMs = Math.max(0, effectiveSeconds * 1000);
    effectiveCrossfadeMsRef.current = effectiveMs;
    gpSetCrossfadeDuration(effectiveMs);
    return effectiveMs;
  }, [
    currentIndexRef,
    currentTrackRef,
    effectiveCrossfadeMsRef,
    playSourceRef,
    queueRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  ]);

  const addToRecentlyPlayed = useCallback((track: Track) => {
    setRecentlyPlayed((previous) => {
      const filtered = previous.filter((candidate) => candidate.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }, [setRecentlyPlayed]);

  const rememberActiveTrack = useCallback((track: Track | undefined) => {
    if (!track) {
      activatedTrackKeyRef.current = null;
      return;
    }
    const trackKey = getTrackCacheKey(track);
    if (activatedTrackKeyRef.current === trackKey) return;
    activatedTrackKeyRef.current = trackKey;
    addToRecentlyPlayed(track);
  }, [activatedTrackKeyRef, addToRecentlyPlayed]);

  const pullFromEngine = useCallback((sourceQueue?: Track[]) => {
    const resolvedQueue = resolveQueueFromUrls(
      gpGetTracks(),
      sourceQueue ?? queueRef.current,
      engineTrackMapRef.current,
    );
    const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
    const resolvedTrack = resolvedQueue[resolvedIndex];
    const resolvedDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);

    const previousQueue = queueRef.current;
    const sameQueue =
      resolvedQueue.length === previousQueue.length &&
      resolvedQueue.every((track, index) => track === previousQueue[index]);
    if (!sameQueue) {
      commitQueue(resolvedQueue);
    }

    if (resolvedIndex !== currentIndexRef.current) {
      commitCurrentIndex(resolvedIndex);
    }
    if (resolvedDuration !== durationRef.current) {
      commitDuration(resolvedDuration);
    }
    rememberActiveTrack(resolvedTrack);

    return {
      resolvedQueue,
      resolvedIndex,
      resolvedTrack,
    };
  }, [
    commitCurrentIndex,
    commitDuration,
    commitQueue,
    currentIndexRef,
    durationRef,
    engineTrackMapRef,
    queueRef,
    rememberActiveTrack,
  ]);

  const pushToEngine = useCallback((
    nextQueue: Track[],
    requestedIndex: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => {
    const nextIndex = clampIndex(requestedIndex, nextQueue.length);
    const autoplay = options?.autoplay ?? isPlayingRef.current;
    const positionMs = options?.positionMs ?? 0;

    if (nextQueue.length === 0) {
      bufferingIntentRef.current = false;
      gpPause();
      gpLoadQueue([], 0);
      engineTrackMapRef.current = new Map();
      commitQueue([]);
      commitCurrentIndex(0);
      commitCurrentTime(0);
      commitDuration(0);
      commitIsPlaying(false);
      commitIsBuffering(false);
      activatedTrackKeyRef.current = null;
      return;
    }

    gpLoadQueue(buildEngineUrls(nextQueue), nextIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");

    pullFromEngine(nextQueue);

    if (positionMs > 0) {
      gpSeekTo(positionMs);
      const positionSeconds = positionMs / 1000;
      commitCurrentTime(positionSeconds);
      markSeekPosition(positionSeconds);
    } else {
      commitCurrentTime(0);
    }

    if (autoplay) {
      bufferingIntentRef.current = true;
      commitIsBuffering(true);
      gpPlay();
    } else {
      bufferingIntentRef.current = false;
      gpPause();
      commitIsPlaying(false);
      commitIsBuffering(false);
    }
  }, [
    activatedTrackKeyRef,
    buildEngineUrls,
    bufferingIntentRef,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    engineTrackMapRef,
    isPlayingRef,
    markSeekPosition,
    pullFromEngine,
    repeatRef,
  ]);

  const advanceCursorTo = useCallback((index: number) => {
    clearPrevRestartLatch();
    commitCurrentIndex(index);
    commitCurrentTime(0);
    commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
    rememberActiveTrack(queueRef.current[index]);
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
  }, [
    bufferingIntentRef,
    clearPrevRestartLatch,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    queueRef,
    rememberActiveTrack,
  ]);

  return {
    syncEffectiveCrossfade,
    rememberActiveTrack,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  };
}
