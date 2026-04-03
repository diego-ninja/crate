import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

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

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
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

  // Swipe-to-dismiss (mobile bottom sheet)
  const [swipeY, setSwipeY] = useState(0);
  const swipeStartRef = useRef<number | null>(null);
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    swipeStartRef.current = e.touches[0]!.clientY;
  }, []);
  const onSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartRef.current === null) return;
    setSwipeY(Math.max(0, e.touches[0]!.clientY - swipeStartRef.current));
  }, []);
  const onSwipeEnd = useCallback(() => {
    if (swipeY > 100) onClose();
    setSwipeY(0);
    swipeStartRef.current = null;
  }, [swipeY, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className={joinClasses(
        "fixed inset-0 z-[95] bg-black/72 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-6",
        overlayClassName,
      )}
      onClick={() => {
        if (closeOnOverlay) onClose();
      }}
    >
      <div
        className={joinClasses(
          "w-full max-h-[92vh] overflow-hidden rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#101018]/95 shadow-2xl",
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
        <div className="flex justify-center pt-2 pb-1 sm:hidden">
          <div className="w-8 h-1 rounded-full bg-white/20" />
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
      className={joinClasses(
        "sticky top-0 z-10 border-b border-white/10 bg-[#101018]/95 backdrop-blur-xl",
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
      className={joinClasses("overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ children, className, ...props }: ModalSectionProps) {
  return (
    <div
      {...props}
      className={joinClasses(
        "sticky bottom-0 z-10 border-t border-white/10 bg-[#101018]/95 backdrop-blur-xl",
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
      className={joinClasses(
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
