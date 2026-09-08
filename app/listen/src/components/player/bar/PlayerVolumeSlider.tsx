import type { CSSProperties, RefObject } from "react";
import type { TFunction } from "i18next";

import { AppPopover } from "@crate/ui/primitives/AppPopover";

interface PlayerVolumeSliderProps {
  handleWheel: (event: React.WheelEvent) => void;
  onVolumeChange: (volume: number) => void;
  onVolumeFromClientY: (clientY: number) => void;
  onVolumeByDelta: (delta: number) => void;
  popoverPosition: {
    left: number;
    bottom: number;
  };
  t: TFunction;
  trackRef: RefObject<HTMLDivElement | null>;
  volumePct: number;
  volumeRef: RefObject<HTMLDivElement | null>;
}

export function PlayerVolumeSlider({
  handleWheel,
  onVolumeChange,
  onVolumeFromClientY,
  onVolumeByDelta,
  popoverPosition,
  t,
  trackRef,
  volumePct,
  volumeRef,
}: PlayerVolumeSliderProps) {
  return (
    <AppPopover
      ref={volumeRef}
      className="fixed z-[1600] w-10 rounded-[12px] px-0 py-3"
      style={{
        left: popoverPosition.left,
        bottom: popoverPosition.bottom,
        transform: "translateX(-50%)",
      }}
    >
      <div
        ref={trackRef}
        role="slider"
        aria-label={t("player.volume.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volumePct)}
        tabIndex={0}
        className="listen-player-progress relative mx-auto h-28 w-6 cursor-pointer touch-none outline-none"
        onWheel={handleWheel}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          onVolumeFromClientY(event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 1) return;
          onVolumeFromClientY(event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onVolumeByDelta(0.05);
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onVolumeByDelta(-0.05);
          } else if (event.key === "Home") {
            event.preventDefault();
            onVolumeChange(0);
          } else if (event.key === "End") {
            event.preventDefault();
            onVolumeChange(1);
          }
        }}
      >
        <div className="listen-player-progress-track absolute bottom-0 left-1/2 h-full w-[3px] -translate-x-1/2 rounded-full" />
        <div
          className="listen-player-progress-height-dynamic pointer-events-none absolute bottom-0 left-1/2 w-3 overflow-hidden rounded-full opacity-65"
          style={{ "--progress-scale": volumePct / 100 } as CSSProperties}
        >
          <div className="listen-player-progress-glow--vertical absolute inset-0 blur-[3px]" />
          <div className="listen-player-progress-fill--vertical absolute inset-x-[4px] inset-y-0 rounded-full" />
        </div>
        <div
          className="listen-player-progress-fill--vertical listen-player-progress-height-dynamic absolute bottom-0 left-1/2 w-[3px] rounded-full"
          style={{ "--progress-scale": volumePct / 100 } as CSSProperties}
        />
        <div
          className={`listen-player-progress-thumb listen-player-progress-bottom-dynamic pointer-events-none absolute left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full transition-opacity duration-150 ${
            volumePct > 0 ? "opacity-[0.72]" : "opacity-[0.45]"
          }`}
          style={
            {
              "--progress-bottom": `${volumePct}%`,
            } as CSSProperties
          }
        />
      </div>
    </AppPopover>
  );
}
