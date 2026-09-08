import { useEffect, type MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";

interface UseSoftInterruptionEventsOptions {
  beginSoftInterruption: (reason: "offline" | "stream") => void;
  currentTrackRef: MutableRefObject<Track | undefined>;
  hasSafeBufferedAhead: () => boolean;
  isBufferingRef: MutableRefObject<boolean>;
  isPlayingRef: MutableRefObject<boolean>;
  scheduleRecoveryCheck: (delay?: number) => void;
  settleAfterAppLifecycle: () => void;
}

export function useSoftInterruptionEvents({
  beginSoftInterruption,
  currentTrackRef,
  hasSafeBufferedAhead,
  isBufferingRef,
  isPlayingRef,
  scheduleRecoveryCheck,
  settleAfterAppLifecycle,
}: UseSoftInterruptionEventsOptions) {
  useEffect(() => {
    const handleOffline = () => {
      if (!currentTrackRef.current) return;
      // Playback does not depend on the network once the track is
      // fully decoded into the WebAudio buffer (RAM). Interrupting
      // here would be actively destructive — audio keeps playing from RAM.
      if (hasSafeBufferedAhead()) return;
      if (isPlayingRef.current || isBufferingRef.current) {
        beginSoftInterruption("offline");
      }
    };
    const handleRestored = () => {
      if (!scheduleRecoveryCheck) return;
      scheduleRecoveryCheck(0);
    };
    const handleAppLifecycle = () => {
      settleAfterAppLifecycle();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        settleAfterAppLifecycle();
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleRestored);
    window.addEventListener(
      "crate:network-restored",
      handleRestored as EventListener,
    );
    window.addEventListener(
      "crate:app-paused",
      handleAppLifecycle as EventListener,
    );
    window.addEventListener(
      "crate:app-resumed",
      handleAppLifecycle as EventListener,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleRestored);
      window.removeEventListener(
        "crate:network-restored",
        handleRestored as EventListener,
      );
      window.removeEventListener(
        "crate:app-paused",
        handleAppLifecycle as EventListener,
      );
      window.removeEventListener(
        "crate:app-resumed",
        handleAppLifecycle as EventListener,
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    beginSoftInterruption,
    currentTrackRef,
    hasSafeBufferedAhead,
    isBufferingRef,
    isPlayingRef,
    scheduleRecoveryCheck,
    settleAfterAppLifecycle,
  ]);
}
