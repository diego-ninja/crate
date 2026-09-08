import { useCallback } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import type { EnginePositionEvent, EngineState } from "@/lib/playback-engine";

type ValueRef<T> = { readonly current: T };

export function nativeTransitionFlushReason(
  reason: string | undefined,
  fromIndex: number,
  toIndex: number,
  queueLength: number,
  repeat: string,
): "completed" | "skipped" | null {
  if (reason === "playlist") return null;
  if (reason === "auto" || reason === "repeat") return "completed";
  const movedToSequentialNext =
    toIndex === fromIndex + 1 ||
    (repeat === "all" && fromIndex === queueLength - 1 && toIndex === 0);
  return movedToSequentialNext ? "completed" : "skipped";
}

function nativeMsToSeconds(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value / 1000)
    : 0;
}

export function projectedNativePositionSeconds(
  positionMs: number | null | undefined,
  nativeTimeMs: number | null | undefined,
  isPlaying: boolean,
  durationMs?: number | null,
): number {
  const positionSeconds = nativeMsToSeconds(positionMs);
  if (
    !isPlaying ||
    typeof nativeTimeMs !== "number" ||
    !Number.isFinite(nativeTimeMs)
  ) {
    return positionSeconds;
  }
  const elapsedSeconds = Math.max(0, (Date.now() - nativeTimeMs) / 1000);
  const projected = positionSeconds + elapsedSeconds;
  const durationSeconds = nativeMsToSeconds(durationMs);
  return durationSeconds > 0 ? Math.min(projected, durationSeconds) : projected;
}

function trackDurationSeconds(track: Track | undefined): number {
  return typeof track?.duration === "number" &&
    Number.isFinite(track.duration) &&
    track.duration > 0
    ? track.duration
    : 0;
}

export interface UseNativePlaybackReconciliationParams {
  clearNativeBufferingRecovery: () => void;
  clearNativeBufferingWatchdog: () => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  ensureTrackerSession: (
    track: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  playSourceRef: ValueRef<PlaySource | null>;
  queueRef: ValueRef<Track[]>;
  recordProgress: (positionSeconds: number) => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  repeatRef: ValueRef<"off" | "one" | "all">;
  rotateTrackerSession: (
    reason: "completed" | "skipped",
    outgoing: Track | undefined,
    incoming: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  scheduleNativeBufferingWatchdog: () => void;
}

export function useNativePlaybackReconciliation({
  clearNativeBufferingRecovery,
  clearNativeBufferingWatchdog,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  currentIndexRef,
  currentTrackRef,
  ensureTrackerSession,
  playSourceRef,
  queueRef,
  recordProgress,
  rememberActiveTrack,
  repeatRef,
  rotateTrackerSession,
  scheduleNativeBufferingWatchdog,
}: UseNativePlaybackReconciliationParams) {
  const applyNativePosition = useCallback(
    (event: EnginePositionEvent) => {
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(event.durationMs);
      const fallbackDurationSeconds = trackDurationSeconds(
        queueRef.current[event.index] ?? currentTrackRef.current,
      );
      commitCurrentTime(positionSeconds);
      if (nativeDurationSeconds > 0 || fallbackDurationSeconds > 0) {
        commitDuration(nativeDurationSeconds || fallbackDurationSeconds);
      }
      commitIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        recordProgress(positionSeconds);
      }
    },
    [
      commitCurrentTime,
      commitDuration,
      commitIsPlaying,
      currentTrackRef,
      queueRef,
      recordProgress,
    ],
  );

  const applyNativeState = useCallback(
    (
      state: EngineState,
      options: { rotateIndexChange?: boolean; passiveLifecycle?: boolean } = {},
    ) => {
      const positionSeconds = projectedNativePositionSeconds(
        state.positionMs,
        state.nativeTimeMs,
        state.isPlaying,
        state.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(state.durationMs);
      commitCurrentTime(positionSeconds);
      if (state.queueSize === 0) {
        commitDuration(0);
      }

      const queue = queueRef.current;
      if (state.index >= 0 && state.index < queue.length) {
        const previousIndex = currentIndexRef.current;
        const incomingTrack = queue[state.index];
        const durationSeconds =
          nativeDurationSeconds || trackDurationSeconds(incomingTrack);
        if (durationSeconds > 0) {
          commitDuration(durationSeconds);
        }
        if (state.index !== previousIndex) {
          const outgoingTrack = queue[previousIndex];
          if (options.rotateIndexChange) {
            const reason = nativeTransitionFlushReason(
              undefined,
              previousIndex,
              state.index,
              queue.length,
              repeatRef.current,
            );
            if (reason) {
              rotateTrackerSession(
                reason,
                outgoingTrack,
                incomingTrack,
                playSourceRef.current,
              );
            }
          } else if (state.isPlaying) {
            ensureTrackerSession(incomingTrack, playSourceRef.current);
          }
          commitCurrentIndex(state.index);
          rememberActiveTrack(incomingTrack);
        } else {
          rememberActiveTrack(incomingTrack);
          if (state.isPlaying) {
            ensureTrackerSession(incomingTrack, playSourceRef.current);
          }
        }
      }

      const isPassiveLifecycleBuffering =
        options.passiveLifecycle && state.playbackState === "buffering";
      commitIsPlaying(state.isPlaying);
      commitIsBuffering(
        isPassiveLifecycleBuffering
          ? false
          : state.playbackState === "buffering",
      );
      if (state.playbackState === "buffering" && !isPassiveLifecycleBuffering) {
        scheduleNativeBufferingWatchdog();
      } else {
        if (state.playbackState !== "buffering") {
          clearNativeBufferingRecovery();
        }
        clearNativeBufferingWatchdog();
      }
      if (state.isPlaying) {
        recordProgress(positionSeconds);
      }
    },
    [
      clearNativeBufferingRecovery,
      clearNativeBufferingWatchdog,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      ensureTrackerSession,
      playSourceRef,
      queueRef,
      recordProgress,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const applyNativeTrackChange = useCallback(
    (event: EnginePositionEvent & { reason?: string }) => {
      const queue = queueRef.current;
      if (event.index < 0 || event.index >= queue.length) return;

      const previousIndex = currentIndexRef.current;
      const incomingTrack = queue[event.index];
      const outgoingTrack = queue[previousIndex];
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const durationSeconds =
        nativeMsToSeconds(event.durationMs) ||
        trackDurationSeconds(incomingTrack);
      commitCurrentTime(positionSeconds);
      if (durationSeconds > 0) {
        commitDuration(durationSeconds);
      }

      if (event.index !== previousIndex) {
        const reason = nativeTransitionFlushReason(
          event.reason,
          previousIndex,
          event.index,
          queue.length,
          repeatRef.current,
        );
        if (reason) {
          rotateTrackerSession(
            reason,
            outgoingTrack,
            incomingTrack,
            playSourceRef.current,
          );
        } else {
          ensureTrackerSession(incomingTrack, playSourceRef.current);
        }
        commitCurrentIndex(event.index);
        rememberActiveTrack(incomingTrack);
      } else {
        rememberActiveTrack(incomingTrack);
        if (event.isPlaying) {
          ensureTrackerSession(incomingTrack, playSourceRef.current);
        }
      }

      commitIsPlaying(event.isPlaying);
      commitIsBuffering(false);
    },
    [
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      ensureTrackerSession,
      playSourceRef,
      queueRef,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
    ],
  );

  return { applyNativePosition, applyNativeState, applyNativeTrackChange };
}
