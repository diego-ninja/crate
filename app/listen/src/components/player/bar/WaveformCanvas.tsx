import { memo, useCallback, useEffect, useRef } from "react";

interface WaveformCanvasProps {
  bars: number[];
  progress: number;
  frequencies: number[];
  isPlaying: boolean;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  bars,
  progress,
  frequencies,
  isPlaying,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);

    const totalBars = bars.length;
    const gap = 1;
    const barWidth = Math.max(1, (width - gap * (totalBars - 1)) / totalBars);

    for (let index = 0; index < totalBars; index += 1) {
      const baseHeight = bars[index]!;
      const frequencyIndex = Math.floor((index / totalBars) * frequencies.length);
      const frequencyValue = frequencies[frequencyIndex] ?? 0;
      const normalizedHeight = isPlaying
        ? Math.max(baseHeight * 0.3, baseHeight * 0.4 + frequencyValue * 0.6)
        : baseHeight;
      const barHeight = Math.max(1, normalizedHeight * height);
      const x = index * (barWidth + gap);
      const y = height - barHeight;
      const barPercentage = ((index + 0.5) / totalBars) * 100;

      context.fillStyle =
        barPercentage <= progress ? "rgba(6,182,212,0.6)" : "rgba(255,255,255,0.08)";
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, 1);
      context.fill();
    }
  }, [bars, dpr, frequencies, isPlaying, progress]);

  useEffect(() => {
    draw();
  }, [draw]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
});
