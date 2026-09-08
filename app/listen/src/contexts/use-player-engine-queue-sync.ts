import { useCallback, useRef } from "react";

import type { RepeatMode, Track } from "@/contexts/player-types";
import { toStartupEngineTracks } from "@/contexts/player-engine-adapter";
import { clampIndex } from "@/contexts/player-queue-helpers";
import {
  loadQueue as gpLoadQueue,
  pause as gpPause,
  play as gpPlay,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
} from "@/lib/gapless-player";
import {
  androidNativeEngine,
  isAndroidNativePlayerAvailable,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import { createQueueRevision } from "@/lib/playback-engine";

interface UsePlayerEngineQueueSyncParams {
  repeatRef: { current: RepeatMode };
  isPlayingRef: { current: boolean };
  effectiveCrossfadeMsRef: { current: number };
  bufferingIntentRef: { current: boolean };
  activatedTrackKeyRef: { current: string | null };
  engineTrackMapRef: { current: Map<string, Track[]> };
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  markSeekPosition: (seconds: number) => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  pullFromEngine: (sourceQueue?: Track[]) => unknown;
}

function silenceGaplessEngine() {
  gpPause();
  gpLoadQueue([], 0);
}

function stopNativeEngineIfAvailable(context: string) {
  if (!isAndroidNativePlayerAvailable()) return;
  void androidNativeEngine.stop().catch((error) => {
    console.error(`[native-player] failed to stop ${context}:`, error);
  });
}

export function usePlayerEngineQueueSync({
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
}: UsePlayerEngineQueueSyncParams) {
  const engineSyncRevisionRef = useRef(0);

  const pushToEngine = useCallback(
    (
      nextQueue: Track[],
      requestedIndex: number,
      options?: {
        autoplay?: boolean;
        positionMs?: number;
        preservePlayback?: boolean;
      },
    ) => {
      const syncRevision = ++engineSyncRevisionRef.current;
      const isCurrentSync = () =>
        engineSyncRevisionRef.current === syncRevision;
      const nextIndex = clampIndex(requestedIndex, nextQueue.length);
      const autoplay = options?.autoplay ?? isPlayingRef.current;
      const positionMs = options?.positionMs ?? 0;
      const preservePlayback = options?.preservePlayback === true;

      if (nextQueue.length === 0) {
        bufferingIntentRef.current = false;
        stopNativeEngineIfAvailable("empty queue sync");
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

      if (shouldUseAndroidNativePlayer()) {
        silenceGaplessEngine();
        const targetTrack = nextQueue[nextIndex];
        const knownDuration =
          typeof targetTrack?.duration === "number" &&
          Number.isFinite(targetTrack.duration) &&
          targetTrack.duration > 0
            ? targetTrack.duration
            : 0;
        const positionSeconds = positionMs / 1000;

        commitQueue(nextQueue);
        commitCurrentIndex(nextIndex);
        commitCurrentTime(positionSeconds);
        commitDuration(knownDuration);
        rememberActiveTrack(targetTrack);

        if (positionMs > 0) {
          markSeekPosition(positionSeconds);
        }

        bufferingIntentRef.current = autoplay;
        commitIsBuffering(autoplay);
        commitIsPlaying(autoplay);

        void primeOfflineRuntimeProfile().catch((error) => {
          console.warn(
            "[offline] failed to prime profile before native sync:",
            error,
          );
        });
        void (async () => {
          const engineTracks = await toStartupEngineTracks(
            nextQueue,
            nextIndex,
            undefined,
            { target: "android-native" },
          );
          if (!isCurrentSync()) return;
          return androidNativeEngine.loadQueue({
            revision: createQueueRevision(),
            tracks: engineTracks,
            currentIndex: nextIndex,
            positionMs,
            autoplay,
            repeat: repeatRef.current,
            crossfadeMs: effectiveCrossfadeMsRef.current,
            volume: 1,
          });
        })().catch((error) => {
          if (!isCurrentSync()) return;
          console.error("[native-player] failed to sync queue:", error);
          commitIsBuffering(false);
          commitIsPlaying(false);
        });
        return;
      }

      // Publish the authoritative queue immediately. The web engine load is
      // asynchronous and pullFromEngine can briefly observe the previous
      // queue; committing first prevents that stale read from winning.
      // Pause before resolving/loading the replacement playlist. Otherwise
      // Gapless-5 can start the newly selected source at 0 while the async
      // queue rebuild is still in flight, producing an audible restart before
      // the authoritative position is applied.
      if (preservePlayback) {
        gpPause();
      }
      commitQueue(nextQueue);
      commitCurrentIndex(nextIndex);
      commitCurrentTime(positionMs / 1000);

      void (async () => {
        const engineTracks = await toStartupEngineTracks(nextQueue, nextIndex);
        const engineUrls = engineTracks.map((track) => track.url);

        if (!isCurrentSync()) return;

        stopNativeEngineIfAvailable("before web engine sync");
        gpLoadQueue(buildEngineUrls(nextQueue, engineUrls), nextIndex);
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
          gpPlay();
        } else {
          gpPause();
        }
      })().catch((error) => {
        if (!isCurrentSync()) return;
        console.error("[gapless] failed to sync queue playback:", error);
        commitIsBuffering(false);
        commitIsPlaying(false);
      });

      if (autoplay) {
        bufferingIntentRef.current = true;
        commitIsBuffering(true);
      } else {
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
      }
    },
    [
      activatedTrackKeyRef,
      buildEngineUrls,
      bufferingIntentRef,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      commitQueue,
      effectiveCrossfadeMsRef,
      engineTrackMapRef,
      isPlayingRef,
      markSeekPosition,
      pullFromEngine,
      rememberActiveTrack,
      repeatRef,
    ],
  );

  return { pushToEngine };
}
