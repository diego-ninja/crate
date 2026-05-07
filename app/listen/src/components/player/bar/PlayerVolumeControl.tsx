import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX } from "lucide-react";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

interface PlayerVolumeControlProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  onOverlayChange: (open: boolean) => void;
}

export function PlayerVolumeControl({
  volume,
  onVolumeChange,
  onOverlayChange,
}: PlayerVolumeControlProps) {
  const [showVolume, setShowVolume] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; bottom: number } | null>(null);
  const canUseWheel = useHoverCapability();
  const trackRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const volumeIconRef = useRef<HTMLSpanElement>(null);
  const volumePct = Math.max(0, Math.min(100, volume * 100));

  const updatePopoverPosition = useCallback(() => {
    const button = volumeButtonRef.current;
    const icon = volumeIconRef.current;
    if (!button) return;
    const buttonRect = button.getBoundingClientRect();
    const anchorRect = icon?.getBoundingClientRect() ?? buttonRect;
    const popoverWidth = 40;
    const desiredLeft = anchorRect.left + anchorRect.width / 2;
    setPopoverPosition({
      left: Math.max(popoverWidth / 2 + 6, Math.min(window.innerWidth - popoverWidth / 2 - 6, desiredLeft)),
      bottom: window.innerHeight - buttonRect.top + 8,
    });
  }, []);

  const closeVolume = () => {
    setShowVolume(false);
    setPopoverPosition(null);
    onOverlayChange(false);
  };

  useDismissibleLayer({
    active: showVolume,
    refs: [volumeRef, volumeButtonRef],
    onDismiss: closeVolume,
  });

  useEffect(() => {
    if (!showVolume) return;
    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [showVolume, updatePopoverPosition]);

  const setVolumeFromClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onVolumeChange(Math.round(pct * 100) / 100);
  }, [onVolumeChange]);

  const setVolumeByDelta = useCallback((delta: number) => {
    onVolumeChange(Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100)));
  }, [onVolumeChange, volume]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (!canUseWheel) return;
    event.preventDefault();
    event.stopPropagation();
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const step = event.shiftKey ? 0.01 : 0.03;
    setVolumeByDelta(dominantDelta > 0 ? -step : step);
  }, [canUseWheel, setVolumeByDelta]);

  return (
    <div className="relative flex items-center" onWheel={handleWheel}>
      <button
        ref={volumeButtonRef}
        onClick={() => {
          const nextOpen = !showVolume;
          if (nextOpen) updatePopoverPosition();
          setShowVolume(nextOpen);
          onOverlayChange(nextOpen);
        }}
        aria-label={volume === 0 ? "Unmute" : "Volume"}
        className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
      >
        <span ref={volumeIconRef} className="block">
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </span>
      </button>
      {showVolume && popoverPosition ? createPortal(
        <AppPopover
          ref={volumeRef}
          className="fixed w-10 rounded-2xl px-0 py-3 z-[1600]"
          style={{
            left: popoverPosition.left,
            bottom: popoverPosition.bottom,
            transform: "translateX(-50%)",
          }}
        >
          <div
            ref={trackRef}
            role="slider"
            aria-label="Volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volumePct)}
            tabIndex={0}
            className="relative mx-auto h-28 w-6 cursor-pointer touch-none outline-none"
            onWheel={handleWheel}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setVolumeFromClientY(event.clientY);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              setVolumeFromClientY(event.clientY);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowRight") {
                event.preventDefault();
                setVolumeByDelta(0.05);
              } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
                event.preventDefault();
                setVolumeByDelta(-0.05);
              } else if (event.key === "Home") {
                event.preventDefault();
                onVolumeChange(0);
              } else if (event.key === "End") {
                event.preventDefault();
                onVolumeChange(1);
              }
            }}
          >
            <div className="absolute bottom-0 left-1/2 h-full w-[3px] -translate-x-1/2 rounded-full bg-white/10" />
            <div
              className="pointer-events-none absolute bottom-0 left-1/2 w-3 -translate-x-1/2 overflow-hidden rounded-full opacity-65 transition-[height] duration-150"
              style={{ height: `${volumePct}%` }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(6,182,212,0)_0%,rgba(6,182,212,0.08)_38%,rgba(34,211,238,0.28)_78%,rgba(165,243,252,0.55)_100%)] blur-[3px]" />
              <div className="absolute inset-x-[4px] inset-y-0 rounded-full bg-[linear-gradient(0deg,rgba(6,182,212,0.14),rgba(34,211,238,0.56),rgba(207,250,254,0.78))]" />
            </div>
            <div
              className="absolute bottom-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-[linear-gradient(0deg,rgba(6,182,212,0.14),rgba(34,211,238,0.56),rgba(207,250,254,0.78))] transition-[height] duration-150"
              style={{ height: `${volumePct}%` }}
            />
            <div
              className="pointer-events-none absolute left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-cyan-100 shadow-[0_0_6px_rgba(165,243,252,0.62),0_0_12px_rgba(34,211,238,0.34)] transition-[bottom,opacity] duration-150"
              style={{
                bottom: `${volumePct}%`,
                opacity: volumePct > 0 ? 0.72 : 0.45,
              }}
            />
          </div>
        </AppPopover>,
        document.body,
      ) : null}
    </div>
  );
}
