import { useState, useEffect, useCallback } from "react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  children: React.ReactNode;
}

export function ImageLightbox({ src, alt, children }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);

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
        aria-label={`Open image: ${alt}`}
        onClick={() => setOpen(true)}
        className="cursor-zoom-in border-0 bg-transparent p-0"
      >
        {children}
      </button>
      {open && (
        <button
          type="button"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          aria-label="Close image"
          className="fixed inset-0 z-app-modal flex items-center justify-center border-0 bg-black/80 p-0 animate-in fade-in duration-200"
        >
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] rounded-md object-contain animate-in zoom-in-90 duration-200"
          />
        </button>
      )}
    </>
  );
}
