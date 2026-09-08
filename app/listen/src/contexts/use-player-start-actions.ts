import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { toStartupEngineTracks } from "@/contexts/player-engine-adapter";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { getStreamUrl } from "@/contexts/player-utils";
import {
  getCrossfadeDurationPreference,
  type PlaybackDeliveryPolicy,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import {
  createQueueRevision,
  type EngineRepeatMode,
} from "@/lib/playback-engine";
import {
  loadQueue as gpLoadQueue,
  play as gpPlay,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
} from "@/lib/gapless-player";

type QueueCommitter = (queue: Track[]) => void;
type IndexCommitter = (index: number) => void;
type PlaybackCommitter = (value: boolean) => void;
type TimeCommitter = (value: number) => void;
type DurationCommitter = (value: number) => void;
type BufferingCommitter = (value: boolean) => void;

function toEngineRepeatMode(repeat: RepeatMode): EngineRepeatMode {
  return repeat;
}

function getKnownDuration(track: Track | undefined): number {
  return typeof track?.duration === "number" &&
    Number.isFinite(track.duration) &&
    track.duration > 0
    ? track.duration
    : 0;
}

function nativeCrossfadeMs(): number {
  return Math.max(0, getCrossfadeDurationPreference() * 1000);
}

function isJamPlaybackSource(source: PlaySource | undefined): boolean {
  return source?.type === "queue" && source.name.startsWith("Jam:");
}

export interface UsePlayerStartActionsParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  repeatRef: MutableRefObject<RepeatMode>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  rememberActiveTrack: (track: Track | undefined) => void;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped" | "interrupted",
    track?: Track,
  ) => void;
  cancelSoftInterruption: () => void;
  cancelRestoreAutoplay: () => void;
  resetPlaybackIntelligence: () => void;
  commitQueue: QueueCommitter;
  commitCurrentIndex: IndexCommitter;
  commitCurrentTime: TimeCommitter;
  commitDuration: DurationCommitter;
  commitIsPlaying: PlaybackCommitter;
  commitIsBuffering: BufferingCommitter;
  pullFromEngine: (sourceQueue?: Track[]) => {
    resolvedTrack: Track | undefined;
  };
  publishConnectState?: (options?: { claimActive?: boolean }) => Promise<void>;
  playbackDeliveryPolicy: PlaybackDeliveryPolicy;
  silenceGaplessEngine: () => void;
  stopNativeEngineIfAvailable: (context: string) => void;
}

export function usePlayerStartActions({
  queueRef,
  currentIndexRef,
  jamQueueLockedRef,
  repeatRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  resumeAfterReloadRef,
  lastNonZeroVolumeRef,
  setPlaySource,
  buildEngineUrls,
  rememberActiveTrack,
  startTrackerSession,
  flushCurrentPlayEvent,
  cancelSoftInterruption,
  cancelRestoreAutoplay,
  resetPlaybackIntelligence,
  commitQueue,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  pullFromEngine,
  publishConnectState,
  playbackDeliveryPolicy,
  silenceGaplessEngine,
  stopNativeEngineIfAvailable,
}: UsePlayerStartActionsParams) {
  const startQueuePlayback = useCallback(
    (tracks: Track[], startIndex: number, source?: PlaySource) => {
      if (jamQueueLockedRef.current && !isJamPlaybackSource(source)) return;
      if (!tracks.length) return;
      const normalizedIndex = clampIndex(startIndex, tracks.length);
      const restartingSameQueueAtSameIndex =
        queueRef.current.length === tracks.length &&
        currentIndexRef.current === normalizedIndex &&
        queueRef.current.every(
          (track, index) =>
            getStreamUrl(track) === getStreamUrl(tracks[index]!),
        );

      cancelSoftInterruption();
      pendingRestoreTimeRef.current = 0;
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      resetPlaybackIntelligence();
      flushCurrentPlayEvent("interrupted");

      preparePlaybackDelivery(tracks, normalizedIndex, playbackDeliveryPolicy, {
        immediate: true,
      });
      const activeTrack = tracks[normalizedIndex];
      commitCurrentTime(0);
      commitDuration(getKnownDuration(activeTrack));
      bufferingIntentRef.current = !restartingSameQueueAtSameIndex;
      commitIsBuffering(!restartingSameQueueAtSameIndex);
      const nextSource =
        source ||
        (tracks.length > 1
          ? { type: "queue" as const, name: "Queue" }
          : { type: "track" as const, name: tracks[normalizedIndex]!.title });
      setPlaySource(nextSource);

      if (shouldUseAndroidNativePlayer()) {
        silenceGaplessEngine();
        commitQueue(tracks);
        commitCurrentIndex(normalizedIndex);
        if (activeTrack) {
          rememberActiveTrack(activeTrack);
          startTrackerSession(activeTrack, nextSource);
        }
        commitIsPlaying(true);
        void primeOfflineRuntimeProfile().catch((error) => {
          console.warn(
            "[offline] failed to prime profile before native load:",
            error,
          );
        });
        void (async () => {
          const engineTracks = await toStartupEngineTracks(
            tracks,
            normalizedIndex,
            undefined,
            { target: "android-native" },
          );
          return nativeEngine.loadQueue({
            revision: createQueueRevision(),
            tracks: engineTracks,
            currentIndex: normalizedIndex,
            positionMs: 0,
            autoplay: true,
            repeat: toEngineRepeatMode(repeatRef.current),
            crossfadeMs: nativeCrossfadeMs(),
            volume: lastNonZeroVolumeRef.current,
          });
        })().catch((error) => {
          console.error("[native-player] failed to load queue:", error);
          commitIsPlaying(false);
          commitIsBuffering(false);
        });
        void publishConnectState?.({ claimActive: true }).catch(() => {});
        return;
      }

      void (async () => {
        const engineTracks = await toStartupEngineTracks(
          tracks,
          normalizedIndex,
        );
        const engineUrls = engineTracks.map((track) => track.url);

        stopNativeEngineIfAvailable("before web queue load");
        gpLoadQueue(buildEngineUrls(tracks, engineUrls), normalizedIndex, {
          restartIfSameIndex: true,
        });
        gpSetLoop(repeatRef.current === "all");
        gpSetSingleMode(repeatRef.current === "one");

        const { resolvedTrack } = pullFromEngine(tracks);
        if (resolvedTrack) {
          rememberActiveTrack(resolvedTrack);
          startTrackerSession(resolvedTrack, nextSource);
        }

        gpPlay();
        void publishConnectState?.({ claimActive: true }).catch(() => {});
      })().catch((error) => {
        console.error("[gapless] failed to resolve queue playback:", error);
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
        commitIsPlaying(false);
      });
    },
    [
      buildEngineUrls,
      cancelSoftInterruption,
      cancelRestoreAutoplay,
      commitCurrentIndex,
      commitCurrentTime,
      commitIsBuffering,
      commitIsPlaying,
      commitQueue,
      commitDuration,
      bufferingIntentRef,
      currentIndexRef,
      flushCurrentPlayEvent,
      jamQueueLockedRef,
      lastNonZeroVolumeRef,
      playbackDeliveryPolicy,
      pendingRestoreTimeRef,
      publishConnectState,
      pullFromEngine,
      queueRef,
      rememberActiveTrack,
      repeatRef,
      resetPlaybackIntelligence,
      resumeAfterReloadRef,
      setPlaySource,
      silenceGaplessEngine,
      startTrackerSession,
      stopNativeEngineIfAvailable,
    ],
  );

  const play = useCallback(
    (track: Track, source?: PlaySource) => {
      startQueuePlayback(
        [track],
        0,
        source || { type: "track", name: track.title },
      );
    },
    [startQueuePlayback],
  );

  const playAll = useCallback(
    (tracks: Track[], startIndex = 0, source?: PlaySource) => {
      if (!tracks.length) return;
      const track = tracks[clampIndex(startIndex, tracks.length)];
      if (!track) return;
      startQueuePlayback(
        tracks,
        startIndex,
        source ||
          (tracks.length > 1
            ? { type: "queue", name: "Queue" }
            : { type: "track", name: track.title }),
      );
    },
    [startQueuePlayback],
  );

  return { play, playAll, startQueuePlayback };
}
