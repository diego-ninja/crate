import { useEffect, useRef } from "react";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";

interface EqualizerPopoverProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Floating equalizer panel anchored bottom-right of the viewport.
 * Sits above the player bar (z-app-player-drawer tier), closes on
 * click outside, Escape, or the X inside the panel header.
 */
export function EqualizerPopover({ open, onClose }: EqualizerPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes, click-outside closes.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKey);
    // Defer the pointerdown listener to the next tick so the same click
    // that opened the popover doesn't immediately close it.
    const timer = window.setTimeout(
      () => window.addEventListener("pointerdown", onPointerDown, true),
      0,
    );

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Equalizer"
      className="z-app-player-drawer fixed bottom-[92px] right-3 w-[clamp(320px,90vw,560px)] animate-fade-in rounded-2xl border border-white/10 bg-black/80 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
    >
      <EqualizerPanel variant="compact" onClose={onClose} />
    </div>
  );
}
