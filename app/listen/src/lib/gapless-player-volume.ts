type VolumeSink = (volume: number) => void;

let volumeSink: VolumeSink | null = null;
let lastVolume = 1.0;
let appliedVolume = 1.0;
let fadeFrame: number | null = null;
let fadeSettle: (() => void) | null = null;

export function setVolumeSink(sink: VolumeSink | null): void {
  volumeSink = sink;
  if (sink) {
    appliedVolume = lastVolume;
  }
}

export function getLastVolume(): number {
  return lastVolume;
}

export function getAppliedVolume(): number {
  return appliedVolume;
}

export function setLastVolume(volume: number): void {
  lastVolume = volume;
}

export function stopFade(): void {
  if (fadeFrame != null) {
    cancelAnimationFrame(fadeFrame);
    fadeFrame = null;
  }
  // Settle any pending fade promise from the previous animation so
  // awaiters of fadeInAndPlay / fadeOutAndPause never hang.
  if (fadeSettle) {
    const settle = fadeSettle;
    fadeSettle = null;
    settle();
  }
}

export function applyVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(volume, 1));
  appliedVolume = clamped;
  volumeSink?.(clamped);
}

export function animateVolume(
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
): void {
  stopFade();
  const start = performance.now();
  const safeDuration = Math.max(0, durationMs);
  if (safeDuration === 0) {
    applyVolume(to);
    onDone?.();
    return;
  }

  // Register onDone as the fade settler. It will be called either on
  // completion (progress >= 1) or on cancellation (stopFade).
  fadeSettle = onDone ?? null;

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / safeDuration);
    applyVolume(from + (to - from) * progress);
    if (progress >= 1) {
      fadeFrame = null;
      const settle = fadeSettle;
      fadeSettle = null;
      settle?.();
      return;
    }
    fadeFrame = requestAnimationFrame(tick);
  };

  fadeFrame = requestAnimationFrame(tick);
}
