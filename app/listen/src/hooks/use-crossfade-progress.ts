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
 * During a crossfade, keep the progress bar on the OUTGOING track
 * sliding linearly from `duration - crossfadeSec` toward `duration`.
 * Without this trick the bar would snap from "near end of outgoing" to
 * "0:00 of incoming" the instant Gapless fires onnext, even though the
 * outgoing is still audible. This makes the audio crossfade feel
 * coherent with the visual.
 *
 * Outside a crossfade, returns the live values unchanged.
 */
export function useCrossfadeAwareProgress(
  transition: CrossfadeTransition | null,
  liveCurrentTime: number,
  liveDuration: number,
): { displayedTime: number; displayedDuration: number } {
  const progress = useCrossfadeProgress(transition);

  if (!transition) {
    return { displayedTime: liveCurrentTime, displayedDuration: liveDuration };
  }

  const crossfadeSec = transition.durationMs / 1000;
  const outDuration = transition.outgoingDurationSeconds;
  // Map progress 0..1 → outDuration - crossfadeSec .. outDuration.
  const startTime = Math.max(0, outDuration - crossfadeSec);
  const displayedTime = startTime + progress * (outDuration - startTime);

  return {
    displayedTime,
    displayedDuration: outDuration,
  };
}
