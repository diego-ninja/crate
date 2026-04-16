import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

import { getStreamUrl } from "@/contexts/player-utils";
import type { Track } from "@/contexts/player-types";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  isCurrentTrackFullyBuffered,
  pause as gpPause,
  restoreVolume as gpRestoreVolume,
} from "@/lib/gapless-player";

const STREAM_STALL_GRACE_MS = 2500;
const RECOVERY_RETRY_MS = 3000;
const STREAM_PROBE_TIMEOUT_MS = 4000;
const SOFT_PAUSE_FADE_MS = 220;

interface UseSoftInterruptionOptions {
  currentTrackRef: MutableRefObject<Track | undefined>;
  isPlayingRef: MutableRefObject<boolean>;
  isBufferingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  commitIsBuffering: (value: boolean) => void;
}

export interface SoftInterruptionController {
  beginSoftInterruption: (reason: "offline" | "stream") => void;
  cancelSoftInterruption: () => void;
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
 *   - periodic HEAD probe on the stream URL
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
  commitIsBuffering,
}: UseSoftInterruptionOptions): SoftInterruptionController {
  const softInterruptionReasonRef = useRef<"offline" | "stream" | null>(null);
  const shouldAutoResumeAfterInterruptionRef = useRef(false);
  const stallTimerRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const recoveryProbeInFlightRef = useRef(false);
  // Forward-declared so callbacks can reach the latest implementation.
  const maybeResumeRef = useRef<() => Promise<void>>(async () => {});

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

  const probeCurrentTrackAvailability = useCallback(async (): Promise<boolean> => {
    const track = currentTrackRef.current;
    if (!track) return false;

    const online = await isRuntimeOnline();
    if (!online) return false;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), STREAM_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(getStreamUrl(track), {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      response.body?.cancel().catch(() => {});
      return response.ok || response.status === 206;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [currentTrackRef]);

  const scheduleRecoveryCheck = useCallback((delay: number = RECOVERY_RETRY_MS) => {
    clearRecoveryTimer();
    if (!shouldAutoResumeAfterInterruptionRef.current) return;
    recoveryTimerRef.current = window.setTimeout(() => {
      void maybeResumeRef.current();
    }, delay);
  }, [clearRecoveryTimer]);

  const beginSoftInterruption = useCallback((reason: "offline" | "stream") => {
    if (!currentTrackRef.current) return;
    // The audio is already in RAM — no network dependency. Interrupting
    // would pause a perfectly-playing track. Defensive guard so every
    // caller (offline event, error, stall timer) is consistent.
    if (isCurrentTrackFullyBuffered()) return;
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
    recoveryProbeInFlightRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
    bufferingIntentRef.current = false;
    commitIsBuffering(true);

    if (isPlayingRef.current) {
      void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {});
    } else {
      gpPause();
    }

    scheduleRecoveryCheck(reason === "offline" ? 0 : RECOVERY_RETRY_MS);
  }, [
    bufferingIntentRef,
    clearRecoveryTimer,
    clearStallTimer,
    commitIsBuffering,
    currentTrackRef,
    isPlayingRef,
    scheduleRecoveryCheck,
  ]);

  const cancelSoftInterruption = useCallback(() => {
    softInterruptionReasonRef.current = null;
    shouldAutoResumeAfterInterruptionRef.current = false;
    recoveryProbeInFlightRef.current = false;
    clearStallTimer();
    clearRecoveryTimer();
  }, [clearRecoveryTimer, clearStallTimer]);

  const scheduleStallProtection = useCallback(() => {
    clearStallTimer();
    if (bufferingIntentRef.current || !isPlayingRef.current || softInterruptionReasonRef.current) return;
    stallTimerRef.current = window.setTimeout(() => {
      if (bufferingIntentRef.current || !isPlayingRef.current || softInterruptionReasonRef.current) return;
      void isRuntimeOnline().then((online) => {
        beginSoftInterruption(online ? "stream" : "offline");
      });
    }, STREAM_STALL_GRACE_MS);
  }, [beginSoftInterruption, bufferingIntentRef, clearStallTimer, isPlayingRef]);

  maybeResumeRef.current = async () => {
    if (!shouldAutoResumeAfterInterruptionRef.current) return;
    if (!currentTrackRef.current || recoveryProbeInFlightRef.current) return;
    recoveryProbeInFlightRef.current = true;
    commitIsBuffering(true);
    try {
      const available = await probeCurrentTrackAvailability();
      if (!available) {
        scheduleRecoveryCheck();
        return;
      }
      bufferingIntentRef.current = true;
      await gpFadeInAndPlay(SOFT_PAUSE_FADE_MS);
    } catch {
      // Fade failed — restore volume and schedule another recovery
      // attempt so we don't sit on muted audio indefinitely.
      gpRestoreVolume();
      scheduleRecoveryCheck();
    } finally {
      recoveryProbeInFlightRef.current = false;
    }
  };

  // Listen to browser online/offline + app-level network-restored events.
  useEffect(() => {
    const handleOffline = () => {
      if (!currentTrackRef.current) return;
      // Playback does not depend on the network once the track is
      // fully decoded into the WebAudio buffer (RAM). Interrupting
      // here would be actively destructive — the user would hear
      // silence for a track that would otherwise play to the end.
      // Let it play; we'll re-check on actual stall events.
      if (isCurrentTrackFullyBuffered()) return;
      if (isPlayingRef.current || isBufferingRef.current) {
        beginSoftInterruption("offline");
      }
    };
    const handleRestored = () => {
      if (!shouldAutoResumeAfterInterruptionRef.current) return;
      scheduleRecoveryCheck(0);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleRestored);
    window.addEventListener("crate:network-restored", handleRestored as EventListener);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleRestored);
      window.removeEventListener("crate:network-restored", handleRestored as EventListener);
    };
  }, [beginSoftInterruption, currentTrackRef, isBufferingRef, isPlayingRef, scheduleRecoveryCheck]);

  // Cleanup timers on unmount.
  useEffect(() => () => {
    clearStallTimer();
    clearRecoveryTimer();
  }, [clearRecoveryTimer, clearStallTimer]);

  const isSoftInterrupted = useCallback(
    () => softInterruptionReasonRef.current !== null,
    [],
  );

  return {
    beginSoftInterruption,
    cancelSoftInterruption,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  };
}
