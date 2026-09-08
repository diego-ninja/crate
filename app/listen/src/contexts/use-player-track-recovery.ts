import { useCallback, useEffect, useRef } from "react";

import type { Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  canApplyNextTrackResolution,
  getNextTrackIndex,
} from "@/contexts/player-next-track-resolution";
import {
  toFreshEngineTrack,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import {
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  loadQueue as gpLoadQueue,
  play as gpPlay,
  replaceTrack as gpReplaceTrack,
  seekTo as gpSeekTo,
} from "@/lib/gapless-player";
import { createQueueRevision } from "@/lib/playback-engine";

interface Ref<T> {
  current: T;
}

interface UsePlayerTrackRecoveryOptions {
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  currentIndexRef: Ref<number>;
  currentTimeRef: Ref<number>;
  effectiveCrossfadeMsRef: Ref<number>;
  lastNonZeroVolumeRef: Ref<number>;
  queueRef: Ref<Track[]>;
  repeatRef: Ref<"off" | "one" | "all">;
}

export interface PlayerTrackRecoveryRuntime {
  preResolveNextTrack: () => void;
  recoverActiveTrackRef: Ref<() => Promise<boolean>>;
}

export function buildTrackResolutionKey(
  currentTrackKey: string,
  nextTrackKey: string,
  currentIndex: number,
  nextIndex: number,
  expectedUrl: string,
): string {
  return [
    currentTrackKey,
    nextTrackKey,
    currentIndex,
    nextIndex,
    expectedUrl,
  ].join(":");
}

export function usePlayerTrackRecovery({
  buildEngineUrls,
  currentIndexRef,
  currentTimeRef,
  effectiveCrossfadeMsRef,
  lastNonZeroVolumeRef,
  queueRef,
  repeatRef,
}: UsePlayerTrackRecoveryOptions): PlayerTrackRecoveryRuntime {
  const recoverActiveTrackRef = useRef<() => Promise<boolean>>(
    async () => false,
  );
  const nextTrackResolutionKeyRef = useRef<string | null>(null);

  const recoverActiveTrack = useCallback(async () => {
    const recoveryQueue = queueRef.current;
    if (recoveryQueue.length === 0) return false;
    const recoveryIndex = clampIndex(
      currentIndexRef.current,
      recoveryQueue.length,
    );
    const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
    const nativePlayerActive = shouldUseAndroidNativePlayer();
    const engineTracks = await toStartupEngineTracks(
      recoveryQueue,
      recoveryIndex,
      undefined,
      nativePlayerActive ? { target: "android-native" } : undefined,
    );

    if (nativePlayerActive) {
      await androidNativeEngine.loadQueue({
        revision: createQueueRevision(),
        tracks: engineTracks,
        currentIndex: recoveryIndex,
        positionMs,
        autoplay: true,
        repeat: repeatRef.current,
        crossfadeMs: effectiveCrossfadeMsRef.current,
        volume: lastNonZeroVolumeRef.current,
      });
      return true;
    }

    gpLoadQueue(
      buildEngineUrls(
        recoveryQueue,
        engineTracks.map((track) => track.url),
      ),
      recoveryIndex,
      { restartIfSameIndex: true },
    );
    if (positionMs > 0) {
      gpSeekTo(positionMs);
    }
    await gpPlay();
    return true;
  }, [
    buildEngineUrls,
    currentIndexRef,
    currentTimeRef,
    effectiveCrossfadeMsRef,
    lastNonZeroVolumeRef,
    queueRef,
    repeatRef,
  ]);

  useEffect(() => {
    recoverActiveTrackRef.current = recoverActiveTrack;
  }, [recoverActiveTrack]);

  const preResolveNextTrack = useCallback(() => {
    if (shouldUseAndroidNativePlayer()) return;

    const queueSnapshot = queueRef.current;
    const currentIndex = currentIndexRef.current;
    const nextIndex = getNextTrackIndex(
      queueSnapshot.length,
      currentIndex,
      repeatRef.current,
    );
    if (nextIndex === null) return;

    const currentTrack = queueSnapshot[currentIndex];
    const nextTrack = queueSnapshot[nextIndex];
    if (!currentTrack || !nextTrack?.globalTrackUid) return;

    const expectedUrl = gpGetTracks()[nextIndex];
    if (!expectedUrl) return;

    const resolutionKey = buildTrackResolutionKey(
      getTrackCacheKey(currentTrack),
      getTrackCacheKey(nextTrack),
      currentIndex,
      nextIndex,
      expectedUrl,
    );
    if (nextTrackResolutionKeyRef.current === resolutionKey) return;
    nextTrackResolutionKeyRef.current = resolutionKey;

    void toFreshEngineTrack(nextTrack)
      .then((resolvedTrack) => {
        if (resolvedTrack.url === expectedUrl) return;

        const engineUrls = gpGetTracks();
        if (
          !canApplyNextTrackResolution(
            {
              queue: queueSnapshot,
              currentIndex,
              nextIndex,
              expectedUrl,
            },
            {
              queue: queueRef.current,
              currentIndex: currentIndexRef.current,
              engineIndex: gpGetTrackIndex(),
              engineUrl: engineUrls[nextIndex],
            },
          )
        ) {
          return;
        }

        gpReplaceTrack(nextIndex, resolvedTrack.url);
        const resolvedUrls = [...engineUrls];
        resolvedUrls[nextIndex] = resolvedTrack.url;
        buildEngineUrls(queueSnapshot, resolvedUrls);
      })
      .catch((error) => {
        if (nextTrackResolutionKeyRef.current === resolutionKey) {
          nextTrackResolutionKeyRef.current = null;
        }
        console.warn("[gapless] failed to resolve next track:", error);
      });
  }, [buildEngineUrls, currentIndexRef, queueRef, repeatRef]);

  return { preResolveNextTrack, recoverActiveTrackRef };
}
