import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

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
}

interface ModalSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
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
}: AppModalProps) {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    if (lockBodyScroll) {
      document.body.style.overflow = "hidden";
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (lockBodyScroll) {
        document.body.style.overflow = previousOverflow;
      }
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOnEscape, lockBodyScroll, onClose, open]);

  // Swipe-to-dismiss (mobile bottom sheet — drag handle only)
  const [swipeY, setSwipeY] = useState(0);
  const swipeStartRef = useRef<number | null>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    if (!dragHandleRef.current) return;
    const handleRect = dragHandleRef.current.getBoundingClientRect();
    const touchY = e.touches[0]!.clientY;
    if (touchY > handleRect.bottom + 8) return;
    swipeStartRef.current = touchY;
  }, []);
  const onSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartRef.current === null) return;
    const dy = e.touches[0]!.clientY - swipeStartRef.current;
    setSwipeY(dy > 0 ? Math.min(dy * 0.6, 300) : 0);
  }, []);
  const onSwipeEnd = useCallback(() => {
    if (swipeY > 80) onClose();
    setSwipeY(0);
    swipeStartRef.current = null;
  }, [swipeY, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        "z-app-modal fixed inset-0 flex items-end justify-center bg-black/72 p-0 backdrop-blur-md animate-fade-in sm:items-center sm:p-6",
        overlayClassName,
      )}
      onClick={() => {
        if (closeOnOverlay) onClose();
      }}
    >
      <div
        className={cn(
          "bg-modal-surface max-h-[calc(var(--listen-viewport-height)-var(--listen-safe-top)-0.75rem)] w-full overflow-hidden rounded-t-3xl border border-white/10 pb-[var(--listen-safe-bottom)] shadow-2xl animate-sheet-up sm:max-h-[92vh] sm:rounded-3xl sm:pb-0 sm:animate-pop-in",
          maxWidthClassName,
          panelClassName,
        )}
        style={{
          transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
          transition: swipeY > 0 ? "none" : undefined,
        }}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onSwipeStart}
        onTouchMove={onSwipeMove}
        onTouchEnd={onSwipeEnd}
      >
        {/* Drag handle — visible on mobile only */}
        <div ref={dragHandleRef} className="flex touch-pan-y justify-center pt-4 pb-3 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ children, className, ...props }: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky top-0 z-10 border-b border-white/10 bg-modal-surface backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ModalBody({ children, className, ...props }: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn("overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ children, className, ...props }: ModalSectionProps) {
  return (
    <div
      {...props}
      className={cn(
        "sticky bottom-0 z-10 border-t border-white/10 bg-modal-surface backdrop-blur-xl",
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

export function ModalCloseButton({ onClick, disabled = false, className }: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label="Close"
      className={cn(
        "rounded-full p-2 text-white/60 hover:text-white hover:bg-white/5 transition-colors",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <X size={18} />
    </button>
  );
}
