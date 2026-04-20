import { memo, useCallback, useRef, useState } from "react";

const EQ_BANDS = [
  { freq: 32, label: "32" }, { freq: 64, label: "64" },
  { freq: 125, label: "125" }, { freq: 250, label: "250" },
  { freq: 500, label: "500" }, { freq: 1000, label: "1K" },
  { freq: 2000, label: "2K" }, { freq: 4000, label: "4K" },
  { freq: 8000, label: "8K" }, { freq: 16000, label: "16K" },
] as const;

const GAIN_MIN = -12;
const GAIN_MAX = 12;
const GAIN_RANGE = GAIN_MAX - GAIN_MIN;
const GAIN_STEP = 0.5;

interface EqBandsProps {
  gains: readonly number[];
  onBandChange?: (bandIndex: number, gainDb: number) => void;
  disabled?: boolean;
  trackHeight?: number;
}

function snapGain(raw: number): number {
  return Math.round(Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw)) / GAIN_STEP) * GAIN_STEP;
}

function formatGain(g: number): string {
  const r = Math.round(g * 10) / 10;
  return r > 0 ? `+${r}` : r === 0 ? "0" : String(r);
}

function Band({
  index, gain, label, onBandChange, disabled, trackHeight, dragging, onDragStart,
}: {
  index: number; gain: number; label: string;
  onBandChange?: (i: number, dB: number) => void;
  disabled?: boolean; trackHeight: number; dragging: boolean; onDragStart: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const interactive = !!onBandChange && !disabled;
  const pct = ((gain - GAIN_MIN) / GAIN_RANGE) * 100;

  const computeGain = useCallback((clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onBandChange?.(index, snapGain(GAIN_MIN + ratio * GAIN_RANGE));
  }, [index, onBandChange]);

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-[9px] tabular-nums text-white/50">{formatGain(gain)}</span>
      <div
        ref={trackRef}
        className={`relative w-full ${interactive ? "cursor-ns-resize" : ""}`}
        style={{ height: trackHeight }}
        onPointerDown={(e) => {
          if (!interactive) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onDragStart();
          computeGain(e.clientY);
        }}
        onPointerMove={(e) => { if (interactive && e.buttons & 1) computeGain(e.clientY); }}
      >
        <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-md bg-white/[0.06]" />
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        <div
          className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-md bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)] ${dragging ? "" : "transition-all duration-500"}`}
          style={{ top: `calc(${100 - pct}% - 6px)` }}
        />
      </div>
      <span className="font-mono text-[9px] text-white/45">{label}</span>
    </div>
  );
}

export const EqBands = memo(function EqBands({
  gains, onBandChange, disabled = false, trackHeight = 96,
}: EqBandsProps) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      className={`grid grid-cols-10 gap-1.5 ${disabled ? "pointer-events-none opacity-40" : ""}`}
      onPointerUp={() => setIsDragging(false)}
      onPointerLeave={() => setIsDragging(false)}
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
          dragging={isDragging}
          onDragStart={() => setIsDragging(true)}
        />
      ))}
    </div>
  );
});
