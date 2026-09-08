import { useCallback, useEffect, useRef, useState } from "react";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";
import type { FSPanel } from "@/components/player/fullscreen-player-types";
import { triggerHaptic } from "@/lib/haptics";

type UseFullscreenPlayerGesturesOptions = {
  activePanel: FSPanel | null;
  goNextWithFeedback: () => void;
  goPrevWithFeedback: () => void;
  onClose: () => void;
};

export function useFullscreenPlayerGestures({
  activePanel,
  goNextWithFeedback,
  goPrevWithFeedback,
  onClose,
}: UseFullscreenPlayerGesturesOptions) {
  const [swipeY, setSwipeY] = useState(0);
  const swipeStartRef = useRef<number | null>(null);
  const horizontalSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeYRef = useRef(0);
  const swipeFrameRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  useEffect(
    () => () => {
      if (swipeFrameRef.current != null) {
        window.cancelAnimationFrame(swipeFrameRef.current);
      }
    },
    [],
  );

  const scheduleSwipeY = useCallback((nextY: number) => {
    swipeYRef.current = nextY;
    if (swipeFrameRef.current != null) return;
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null;
      setSwipeY(swipeYRef.current);
    });
  }, []);

  const onSwipeStart = useCallback(
    (event: React.TouchEvent) => {
      if (draggingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const startX = touch.clientX;
      const startY = touch.clientY;
      const element = (
        event.currentTarget as HTMLElement
      ).getBoundingClientRect();
      horizontalSwipeStartRef.current =
        activePanel === null ? { x: startX, y: startY } : null;
      if (startY - element.top > Math.min(260, element.height * 0.35)) return;
      swipeStartRef.current = startY;
    },
    [activePanel],
  );

  const onSwipeMove = useCallback(
    (event: React.TouchEvent) => {
      if (swipeStartRef.current === null || draggingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - swipeStartRef.current;
      scheduleSwipeY(deltaY > 0 ? Math.min(deltaY * 0.6, 300) : 0);
    },
    [scheduleSwipeY],
  );

  const onSwipeEnd = useCallback(
    (event: React.TouchEvent) => {
      const horizontalStart = horizontalSwipeStartRef.current;
      horizontalSwipeStartRef.current = null;

      if (horizontalStart && activePanel === null && !draggingRef.current) {
        const touch = event.changedTouches[0];
        if (touch) {
          const action = getHorizontalPlayerSwipeAction({
            deltaX: touch.clientX - horizontalStart.x,
            deltaY: touch.clientY - horizontalStart.y,
            viewportWidth: window.innerWidth,
          });
          if (action) {
            if (action === "next") {
              goNextWithFeedback();
            } else {
              goPrevWithFeedback();
            }
            scheduleSwipeY(0);
            swipeStartRef.current = null;
            return;
          }
        }
      }

      if (swipeYRef.current > 100) {
        triggerHaptic("selection");
        onClose();
      }
      scheduleSwipeY(0);
      swipeStartRef.current = null;
    },
    [
      activePanel,
      goNextWithFeedback,
      goPrevWithFeedback,
      onClose,
      scheduleSwipeY,
    ],
  );

  return {
    draggingRef,
    onSwipeEnd,
    onSwipeMove,
    onSwipeStart,
    setSwipeY,
    swipeY,
    swipeYRef,
  };
}
