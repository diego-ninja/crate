import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  children: React.ReactNode;
}

export function ImageLightbox({ src, alt, children }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  const isDismissedRef = useRef(false);
  const handleOverlayPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    isDismissedRef.current = true;
    close();
  };
  const handleOverlayTouchStart = (
    event: ReactTouchEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    isDismissedRef.current = true;
    close();
  };

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        aria-label={`Open ${alt}`}
        onClick={() => setOpen(true)}
        className="block cursor-zoom-in border-0 bg-transparent p-0 text-left"
      >
        {children}
      </button>
      {open && (
        <button
          type="button"
          aria-label="Close image"
          onPointerDown={handleOverlayPointerDown}
          onTouchStart={handleOverlayTouchStart}
          onClick={(event) => {
            if (isDismissedRef.current) {
              isDismissedRef.current = false;
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            close();
          }}
          className="fixed inset-0 z-app-modal flex items-center justify-center border-0 bg-surface-canvas/80 p-0 animate-in fade-in duration-200"
        >
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] rounded-md object-contain animate-in zoom-in-90 duration-200"
          />
        </button>
      )}
    </>
  );
}
