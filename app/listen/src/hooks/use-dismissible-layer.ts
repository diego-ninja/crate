import { useEffect, type RefObject } from "react";

type LayerRef = RefObject<HTMLElement | null>;

interface UseDismissibleLayerOptions {
  active: boolean;
  refs: LayerRef[];
  onDismiss: () => void;
  closeOnEscape?: boolean;
  closeOnPointerDownOutside?: boolean;
}

export function useDismissibleLayer({
  active,
  refs,
  onDismiss,
  closeOnEscape = true,
  closeOnPointerDownOutside = true,
}: UseDismissibleLayerOptions) {
  useEffect(() => {
    if (!active) return;

    const isInside = (target: Node | null) =>
      refs.some((ref) => ref.current && target && ref.current.contains(target));

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!closeOnPointerDownOutside) return;
      if (isInside(event.target as Node | null)) return;
      onDismiss();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, closeOnEscape, closeOnPointerDownOutside, onDismiss, refs]);
}
