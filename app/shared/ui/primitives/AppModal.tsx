import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";

interface AppModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
  panelClassName?: string;
  overlayClassName?: string;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
  lockBodyScroll?: boolean;
  mobileSafeArea?: boolean;
}

interface ModalSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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

export function AppModal({
  open,
  onClose,
  children,
  maxWidthClassName = "sm:max-w-2xl",
  panelClassName,
  overlayClassName,
  closeOnOverlay = true,
  closeOnEscape = true,
  lockBodyScroll = true,
  mobileSafeArea = false,
}: AppModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscroll =
      document.documentElement.style.overscrollBehavior;
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden";
      document.body.style.overscrollBehavior = "none";
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.overscrollBehavior = "none";
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        onClose();
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (lockBodyScroll) {
        document.body.style.overflow = previousOverflow;
        document.body.style.overscrollBehavior = previousBodyOverscroll;
        document.documentElement.style.overflow = previousHtmlOverflow;
        document.documentElement.style.overscrollBehavior =
          previousHtmlOverscroll;
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOnEscape, lockBodyScroll, onClose, open]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        panel.contains(activeElement)
      ) {
        return;
      }
      const firstFocusable =
        panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panel).focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previouslyFocusedElementRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
      previouslyFocusedElementRef.current = null;
    };
  }, [open]);

  // Swipe-to-dismiss (mobile bottom sheet — drag handle only)
  const [isEntering, setIsEntering] = useState(open);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragClosing, setIsDragClosing] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const swipeYRef = useRef(0);
  const swipeStartRef = useRef<number | null>(null);
  const pointerDragIdRef = useRef<number | null>(null);
  const pendingTouchStartYRef = useRef<number | null>(null);
  const pendingTouchTargetRef = useRef<EventTarget | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const dragCloseTimerRef = useRef<number | null>(null);
  const setDragOffset = useCallback((offset: number) => {
    swipeYRef.current = offset;
    setSwipeY(offset);
  }, []);
  const getPanelHeight = useCallback(() => {
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    return height > 0 ? height : 240;
  }, []);
  const requestDragClose = useCallback(() => {
    if (isDragClosing) return;
    setIsDragging(false);
    setIsDragClosing(true);
    setDragOffset(getPanelHeight() + 24);
    dragCloseTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 180);
  }, [getPanelHeight, isDragClosing, onClose, setDragOffset]);
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

  const canStartDragFromTarget = useCallback((target: EventTarget | null) => {
    const panel = panelRef.current;
    if (!panel || !(target instanceof Node) || !panel.contains(target)) {
      return false;
    }
    if (dragHandleRef.current?.contains(target)) return true;

    const scrollable = getScrollableAncestor(target, panel);
    return !scrollable || scrollable.scrollTop <= 0;
  }, []);

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
  const onSwipeCancel = useCallback(() => {
    setIsDragging(false);
    setDragOffset(0);
    swipeStartRef.current = null;
    pointerDragIdRef.current = null;
    pendingTouchStartYRef.current = null;
    pendingTouchTargetRef.current = null;
  }, [setDragOffset]);

  const onPointerSwipeStart = useCallback(
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

  const onPointerSwipeMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerDragIdRef.current !== event.pointerId) return;
      handlePointerDragMove(event);
    },
    [handlePointerDragMove],
  );

  const onPointerSwipeEnd = useCallback(
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
  const isDismissedRef = useRef(false);
  const handleOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!closeOnOverlay) return;
      event.preventDefault();
      event.stopPropagation();
      isDismissedRef.current = true;
      onClose();
    },
    [closeOnOverlay, onClose],
  );

  const handleOverlayClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!closeOnOverlay) return;
      if (isDismissedRef.current) {
        isDismissedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [closeOnOverlay, onClose],
  );

  useEffect(() => {
    if (open) {
      setIsEntering(true);
      setIsDragging(false);
      setIsDragClosing(false);
      setDragOffset(0);
      return;
    }
  }, [open, setDragOffset]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
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
      onSwipeCancel();
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
    onSwipeCancel,
    onSwipeEnd,
    open,
    updateDrag,
  ]);

  useEffect(() => {
    return () => {
      if (dragCloseTimerRef.current != null) {
        window.clearTimeout(dragCloseTimerRef.current);
      }
    };
  }, []);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dialog"
      tabIndex={-1}
      className={cn(
        "z-app-modal fixed inset-0 flex items-end justify-center bg-surface-canvas/72 p-0 backdrop-blur-md animate-fade-in sm:items-center sm:p-6",
        overlayClassName,
      )}
      onClick={handleOverlayClick}
      onKeyDown={(event) => {
        if (event.key === "Escape" && closeOnEscape) {
          event.preventDefault();
          onClose();
        }
      }}
      onPointerDown={handleOverlayPointerDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "bg-modal-surface w-full overflow-hidden overscroll-contain rounded-t-3xl border border-border-quiet shadow-2xl sm:rounded-3xl",
          isDragClosing
            ? undefined
            : isEntering && !isDragging
              ? "animate-sheet-up sm:animate-pop-in"
              : undefined,
          mobileSafeArea
            ? "max-h-[calc(var(--listen-viewport-height)-var(--listen-safe-top)-0.75rem)] pb-[var(--listen-safe-bottom)] sm:max-h-[92vh] sm:pb-0"
            : "max-h-[92vh]",
          maxWidthClassName,
          panelClassName,
        )}
        style={{
          transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
          transition: isDragging
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          isDismissedRef.current = false;
          event.stopPropagation();
        }}
      >
        {/* Drag handle — visible on mobile only */}
        <div
          ref={dragHandleRef}
          data-mobile-sheet-drag-handle="true"
          className={cn(
            "flex justify-center sm:hidden",
            mobileSafeArea ? "touch-none pt-4 pb-3" : "touch-none pt-2 pb-1",
          )}
          onPointerDown={onPointerSwipeStart}
          onPointerMove={onPointerSwipeMove}
          onPointerUp={onPointerSwipeEnd}
          onPointerCancel={onSwipeCancel}
        >
          <div className="w-10 h-1 rounded-full bg-text-primary/20" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky top-0 z-10 border-b border-border-quiet bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModalBody({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn("overflow-y-auto overscroll-contain", className)}
    >
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  className,
  ...props
}: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky bottom-0 z-10 border-t border-border-quiet bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface ModalCloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export function ModalCloseButton({
  onClick,
  disabled = false,
  className,
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label="Close"
      className={cn(
        "flex size-10 items-center justify-center text-text-primary/55 transition-colors hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <X size={24} />
    </button>
  );
}
