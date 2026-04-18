import { useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { AppPopover } from "@/components/ui/AppPopover";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";

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
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);

  const closeVolume = () => {
    setShowVolume(false);
    onOverlayChange(false);
  };

  useDismissibleLayer({
    active: showVolume,
    refs: [volumeRef, volumeButtonRef],
    onDismiss: closeVolume,
    closeOnEscape: false,
  });

  return (
    <div className="relative flex items-center">
      <button
        ref={volumeButtonRef}
        onClick={() => {
          const nextOpen = !showVolume;
          setShowVolume(nextOpen);
          onOverlayChange(nextOpen);
        }}
        aria-label={volume === 0 ? "Unmute" : "Volume"}
        className="rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
      >
        {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      {showVolume ? (
        <AppPopover ref={volumeRef} className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg p-2 z-app-popover">
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => onVolumeChange(parseFloat(event.target.value))}
            className="h-1 w-24 accent-primary"
            style={{ writingMode: "horizontal-tb" }}
          />
        </AppPopover>
      ) : null}
    </div>
  );
}
