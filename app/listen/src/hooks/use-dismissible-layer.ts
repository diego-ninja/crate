import { useEffect, useEffectEvent, type RefObject } from "react";

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
  const dismiss = useEffectEvent(onDismiss);
  const isInside = useEffectEvent((target: Node | null) =>
    refs.some((ref) => ref.current && target && ref.current.contains(target)),
  );

  useEffect(() => {
    if (!active) return;
    let suppressClick = false;
    let suppressClickTimer: number | undefined;

    const stopOutsideEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnPointerDownOutside) return;
      if (isInside(event.target as Node | null)) return;
      suppressClick = true;
      if (suppressClickTimer) window.clearTimeout(suppressClickTimer);
      suppressClickTimer = window.setTimeout(() => {
        suppressClick = false;
        suppressClickTimer = undefined;
      }, 400);
      stopOutsideEvent(event);
      dismiss();
    };

    const handleClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      if (suppressClickTimer) {
        window.clearTimeout(suppressClickTimer);
        suppressClickTimer = undefined;
      }
      stopOutsideEvent(event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (suppressClickTimer) window.clearTimeout(suppressClickTimer);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, closeOnEscape, closeOnPointerDownOutside]);
}
