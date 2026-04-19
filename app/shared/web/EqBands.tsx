import { memo, useCallback, useRef, useState } from "react";

import {
  EQ_BANDS,
  EQ_GAIN_MIN,
  EQ_GAIN_MAX,
  EQ_GAIN_RANGE,
  EQ_GAIN_STEP,
} from "./equalizer-constants";

interface EqBandsProps {
  gains: readonly number[];
  onBandChange?: (bandIndex: number, gainDb: number) => void;
  disabled?: boolean;
  trackHeight?: number;
  animate?: boolean;
}

function gainToPct(gain: number): number {
  return ((gain - EQ_GAIN_MIN) / EQ_GAIN_RANGE) * 100;
}

function snapGain(raw: number): number {
  const clamped = Math.max(EQ_GAIN_MIN, Math.min(EQ_GAIN_MAX, raw));
  return Math.round(clamped / EQ_GAIN_STEP) * EQ_GAIN_STEP;
}

function formatGain(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  if (rounded > 0) return `+${rounded}`;
  if (rounded === 0) return "0";
  return String(rounded);
}

const Band = memo(function Band({
  index,
  gain,
  label,
  onBandChange,
  disabled,
  trackHeight,
  dragging,
  onDragStart,
}: {
  index: number;
  gain: number;
  label: string;
  onBandChange?: (bandIndex: number, gainDb: number) => void;
  disabled?: boolean;
  trackHeight: number;
  dragging: boolean;
  onDragStart: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const interactive = !!onBandChange && !disabled;
  const pct = gainToPct(gain);

  const computeGain = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const raw = EQ_GAIN_MIN + ratio * EQ_GAIN_RANGE;
      onBandChange?.(index, snapGain(raw));
    },
    [index, onBandChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onDragStart();
      computeGain(e.clientY);
    },
    [interactive, computeGain, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive || !(e.buttons & 1)) return;
      computeGain(e.clientY);
    },
    [interactive, computeGain],
  );

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-[9px] tabular-nums text-white/50">
        {formatGain(gain)}
      </span>
      <div
        ref={trackRef}
        className={`relative w-full ${interactive ? "cursor-ns-resize" : ""}`}
        style={{ height: trackHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {/* Track background */}
        <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full bg-white/[0.06]" />
        {/* Zero line */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        {/* Thumb */}
        <div
          className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)] ${
            dragging ? "" : "transition-all duration-500"
          }`}
          style={{ top: `calc(${100 - pct}% - 6px)` }}
        />
      </div>
      <span className="font-mono text-[9px] text-white/45">{label}</span>
    </div>
  );
});

export const EqBands = memo(function EqBands({
  gains,
  onBandChange,
  disabled = false,
  trackHeight = 96,
  animate = true,
}: EqBandsProps) {
  const [isDragging, setIsDragging] = useState(false);
  const showTransitions = animate && !isDragging;

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div
      className={`grid grid-cols-10 gap-1.5 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {EQ_BANDS.map((band, i) => (
        <Band
          key={band.freq}
          index={i}
          gain={gains[i] ?? 0}
          label={band.label}
          onBandChange={onBandChange}
          disabled={disabled}
          trackHeight={trackHeight}
          dragging={!showTransitions}
          onDragStart={() => setIsDragging(true)}
        />
      ))}
    </div>
  );
});
