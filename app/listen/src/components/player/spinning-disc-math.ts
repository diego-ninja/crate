export const DISC_DEGREES_PER_SECOND = 120;
export const JOG_SECONDS_PER_ROTATION = 2.5;
export const JOG_SEEK_INTERVAL_MS = 110;
export const JOG_RATE_UPDATE_INTERVAL_MS = 70;
export const PLAYING_FORWARD_SYNC_TOLERANCE_SECONDS = 0.65;
export const PLAYING_BACKWARD_SYNC_TOLERANCE_SECONDS = 1.6;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getPointerAngle(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  bounds: DOMRect,
): number {
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return (
    Math.atan2(event.clientY - centerY, event.clientX - centerX) *
    (180 / Math.PI)
  );
}

export function normalizeDeltaDegrees(delta: number): number {
  if (delta > 180) return delta - 360;
  if (delta < -180) return delta + 360;
  return delta;
}

export function projectPlaybackTime({
  anchorTime,
  anchorTimestamp,
  duration,
  isBuffering,
  isPlaying,
  timestamp,
}: {
  anchorTime: number;
  anchorTimestamp: number;
  duration: number;
  isBuffering: boolean;
  isPlaying: boolean;
  timestamp: number;
}): number {
  if (!isPlaying || isBuffering) return anchorTime;
  const elapsedSeconds = Math.max(0, (timestamp - anchorTimestamp) / 1000);
  const projected = anchorTime + elapsedSeconds;
  return duration > 0 ? Math.min(projected, duration) : projected;
}

export function getJogTime({
  accumDegrees,
  duration,
  startTime,
}: {
  accumDegrees: number;
  duration: number;
  startTime: number;
}): number {
  return clamp(
    startTime + (accumDegrees / 360) * JOG_SECONDS_PER_ROTATION,
    0,
    duration,
  );
}
