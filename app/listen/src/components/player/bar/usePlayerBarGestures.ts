import { useCallback, useRef } from "react";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";

type UsePlayerBarGesturesOptions = {
  onNextTrack: () => void;
  onPreviousTrack: () => void;
};

export function usePlayerBarGestures({
  onNextTrack,
  onPreviousTrack,
}: UsePlayerBarGesturesOptions) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const action = getHorizontalPlayerSwipeAction({
        deltaX: touch.clientX - touchStartX.current,
        deltaY: touch.clientY - touchStartY.current,
        viewportWidth: window.innerWidth,
      });
      if (action === "next") {
        onNextTrack();
      } else if (action === "previous") {
        onPreviousTrack();
      }
    },
    [onNextTrack, onPreviousTrack],
  );

  return { handleTouchEnd, handleTouchStart };
}
