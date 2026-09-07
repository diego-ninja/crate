import { memo, useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@crate/ui/lib/cn";

import {
  buildSpectrumRibbonBands,
  drawSpectrumRibbonFrame,
  readSpectrumRibbonPalette,
  SPECTRUM_RIBBON_PERSISTENCE,
  type SpectrumRibbonBands,
} from "./spectrum-ribbon-drawing";

export {
  buildSpectrumRibbonBands,
  SPECTRUM_RIBBON_PERSISTENCE,
} from "./spectrum-ribbon-drawing";

interface SpectrumRibbonCanvasProps {
  frequenciesDb: number[];
  sampleRate: number;
  isPlaying: boolean;
  waveform?: number[];
  className?: string;
}

export const SpectrumRibbonCanvas = memo(function SpectrumRibbonCanvas({
  frequenciesDb,
  sampleRate,
  isPlaying,
  waveform,
  className,
}: SpectrumRibbonCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frequenciesRef = useRef(frequenciesDb);
  const waveformRef = useRef(waveform);
  const targetBandsRef = useRef<SpectrumRibbonBands>({
    low: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    high: 0,
  });
  const bandsRef = useRef<SpectrumRibbonBands>(targetBandsRef.current);
  const rafRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  useLayoutEffect(() => {
    frequenciesRef.current = frequenciesDb;
    waveformRef.current = waveform;
  }, [frequenciesDb, waveform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let cancelled = false;
    const palette = readSpectrumRibbonPalette(canvas);

    const syncSize = () => {
      const width = Math.max(1, Math.floor(canvas.clientWidth || 1));
      const height = Math.max(1, Math.floor(canvas.clientHeight || 1));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const resized =
        sizeRef.current.width !== width ||
        sizeRef.current.height !== height ||
        sizeRef.current.dpr !== dpr;
      if (resized) {
        sizeRef.current = { width, height, dpr };
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      return { ...sizeRef.current, resized };
    };

    const draw = (time: number) => {
      if (cancelled) return;
      const { width, height, resized } = syncSize();
      targetBandsRef.current = buildSpectrumRibbonBands(
        frequenciesRef.current,
        sampleRate,
      );
      const current = bandsRef.current;
      const target = targetBandsRef.current;
      const attack = isPlaying ? 0.18 : 0.08;
      bandsRef.current = {
        low: current.low + (target.low - current.low) * attack,
        lowMid: current.lowMid + (target.lowMid - current.lowMid) * attack,
        mid: current.mid + (target.mid - current.mid) * attack,
        highMid: current.highMid + (target.highMid - current.highMid) * attack,
        high: current.high + (target.high - current.high) * attack,
      };

      if (resized) {
        context.clearRect(0, 0, width, height);
      } else {
        context.save();
        context.globalCompositeOperation = "destination-out";
        context.globalAlpha = isPlaying
          ? SPECTRUM_RIBBON_PERSISTENCE.playingDecayAlpha
          : SPECTRUM_RIBBON_PERSISTENCE.idleDecayAlpha;
        context.fillStyle = palette.fade;
        context.fillRect(0, 0, width, height);
        context.restore();
      }

      drawSpectrumRibbonFrame({
        context,
        width,
        height,
        bands: bandsRef.current,
        waveform: waveformRef.current,
        time,
        isPlaying,
        palette,
      });
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, sampleRate]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="spectrum-ribbon-canvas"
      className={cn("absolute inset-0 size-full bg-transparent", className)}
    />
  );
});
