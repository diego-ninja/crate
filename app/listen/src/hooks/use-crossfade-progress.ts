import { useEffect, useState } from "react";

import type { CrossfadeTransition } from "@/contexts/PlayerContext";

/**
 * Drives a 0→1 progress value over the lifetime of a crossfade
 * transition. Returns 1 (fully faded) if there is no transition, so
 * consumers can render incoming = `opacity: progress` and outgoing =
 * `opacity: 1 - progress` uniformly.
 *
 * Uses requestAnimationFrame so the fade is smooth regardless of the
 * React render cadence.
 */
export function useCrossfadeProgress(transition: CrossfadeTransition | null): number {
  const [progress, setProgress] = useState(transition ? 0 : 1);

  useEffect(() => {
    if (!transition) {
      setProgress(1);
      return;
    }
    setProgress(0);

    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - transition.startedAt;
      const p = Math.max(0, Math.min(1, elapsed / transition.durationMs));
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transition]);

  return progress;
}

/**
 * The player UI still crossfades artwork/title, but the seek bar and
 * time labels should always reflect the currently active track. The old
 * "show the tail of the outgoing song" trick made sense when progress
 * was visually fused with the crossfade treatment, but it becomes
 * confusing with a normal seek bar because the incoming track appears to
 * start near its end and then jump backwards.
 */
export function getCrossfadeAwareProgress(
  _transition: CrossfadeTransition | null,
  liveCurrentTime: number,
  liveDuration: number,
): { displayedTime: number; displayedDuration: number } {
  return {
    displayedTime: liveCurrentTime,
    displayedDuration: liveDuration,
  };
}

export function useCrossfadeAwareProgress(
  transition: CrossfadeTransition | null,
  liveCurrentTime: number,
  liveDuration: number,
): { displayedTime: number; displayedDuration: number } {
  // Keep the same internal hook shape as before so Fast Refresh does
  // not see a different hook order in PlayerBar / FullscreenPlayer when
  // this helper changes behavior.
  useCrossfadeProgress(transition);
  return getCrossfadeAwareProgress(transition, liveCurrentTime, liveDuration);
}
