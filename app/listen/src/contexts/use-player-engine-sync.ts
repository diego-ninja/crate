import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import {
  getEffectiveCrossfadeSeconds,
  getPredictableNextTrack,
  getTrackCacheKey,
  MAX_RECENT,
  saveRecentlyPlayed,
} from "@/contexts/player-utils";
import { usePlayerEngineQueueSync } from "@/contexts/use-player-engine-queue-sync";
import {
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getTrackIndex as gpGetTrackIndex,
  setCrossfadeDuration as gpSetCrossfadeDuration,
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
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
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

  const addToRecentlyPlayed = useCallback(
    (track: Track) => {
      setRecentlyPlayed((previous) => {
        const filtered = previous.filter(
          (candidate) => candidate.id !== track.id,
        );
        const updated = [track, ...filtered].slice(0, MAX_RECENT);
        saveRecentlyPlayed(updated);
        return updated;
      });
    },
    [setRecentlyPlayed],
  );

  const rememberActiveTrack = useCallback(
    (track: Track | undefined) => {
      if (!track) {
        activatedTrackKeyRef.current = null;
        return;
      }
      const trackKey = getTrackCacheKey(track);
      if (activatedTrackKeyRef.current === trackKey) return;
      activatedTrackKeyRef.current = trackKey;
      addToRecentlyPlayed(track);
    },
    [activatedTrackKeyRef, addToRecentlyPlayed],
  );

  const pullFromEngine = useCallback(
    (sourceQueue?: Track[]) => {
      // React owns queue order and membership. Engine callbacks can observe
      // a stale/partial playlist while a reload is in flight, so they may
      // only provide the cursor and duration here—not replace the queue.
      const resolvedQueue = sourceQueue ?? queueRef.current;
      const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
      const resolvedTrack = resolvedQueue[resolvedIndex];
      const engineDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);
      const knownDuration =
        typeof resolvedTrack?.duration === "number" &&
        Number.isFinite(resolvedTrack.duration) &&
        resolvedTrack.duration > 0
          ? resolvedTrack.duration
          : 0;
      const resolvedDuration = engineDuration || knownDuration;

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
    },
    [
      commitCurrentIndex,
      commitDuration,
      commitQueue,
      currentIndexRef,
      durationRef,
      queueRef,
      rememberActiveTrack,
    ],
  );

  const { pushToEngine } = usePlayerEngineQueueSync({
    repeatRef,
    isPlayingRef,
    effectiveCrossfadeMsRef,
    bufferingIntentRef,
    activatedTrackKeyRef,
    engineTrackMapRef,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    buildEngineUrls,
    markSeekPosition,
    rememberActiveTrack,
    pullFromEngine,
  });

  const advanceCursorTo = useCallback(
    (index: number) => {
      const targetTrack = queueRef.current[index];
      const engineDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);
      const fallbackDuration =
        typeof targetTrack?.duration === "number" &&
        Number.isFinite(targetTrack.duration) &&
        targetTrack.duration > 0
          ? targetTrack.duration
          : 0;
      clearPrevRestartLatch();
      commitCurrentIndex(index);
      commitCurrentTime(0);
      commitDuration(engineDuration || fallbackDuration);
      rememberActiveTrack(targetTrack);
      bufferingIntentRef.current = true;
      commitIsBuffering(true);
    },
    [
      bufferingIntentRef,
      clearPrevRestartLatch,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      queueRef,
      rememberActiveTrack,
    ],
  );

  return {
    syncEffectiveCrossfade,
    rememberActiveTrack,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  };
}
