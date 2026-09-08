import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  getCurrentBufferedAheadSeconds,
  isCurrentTrackFullyBuffered,
  pause as gpPause,
  restoreVolume as gpRestoreVolume,
} from "@/lib/gapless-player";
import { probeTrackAvailability } from "./soft-interruption-probe";
import { useSoftInterruptionEvents } from "./use-soft-interruption-events";

const STREAM_STALL_GRACE_MS = 2500;
const RECOVERY_RETRY_MS = 3000;
const SOFT_PAUSE_FADE_MS = 220;
export const BUFFERED_AHEAD_SAFE_SECONDS = 5;
export const BUFFERED_AHEAD_CRITICAL_SECONDS = 1.5;

export const PLAYBACK_NEEDS_USER_GESTURE_EVENT =
  "crate:playback-needs-user-gesture";

interface UseSoftInterruptionOptions {
  currentTrackRef: MutableRefObject<Track | undefined>;
  isPlayingRef: MutableRefObject<boolean>;
  isBufferingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  commitIsPlaying: (value: boolean) => void;
  commitIsBuffering: (value: boolean) => void;
  onPlaybackStall?: () => void;
  onPlaybackStallEnded?: (
    durationMs: number,
    bufferedAheadSeconds: number,
  ) => void;
  onPlaybackRecovered?: (attempt: number) => void;
  recoverCurrentTrack?: () => Promise<boolean>;
}

export interface SoftInterruptionController {
  beginSoftInterruption: (reason: "offline" | "stream") => void;
  cancelSoftInterruption: () => void;
  requireUserGestureToResume: () => void;
  scheduleStallProtection: () => void;
  clearStallTimer: () => void;
  /** True if the player is currently in a soft-interrupted state. */
  isSoftInterrupted: () => boolean;
}

/**
 * Handles "soft" playback interruptions — network stalls and offline
 * events — with a fade-out + probe-and-resume recovery loop.
 *
 * Responsibilities:
 *   - stall detection (watchdog on onBuffering events)
 *   - pause with fade on offline / stream errors
 *   - periodic lightweight range probe on the stream URL
 *   - resume with fade when probe succeeds
 *   - react to browser online/offline events
 *
 * The hook owns all its timing state; the caller only feeds in refs to
 * playback state and a way to set buffering.
 */
export function useSoftInterruption({
  currentTrackRef,
  isPlayingRef,
  isBufferingRef,
  bufferingIntentRef,
  commitIsPlaying,
  commitIsBuffering,
  onPlaybackStall,
  onPlaybackStallEnded,
  onPlaybackRecovered,
  recoverCurrentTrack,
}: UseSoftInterruptionOptions): SoftInterruptionController {
  const softInterruptionReasonRef = useRef<"offline" | "stream" | null>(null);
  const shouldAutoResumeAfterInterruptionRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const recoveryProbeInFlightRef = useRef(false);
  const recoveryFailuresRef = useRef(0);
  const interruptionStartedAtRef = useRef<number | null>(null);
  // Forward-declared so callbacks can reach the latest implementation.
  const maybeResumeRef = useRef<() => Promise<void>>(async () => {});
  const scheduleStallProtectionRef = useRef<() => void>(() => {});

  const hasSafeBufferedAhead = useCallback(
    () =>
      isCurrentTrackFullyBuffered() ||
      getCurrentBufferedAheadSeconds() >= BUFFERED_AHEAD_SAFE_SECONDS,
    [],
  );

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current != null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current != null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const scheduleRecoveryCheck = useCallback(
    (delay: number = RECOVERY_RETRY_MS) => {
      clearRecoveryTimer();
      if (!shouldAutoResumeAfterInterruptionRef.current) return;
      recoveryTimerRef.current = window.setTimeout(() => {
        void maybeResumeRef.current();
      }, delay);
    },
    [clearRecoveryTimer],
  );

  const beginSoftInterruption = useCallback(
    (reason: "offline" | "stream") => {
      if (!currentTrackRef.current) return;
      // The audio is already in RAM — no network dependency. Interrupting
      // would pause a perfectly-playing track. Defensive guard so every
      // caller (offline event, error, stall timer) is consistent.
      if (hasSafeBufferedAhead()) return;
      if (softInterruptionReasonRef.current) {
        // Upgrade to "offline" if a stream interruption is later revealed
        // to be a network issue.
        if (reason === "offline") {
          softInterruptionReasonRef.current = reason;
        }
        scheduleRecoveryCheck(reason === "offline" ? 0 : RECOVERY_RETRY_MS);
        return;
      }

      softInterruptionReasonRef.current = reason;
      shouldAutoResumeAfterInterruptionRef.current = true;
      onPlaybackStall?.();
      interruptionStartedAtRef.current = Date.now();
      recoveryProbeInFlightRef.current = false;
      recoveryFailuresRef.current = 0;
      clearStallTimer();
      clearRecoveryTimer();
      bufferingIntentRef.current = false;
      commitIsBuffering(true);

      if (shouldUseAndroidNativePlayer()) {
        void androidNativeEngine.pause().catch(() => {});
      } else if (isPlayingRef.current) {
        void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {});
      } else {
        gpPause();
      }

      scheduleRecoveryCheck(reason === "offline" ? 0 : RECOVERY_RETRY_MS);
    },
    [
      bufferingIntentRef,
      clearRecoveryTimer,
      clearStallTimer,
      commitIsBuffering,
      currentTrackRef,
      hasSafeBufferedAhead,
      isPlayingRef,
      onPlaybackStall,
      scheduleRecoveryCheck,
    ],
  );

  const cancelSoftInterruption = useCallback(() => {
    if (interruptionStartedAtRef.current !== null) {
      onPlaybackStallEnded?.(
        Math.max(0, Date.now() - interruptionStartedAtRef.current),
        getCurrentBufferedAheadSeconds(),
      );
      interruptionStartedAtRef.current = null;
    }
    softInterruptionReasonRef.current = null;
    shouldAutoResumeAfterInterruptionRef.current = false;
    recoveryProbeInFlightRef.current = false;
    recoveryFailuresRef.current = 0;
    clearStallTimer();
    clearRecoveryTimer();
  }, [clearRecoveryTimer, clearStallTimer, onPlaybackStallEnded]);

  const settleAfterAppLifecycle = useCallback(() => {
    // Returning from background should be inert: keep the current
    // track/queue, but do not probe or auto-restart streams. Native
    // background playback can keep going; if it did not, the next
    // playback attempt should be user-driven.
    softInterruptionReasonRef.current = null;
    shouldAutoResumeAfterInterruptionRef.current = false;
    recoveryProbeInFlightRef.current = false;
    recoveryFailuresRef.current = 0;
    interruptionStartedAtRef.current = null;
    bufferingIntentRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
    if (isBufferingRef.current) {
      commitIsBuffering(false);
    }
  }, [
    bufferingIntentRef,
    clearRecoveryTimer,
    clearStallTimer,
    commitIsBuffering,
    isBufferingRef,
  ]);

  const requireUserGestureToResume = useCallback(() => {
    if (!currentTrackRef.current) return;
    softInterruptionReasonRef.current = "stream";
    shouldAutoResumeAfterInterruptionRef.current = false;
    recoveryProbeInFlightRef.current = false;
    recoveryFailuresRef.current = 0;
    interruptionStartedAtRef.current = null;
    bufferingIntentRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
    commitIsPlaying(false);
    commitIsBuffering(false);
    window.dispatchEvent(new CustomEvent(PLAYBACK_NEEDS_USER_GESTURE_EVENT));
  }, [
    bufferingIntentRef,
    clearRecoveryTimer,
    clearStallTimer,
    commitIsBuffering,
    commitIsPlaying,
    currentTrackRef,
  ]);

  const scheduleStallProtection = useCallback(() => {
    clearStallTimer();
    if (
      bufferingIntentRef.current ||
      !isPlayingRef.current ||
      softInterruptionReasonRef.current
    )
      return;
    stallTimerRef.current = window.setTimeout(() => {
      if (
        bufferingIntentRef.current ||
        !isPlayingRef.current ||
        softInterruptionReasonRef.current
      )
        return;
      const bufferedAhead = getCurrentBufferedAheadSeconds();
      if (bufferedAhead >= BUFFERED_AHEAD_SAFE_SECONDS) return;
      if (bufferedAhead > BUFFERED_AHEAD_CRITICAL_SECONDS) {
        scheduleStallProtectionRef.current();
        return;
      }
      void isRuntimeOnline().then((online) => {
        beginSoftInterruption(online ? "stream" : "offline");
      });
    }, STREAM_STALL_GRACE_MS);
  }, [
    beginSoftInterruption,
    bufferingIntentRef,
    clearStallTimer,
    isPlayingRef,
  ]);

  useLayoutEffect(() => {
    scheduleStallProtectionRef.current = scheduleStallProtection;
    maybeResumeRef.current = async () => {
      if (!shouldAutoResumeAfterInterruptionRef.current) return;
      if (!currentTrackRef.current || recoveryProbeInFlightRef.current) return;
      recoveryProbeInFlightRef.current = true;
      commitIsBuffering(true);
      try {
        const available = await probeTrackAvailability(currentTrackRef.current);
        if (!available) {
          recoveryFailuresRef.current += 1;
          if (
            recoveryFailuresRef.current >= 2 &&
            recoveryFailuresRef.current <= 3 &&
            recoverCurrentTrack
          ) {
            const refreshed = await recoverCurrentTrack();
            if (refreshed) {
              onPlaybackRecovered?.(recoveryFailuresRef.current);
              return;
            }
          }
          if (recoveryFailuresRef.current > 3) {
            shouldAutoResumeAfterInterruptionRef.current = false;
            bufferingIntentRef.current = false;
            commitIsPlaying(false);
            commitIsBuffering(false);
            window.dispatchEvent(
              new CustomEvent(PLAYBACK_NEEDS_USER_GESTURE_EVENT),
            );
            return;
          }
          scheduleRecoveryCheck();
          return;
        }
        bufferingIntentRef.current = true;
        if (shouldUseAndroidNativePlayer()) {
          await androidNativeEngine.play();
        } else {
          await gpFadeInAndPlay(SOFT_PAUSE_FADE_MS);
        }
      } catch {
        // Fade failed — restore volume and schedule another recovery
        // attempt so we don't sit on muted audio indefinitely.
        recoveryFailuresRef.current += 1;
        gpRestoreVolume();
        scheduleRecoveryCheck();
      } finally {
        recoveryProbeInFlightRef.current = false;
      }
    };
  });

  useSoftInterruptionEvents({
    beginSoftInterruption,
    currentTrackRef,
    hasSafeBufferedAhead,
    isBufferingRef,
    isPlayingRef,
    scheduleRecoveryCheck,
    settleAfterAppLifecycle,
  });

  // Cleanup timers on unmount.
  useEffect(
    () => () => {
      clearStallTimer();
      clearRecoveryTimer();
    },
    [clearRecoveryTimer, clearStallTimer],
  );

  const isSoftInterrupted = useCallback(
    () => softInterruptionReasonRef.current !== null,
    [],
  );

  return {
    beginSoftInterruption,
    cancelSoftInterruption,
    requireUserGestureToResume,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  };
}
