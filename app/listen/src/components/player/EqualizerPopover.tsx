import { useRef } from "react";

import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
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
  const panelRef = useRef<HTMLDialogElement>(null);

  useDismissibleLayer({
    active: open,
    refs: [panelRef],
    onDismiss: onClose,
  });

  if (!open) return null;

  return (
    <dialog
      open
      ref={panelRef}
      aria-label="Equalizer"
      className="z-app-player-drawer fixed bottom-[calc(var(--listen-mobile-bottom-chrome-height)+0.75rem)] right-3 w-[min(calc(100vw-1.5rem),560px)] animate-fade-in rounded-[12px] border border-border-quiet bg-surface-overlay p-4 shadow-menu backdrop-blur-2xl md:bottom-[92px]"
    >
      <EqualizerPanel onClose={onClose} />
    </dialog>
  );
}
