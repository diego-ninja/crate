import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CRATE_ICON_SIZE, Volume2, VolumeX } from "@crate/ui/icons";

import { useHoverCapability } from "@/hooks/use-hover-capability";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useTranslation } from "react-i18next";
import { PlayerVolumeSlider } from "@/components/player/bar/PlayerVolumeSlider";

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
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const canUseWheel = useHoverCapability();
  const { t } = useTranslation();
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
      left: Math.max(
        popoverWidth / 2 + 6,
        Math.min(window.innerWidth - popoverWidth / 2 - 6, desiredLeft),
      ),
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

  const setVolumeFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pct =
        1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      onVolumeChange(Math.round(pct * 100) / 100);
    },
    [onVolumeChange],
  );

  const setVolumeByDelta = useCallback(
    (delta: number) => {
      onVolumeChange(
        Math.max(0, Math.min(1, Math.round((volume + delta) * 100) / 100)),
      );
    },
    [onVolumeChange, volume],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent) => {
      if (!canUseWheel) return;
      event.preventDefault();
      event.stopPropagation();
      const dominantDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      const step = event.shiftKey ? 0.01 : 0.03;
      setVolumeByDelta(dominantDelta > 0 ? -step : step);
    },
    [canUseWheel, setVolumeByDelta],
  );

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
        aria-label={
          volume === 0 ? t("player.volume.unmute") : t("player.volume.label")
        }
        className="rounded-md p-1.5 text-text-muted transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action"
      >
        <span ref={volumeIconRef} className="block">
          {volume === 0 ? (
            <VolumeX size={CRATE_ICON_SIZE.md} />
          ) : (
            <Volume2 size={CRATE_ICON_SIZE.md} />
          )}
        </span>
      </button>
      {showVolume && popoverPosition
        ? createPortal(
            <PlayerVolumeSlider
              handleWheel={handleWheel}
              onVolumeChange={onVolumeChange}
              onVolumeFromClientY={setVolumeFromClientY}
              onVolumeByDelta={setVolumeByDelta}
              popoverPosition={popoverPosition}
              t={t}
              trackRef={trackRef}
              volumePct={volumePct}
              volumeRef={volumeRef}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
