import { useRef, useCallback, useState } from "react";

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const startY = useRef(0);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const threshold = 80;

  const handlers = {
    onTouchStart: useCallback((e: React.TouchEvent) => {
      const el = e.currentTarget;
      if (el.scrollTop > 0 || window.scrollY > 0) return;
      startY.current = e.touches[0]!.clientY;
      setPulling(true);
    }, []),

    onTouchMove: useCallback((e: React.TouchEvent) => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0]!.clientY - startY.current;
      if (dy > 0) {
        setPullDistance(Math.min(dy * 0.4, 120));
      }
    }, [pulling, refreshing]),

    onTouchEnd: useCallback(async () => {
      if (!pulling) return;
      if (pullDistance >= threshold * 0.4 && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
      setPulling(false);
      setPullDistance(0);
    }, [pulling, pullDistance, refreshing, onRefresh]),
  };

  return { handlers, pullDistance, refreshing };
}
