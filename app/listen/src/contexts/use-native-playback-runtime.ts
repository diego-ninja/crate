import { useNativePlaybackEventBridge } from "@/contexts/use-native-playback-event-bridge";

import type { PlaySource, Track } from "@/contexts/player-types";
import { useNativeBufferingRecovery } from "@/contexts/use-native-buffering-recovery";
import { useNativePlaybackReconciliation } from "@/contexts/use-native-playback-reconciliation";
export {
  nativeTransitionFlushReason,
  projectedNativePositionSeconds,
} from "@/contexts/use-native-playback-reconciliation";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

type NativePlaybackRuntimeOptions = {
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTimeRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  effectiveCrossfadeMsRef: ValueRef<number>;
  ensureTrackerSession: (
    track: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped",
    track?: Track,
  ) => void;
  lastNonZeroVolumeRef: ValueRef<number>;
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
};

export function useNativePlaybackRuntime({
  beginSoftInterruption,
  bufferingIntentRef,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsBuffering,
  commitIsPlaying,
  currentIndexRef,
  currentTimeRef,
  currentTrackRef,
  effectiveCrossfadeMsRef,
  ensureTrackerSession,
  flushCurrentPlayEvent,
  lastNonZeroVolumeRef,
  playSourceRef,
  queueRef,
  recordProgress,
  rememberActiveTrack,
  repeatRef,
  rotateTrackerSession,
}: NativePlaybackRuntimeOptions) {
  const {
    clearNativeBufferingWatchdog,
    clearNativeBufferingRecovery,
    recoverNativeBuffering,
    retryNativePlaybackAfterAuthError,
    scheduleNativeBufferingWatchdog,
  } = useNativeBufferingRecovery({
    beginSoftInterruption,
    bufferingIntentRef,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    currentTimeRef,
    currentTrackRef,
    effectiveCrossfadeMsRef,
    lastNonZeroVolumeRef,
    queueRef,
    repeatRef,
  });

  const { applyNativePosition, applyNativeState, applyNativeTrackChange } =
    useNativePlaybackReconciliation({
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
    });

  useNativePlaybackEventBridge({
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    beginSoftInterruption,
    bufferingIntentRef,
    clearNativeBufferingWatchdog,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    flushCurrentPlayEvent,
    queueRef,
    recoverNativeBuffering,
    retryNativePlaybackAfterAuthError,
    scheduleNativeBufferingWatchdog,
  });
}
