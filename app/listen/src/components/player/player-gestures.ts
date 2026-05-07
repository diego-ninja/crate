export type PlayerSwipeAction = "next" | "previous";

export const PLAYER_SWIPE_DOMINANCE_RATIO = 1.8;
export const PLAYER_SWIPE_MIN_PX = 28;
export const PLAYER_SWIPE_MAX_PX = 44;
export const PLAYER_SWIPE_VIEWPORT_RATIO = 0.08;

export function getPlayerSwipeThreshold(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return PLAYER_SWIPE_MIN_PX;
  }
  return Math.max(
    PLAYER_SWIPE_MIN_PX,
    Math.min(PLAYER_SWIPE_MAX_PX, viewportWidth * PLAYER_SWIPE_VIEWPORT_RATIO),
  );
}

export function getHorizontalPlayerSwipeAction({
  deltaX,
  deltaY,
  viewportWidth,
}: {
  deltaX: number;
  deltaY: number;
  viewportWidth: number;
}): PlayerSwipeAction | null {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX <= getPlayerSwipeThreshold(viewportWidth)) return null;
  if (absX <= absY * PLAYER_SWIPE_DOMINANCE_RATIO) return null;
  return deltaX < 0 ? "next" : "previous";
}
