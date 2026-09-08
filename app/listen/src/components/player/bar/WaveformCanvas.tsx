import { memo, useEffect, useLayoutEffect, useRef } from "react";

import {
  drawWaveformFrame,
  readWaveformPalette,
  syncWaveformCanvasSize,
} from "@/components/player/bar/waveform-drawing";

interface WaveformCanvasProps {
  frequenciesDb: number[];
  sampleRate: number;
  isPlaying: boolean;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  frequenciesDb,
  sampleRate,
  isPlaying,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frequenciesDbRef = useRef(frequenciesDb);
  const currentRef = useRef<number[]>([]);
  const peaksRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  useLayoutEffect(() => {
    frequenciesDbRef.current = frequenciesDb;
  }, [frequenciesDb]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette = readWaveformPalette(canvas);
    let cachedGradient: CanvasGradient | null = null;
    let cachedGradientHeight = 0;

    const drawFrame = () => {
      if (cancelled) return;

      sizeRef.current = syncWaveformCanvasSize(
        canvas,
        context,
        sizeRef.current,
      );
      const frame = drawWaveformFrame({
        cachedGradient,
        cachedGradientHeight,
        context,
        current: currentRef.current,
        frequenciesDb: frequenciesDbRef.current,
        height: sizeRef.current.height,
        isPlaying,
        palette,
        peaks: peaksRef.current,
        sampleRate,
        width: sizeRef.current.width,
      });
      cachedGradient = frame.gradient;
      cachedGradientHeight = frame.gradientHeight;
      rafRef.current = requestAnimationFrame(drawFrame);
    };

    rafRef.current = requestAnimationFrame(drawFrame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, sampleRate]);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" />;
});
