import { useCallback, type MutableRefObject } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { shouldRestartTrackBeforePrev } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import {
  getPosition as gpGetPosition,
  gotoTrack as gpGotoTrack,
  next as gpNext,
  seekTo as gpSeekTo,
} from "@/lib/gapless-player";
import {
  castSeek,
  isCastSessionActive,
  startCastSession,
} from "@/lib/cast-sender";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";

const PREV_DOUBLE_TAP_WINDOW_MS = 1500;

export interface UsePlayerNavigationActionsParams {
  queueRef: MutableRefObject<Track[]>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  repeatRef: MutableRefObject<RepeatMode>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  prevRestartTrackKeyRef: MutableRefObject<string | null>;
  prevRestartedAtRef: MutableRefObject<number>;
  commitCurrentTime: (time: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  markSeekPosition: (seconds: number) => void;
  clearPrevRestartLatch: () => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped" | "interrupted",
    track?: Track,
  ) => void;
  advanceCursorTo: (index: number) => void;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  continueInfinitePlayback: () => boolean;
  playbackDeliveryPolicy: PlaybackDeliveryPolicy;
}

export function usePlayerNavigationActions({
  queueRef,
  currentIndexRef,
  currentTimeRef,
  jamQueueLockedRef,
  repeatRef,
  playSourceRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  prevRestartTrackKeyRef,
  prevRestartedAtRef,
  commitCurrentTime,
  commitIsPlaying,
  commitIsBuffering,
  markSeekPosition,
  clearPrevRestartLatch,
  flushCurrentPlayEvent,
  advanceCursorTo,
  startTrackerSession,
  continueInfinitePlayback,
  playbackDeliveryPolicy,
}: UsePlayerNavigationActionsParams) {
  const advanceToTrack = useCallback(
    (targetIndex: number) => {
      preparePlaybackDelivery(
        queueRef.current,
        targetIndex,
        playbackDeliveryPolicy,
        { immediate: true },
      );
      const outgoing = queueRef.current[currentIndexRef.current];
      flushCurrentPlayEvent("skipped", outgoing);
      advanceCursorTo(targetIndex);
      const incoming = queueRef.current[targetIndex];
      if (incoming) startTrackerSession(incoming, playSourceRef.current);
    },
    [
      advanceCursorTo,
      currentIndexRef,
      flushCurrentPlayEvent,
      playSourceRef,
      playbackDeliveryPolicy,
      queueRef,
      startTrackerSession,
    ],
  );

  const next = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (!queueRef.current.length) return;

    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < queueRef.current.length) {
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[nextIndex];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to load next track:", error);
          });
        }
        advanceToTrack(nextIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.next().catch((error) => {
          console.error("[native-player] failed to skip next:", error);
        });
      } else {
        gpNext();
      }
      advanceToTrack(nextIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[0];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to wrap queue:", error);
          });
        }
        advanceToTrack(0);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(0, true).catch((error) => {
          console.error("[native-player] failed to wrap queue:", error);
        });
      } else {
        gpGotoTrack(0, true);
      }
      advanceToTrack(0);
      return;
    }

    if (continueInfinitePlayback()) {
      flushCurrentPlayEvent(
        "skipped",
        queueRef.current[currentIndexRef.current],
      );
    }
  }, [
    advanceToTrack,
    commitCurrentTime,
    commitIsPlaying,
    continueInfinitePlayback,
    currentIndexRef,
    flushCurrentPlayEvent,
    jamQueueLockedRef,
    queueRef,
    repeatRef,
  ]);

  const prev = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (!queueRef.current.length) return;
    const activeTrack = queueRef.current[currentIndexRef.current];
    const activeTrackKey = activeTrack ? getTrackCacheKey(activeTrack) : null;
    const now = performance.now();
    const justRestartedCurrentTrack =
      !!activeTrackKey &&
      prevRestartTrackKeyRef.current === activeTrackKey &&
      now - prevRestartedAtRef.current < PREV_DOUBLE_TAP_WINDOW_MS;
    const currentPositionSeconds = Math.max(
      currentTimeRef.current,
      gpGetPosition() / 1000,
    );

    if (
      shouldRestartTrackBeforePrev({
        currentTimeSeconds: currentPositionSeconds,
        justRestartedCurrentTrack,
      })
    ) {
      if (isCastSessionActive()) {
        void castSeek(0).catch((error) => {
          console.error("[cast] failed to restart track:", error);
        });
        commitCurrentTime(0);
        markSeekPosition(0);
        prevRestartTrackKeyRef.current = activeTrackKey;
        prevRestartedAtRef.current = now;
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.seekTo(0).catch((error) => {
          console.error("[native-player] failed to restart track:", error);
        });
      } else {
        gpSeekTo(0);
      }
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
      if (isCastSessionActive()) {
        const previousTrack = queueRef.current[targetIndex];
        if (previousTrack) {
          void startCastSession({
            track: previousTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to load previous track:", error);
          });
        }
        advanceToTrack(targetIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.previous().catch((error) => {
          console.error("[native-player] failed to skip previous:", error);
        });
      } else {
        gpGotoTrack(targetIndex, true);
      }
      advanceToTrack(targetIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      const wrappedIndex = queueRef.current.length - 1;
      clearPrevRestartLatch();
      if (isCastSessionActive()) {
        const previousTrack = queueRef.current[wrappedIndex];
        if (previousTrack) {
          void startCastSession({
            track: previousTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to wrap previous:", error);
          });
        }
        advanceToTrack(wrappedIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(wrappedIndex, true).catch((error) => {
          console.error("[native-player] failed to wrap previous:", error);
        });
      } else {
        gpGotoTrack(wrappedIndex, true);
      }
      advanceToTrack(wrappedIndex);
    }
  }, [
    advanceToTrack,
    bufferingIntentRef,
    clearPrevRestartLatch,
    commitCurrentTime,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    currentTimeRef,
    jamQueueLockedRef,
    markSeekPosition,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    queueRef,
    repeatRef,
  ]);

  const jumpTo = useCallback(
    (index: number) => {
      if (jamQueueLockedRef.current) return;
      if (index < 0 || index >= queueRef.current.length) return;
      pendingRestoreTimeRef.current = 0;
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[index];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to jump:", error);
          });
        }
        advanceToTrack(index);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(index, true).catch((error) => {
          console.error("[native-player] failed to jump:", error);
        });
      } else {
        gpGotoTrack(index, true);
      }
      advanceToTrack(index);
      commitIsPlaying(true);
    },
    [
      advanceToTrack,
      commitCurrentTime,
      commitIsPlaying,
      jamQueueLockedRef,
      pendingRestoreTimeRef,
      queueRef,
    ],
  );

  return { next, prev, jumpTo };
}
