import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@crate/ui/lib/cn";

import type { MobileActionSheetProps } from "./types";

const SHEET_DRAG_ACTIVATION_PX = 8;

function getTouchClientY(event: TouchEvent): number | null {
  return event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? null;
}

function getScrollableAncestor(
  target: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement | null {
  if (!(target instanceof Node)) return null;

  let node: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;

  while (node && node !== boundary) {
    const style = window.getComputedStyle(node);
    const canScrollY =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight;

    if (canScrollY) return node;
    node = node.parentElement;
  }

  return null;
}

export function MobileActionSheet({
  children,
  panelRef,
  onClose,
  open,
  className,
}: MobileActionSheetProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const [isEntering, setIsEntering] = useState(open);
  const [isDragging, setIsDragging] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const internalPanelRef = useRef<HTMLDivElement>(null);
  const resolvedPanelRef = panelRef ?? internalPanelRef;
  const swipeYRef = useRef(0);
  const swipeStartRef = useRef<number | null>(null);
  const pointerDragIdRef = useRef<number | null>(null);
  const pendingTouchStartYRef = useRef<number | null>(null);
  const pendingTouchTargetRef = useRef<EventTarget | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const closeScheduledRef = useRef(false);
  const isDismissedRef = useRef(false);
  const shouldSuppressNextClickRef = useRef(false);
  const isMountedRef = useRef(true);

  const isPanelTarget = useCallback(
    (target: EventTarget | null) => {
      if (target == null) return false;
      const node = target as Node;
      return resolvedPanelRef.current
        ? resolvedPanelRef.current.contains(node)
        : false;
    },
    [resolvedPanelRef],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsClosing(false);
      setIsEntering(true);
      setIsDragging(false);
      setSwipeY(0);
      swipeYRef.current = 0;
      closeScheduledRef.current = false;
      return;
    }

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!shouldRender) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior =
        previousHtmlOverscroll;
    };
  }, [shouldRender]);

  const setDragOffset = useCallback((offset: number) => {
    swipeYRef.current = offset;
    setSwipeY(offset);
  }, []);

  const getPanelHeight = useCallback(() => {
    const height =
      resolvedPanelRef.current?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : 240;
  }, [resolvedPanelRef]);

  const requestClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsClosing(true);
    setIsDragging(false);
    setDragOffset(0);
    shouldSuppressNextClickRef.current = true;
    window.setTimeout(() => {
      if (isMountedRef.current) {
        closeScheduledRef.current = false;
        onClose();
      }
    }, 140);
  }, [isClosing, onClose, setDragOffset]);

  const requestDragClose = useCallback(() => {
    if (isClosing || closeScheduledRef.current) return;
    closeScheduledRef.current = true;
    setIsDragging(false);
    setIsClosing(true);
    setDragOffset(getPanelHeight() + 24);
    shouldSuppressNextClickRef.current = true;
    window.setTimeout(() => {
      if (isMountedRef.current) {
        closeScheduledRef.current = false;
        onClose();
      }
    }, 180);
  }, [getPanelHeight, isClosing, onClose, setDragOffset]);

  const suppressAndRequestClose = useCallback(() => {
    shouldSuppressNextClickRef.current = true;
    isDismissedRef.current = true;
    requestClose();
  }, [requestClose]);

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      if (isDismissedRef.current || shouldSuppressNextClickRef.current) {
        isDismissedRef.current = false;
        shouldSuppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [isPanelTarget, suppressAndRequestClose],
  );

  const beginDrag = useCallback(
    (clientY: number) => {
      swipeStartRef.current = clientY;
      setIsEntering(false);
      setIsDragging(true);
      setDragOffset(0);
    },
    [setDragOffset],
  );

  const updateDrag = useCallback(
    (clientY: number) => {
      if (swipeStartRef.current === null) return;
      const dy = clientY - swipeStartRef.current;
      setDragOffset(dy > 0 ? Math.min(dy, getPanelHeight() + 24) : 0);
    },
    [getPanelHeight, setDragOffset],
  );

  const canStartDragFromTarget = useCallback(
    (target: EventTarget | null) => {
      const panel = resolvedPanelRef.current;
      if (!panel || !(target instanceof Node) || !panel.contains(target)) {
        return false;
      }
      if (dragHandleRef.current?.contains(target)) return true;

      const scrollable = getScrollableAncestor(target, panel);
      return !scrollable || scrollable.scrollTop <= 0;
    },
    [resolvedPanelRef],
  );

  const handlePointerDragMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (swipeStartRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      updateDrag(event.clientY);
    },
    [updateDrag],
  );

  const onSwipeEnd = useCallback(() => {
    if (swipeStartRef.current === null) return;
    const shouldDismiss = swipeYRef.current >= getPanelHeight() / 2;
    swipeStartRef.current = null;
    if (shouldDismiss) {
      requestDragClose();
      return;
    }
    setIsDragging(false);
    setDragOffset(0);
  }, [getPanelHeight, requestDragClose, setDragOffset]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPanelTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressAndRequestClose();
    },
    [isPanelTarget, suppressAndRequestClose],
  );

  const handleContentTouchCancel = useCallback(() => {
    setIsDragging(false);
    setDragOffset(0);
    swipeStartRef.current = null;
    pointerDragIdRef.current = null;
    pendingTouchStartYRef.current = null;
    pendingTouchTargetRef.current = null;
  }, [setDragOffset]);

  const handlePanelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointerDragIdRef.current = event.pointerId;
      beginDrag(event.clientY);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [beginDrag],
  );

  const handlePanelPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerDragIdRef.current !== event.pointerId) return;
      handlePointerDragMove(event);
    },
    [handlePointerDragMove],
  );

  const handlePanelPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerDragIdRef.current !== event.pointerId) return;
      pointerDragIdRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onSwipeEnd();
    },
    [onSwipeEnd],
  );

  useEffect(() => {
    if (!shouldRender) return;
    const panel = resolvedPanelRef.current;
    if (!panel) return;

    const handleNativeTouchStart = (event: TouchEvent) => {
      const clientY = getTouchClientY(event);
      if (clientY === null) return;
      pendingTouchStartYRef.current = clientY;
      pendingTouchTargetRef.current = event.target;
    };

    const handleNativeTouchMove = (event: TouchEvent) => {
      const startY = pendingTouchStartYRef.current;
      if (startY === null) return;

      const clientY = getTouchClientY(event);
      if (clientY === null) return;

      const dy = clientY - startY;
      if (swipeStartRef.current === null) {
        if (dy <= SHEET_DRAG_ACTIVATION_PX) return;
        if (!canStartDragFromTarget(pendingTouchTargetRef.current)) return;
        beginDrag(startY);
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();
      updateDrag(clientY);
    };

    const handleNativeTouchEnd = () => {
      pendingTouchStartYRef.current = null;
      pendingTouchTargetRef.current = null;
      if (swipeStartRef.current !== null) {
        onSwipeEnd();
      }
    };

    const handleNativeTouchCancel = () => {
      pendingTouchStartYRef.current = null;
      pendingTouchTargetRef.current = null;
      handleContentTouchCancel();
    };

    panel.addEventListener("touchstart", handleNativeTouchStart, {
      passive: true,
    });
    panel.addEventListener("touchmove", handleNativeTouchMove, {
      passive: false,
    });
    panel.addEventListener("touchend", handleNativeTouchEnd);
    panel.addEventListener("touchcancel", handleNativeTouchCancel);

    return () => {
      panel.removeEventListener("touchstart", handleNativeTouchStart);
      panel.removeEventListener("touchmove", handleNativeTouchMove);
      panel.removeEventListener("touchend", handleNativeTouchEnd);
      panel.removeEventListener("touchcancel", handleNativeTouchCancel);
    };
  }, [
    beginDrag,
    canStartDragFromTarget,
    handleContentTouchCancel,
    onSwipeEnd,
    resolvedPanelRef,
    shouldRender,
    updateDrag,
  ]);

  if (!shouldRender) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Action sheet"
      tabIndex={-1}
      className={cn(
        "fixed inset-0 flex items-end justify-center bg-surface-canvas/58 p-0 backdrop-blur-md z-app-modal",
        isClosing ? "animate-fade-out" : "animate-fade-in",
      )}
      onClickCapture={handleOverlayClick}
      onPointerDownCapture={handlePointerDown}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        suppressAndRequestClose();
      }}
      onTouchEnd={(event) => {
        if (isPanelTarget(event.target)) return;
        setIsDragging(false);
        setDragOffset(0);
        swipeStartRef.current = null;
      }}
    >
      <div
        ref={resolvedPanelRef}
        className={cn(
          "listen-glass-panel fixed inset-x-0 overflow-hidden overscroll-contain rounded-t-3xl border border-border-quiet shadow-2xl",
          isClosing && swipeY === 0
            ? "animate-sheet-down"
            : isEntering && !isDragging
              ? "animate-sheet-up"
              : undefined,
          className,
        )}
        style={{
          top: "auto",
          left: 0,
          right: 0,
          bottom: "0px",
          maxHeight:
            "min(88vh, max(14rem, calc(var(--listen-viewport-height, 100dvh) - var(--listen-safe-top, env(safe-area-inset-top, 0px)) - 0.75rem)))",
          paddingBottom:
            "var(--listen-safe-bottom, env(safe-area-inset-bottom, 0px))",
          transform: swipeY ? `translateY(${swipeY}px)` : undefined,
          transition: isDragging
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          ref={dragHandleRef}
          data-mobile-sheet-drag-handle="true"
          className="touch-none pt-3 pb-2"
          onPointerDown={handlePanelPointerDown}
          onPointerMove={handlePanelPointerMove}
          onPointerUp={handlePanelPointerEnd}
          onPointerCancel={handleContentTouchCancel}
        >
          <div className="mx-auto h-1.25 w-14 rounded-full bg-text-primary/22 transition-opacity duration-150 group-hover:opacity-90" />
        </div>
        <div className="max-h-[inherit] overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
