import { memo, useEffect, useRef } from "react";

interface WaveformCanvasProps {
  frequenciesDb: number[];
  sampleRate: number;
  isPlaying: boolean;
}

const MIN_DISPLAY_DB = -85;
const MAX_DISPLAY_DB = -15;
const BAR_GAP = 2;
const MIN_BAR_WIDTH = 2;

function generateFractionalOctaveCenters(divisionsPerOctave: number, minFrequency = 31.5, maxFrequency = 16000) {
  const centers: number[] = [];
  const ratio = Math.pow(2, 1 / divisionsPerOctave);
  let frequency = minFrequency;

  while (frequency <= maxFrequency * 1.001) {
    centers.push(Number(frequency.toFixed(2)));
    frequency *= ratio;
  }

  return centers;
}

const SIXTH_OCTAVE_CENTERS = generateFractionalOctaveCenters(6);
const THIRD_OCTAVE_CENTERS = generateFractionalOctaveCenters(3);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dbToAmplitude(db: number) {
  if (!Number.isFinite(db)) return 0;
  return Math.pow(10, db / 20);
}

function amplitudeToDb(amplitude: number) {
  if (amplitude <= 0) return MIN_DISPLAY_DB;
  return 20 * Math.log10(amplitude);
}

function aWeighting(frequency: number) {
  if (frequency <= 0) return 0;
  const f2 = frequency * frequency;
  const numerator = Math.pow(12200, 2) * Math.pow(f2, 2);
  const denominator = (f2 + Math.pow(20.6, 2))
    * Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2)))
    * (f2 + Math.pow(12200, 2));
  return 2 + 20 * Math.log10(numerator / denominator);
}

function getDisplayedCenters(width: number) {
  const maxBars = Math.floor((width + BAR_GAP) / (MIN_BAR_WIDTH + BAR_GAP));
  if (maxBars >= SIXTH_OCTAVE_CENTERS.length) return SIXTH_OCTAVE_CENTERS;
  if (maxBars >= THIRD_OCTAVE_CENTERS.length) return THIRD_OCTAVE_CENTERS;
  const step = Math.max(2, Math.ceil(THIRD_OCTAVE_CENTERS.length / maxBars));
  return THIRD_OCTAVE_CENTERS.filter((_, i) => i % step === 0);
}

function buildBandTargets(frequenciesDb: number[], sampleRate: number, centers: readonly number[]) {
  if (!frequenciesDb.length || !centers.length) return Array.from({ length: centers.length }, () => 0);

  const nyquist = sampleRate * 0.5;
  const binFrequency = nyquist / frequenciesDb.length;
  return centers.map((centerFrequency) => {
    if (centerFrequency >= nyquist) return 0;

    const lower = centerFrequency / Math.pow(2, 1 / 6);
    const upper = centerFrequency * Math.pow(2, 1 / 6);
    const startIndex = Math.max(1, Math.floor(lower / binFrequency));
    const endIndex = Math.max(startIndex + 1, Math.ceil(upper / binFrequency));

    let peak = 0;
    let rmsSum = 0;
    let count = 0;

    for (let index = startIndex; index < endIndex; index += 1) {
      const frequency = index * binFrequency;
      const weightingDb = aWeighting(frequency) * 0.35;
      const amplitude = dbToAmplitude((frequenciesDb[index] ?? MIN_DISPLAY_DB) + weightingDb);
      peak = Math.max(peak, amplitude);
      rmsSum += amplitude * amplitude;
      count += 1;
    }

    if (!count) return 0;

    const rms = Math.sqrt(rmsSum / count);
    const composite = peak * 0.6 + rms * 0.4;
    const compensatedDb = amplitudeToDb(composite);
    const normalized = clamp((compensatedDb - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB), 0, 1);
    return Math.pow(normalized, 0.7);
  });
}

export const WaveformCanvas = memo(function WaveformCanvas({
  frequenciesDb,
  sampleRate,
  isPlaying,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frequenciesDbRef = useRef(frequenciesDb);
  const targetsRef = useRef<number[]>([]);
  const currentRef = useRef<number[]>([]);
  const peaksRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  frequenciesDbRef.current = frequenciesDb;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    const syncCanvasSize = (context: CanvasRenderingContext2D) => {
      const width = Math.max(1, Math.floor(canvas.clientWidth));
      const height = Math.max(1, Math.floor(canvas.clientHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const needsResize =
        sizeRef.current.width !== width ||
        sizeRef.current.height !== height ||
        sizeRef.current.dpr !== dpr;

      if (needsResize) {
        sizeRef.current = { width, height, dpr };
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      return sizeRef.current;
    };

    const ensureBuffers = (bandCount: number) => {
      if (targetsRef.current.length === bandCount) return;
      currentRef.current = Array.from({ length: bandCount }, (_, i) => currentRef.current[i] ?? 0);
      peaksRef.current = Array.from({ length: bandCount }, (_, i) => peaksRef.current[i] ?? 0);
    };

    const context = canvas.getContext("2d");
    if (!context) return;

    // Read the CSS --primary HSL values once for color construction.
    const cs = getComputedStyle(canvas);
    const accent = cs.getPropertyValue("--primary").trim() || "183 100% 50%";

    // Pre-compute colors outside the animation loop.
    const peakColorPlaying = `hsla(${accent} / 0.95)`;
    const peakColorPaused = `hsla(${accent} / 0.5)`;

    // Single full-height gradient cached per resize; clipped by fillRect.
    let cachedGrad: CanvasGradient | null = null;
    let cachedGradHeight = 0;

    const drawFrame = () => {
      if (cancelled) return;

      const { width, height } = syncCanvasSize(context);
      const centers = getDisplayedCenters(width);
      const barCount = centers.length;
      ensureBuffers(barCount);
      targetsRef.current = buildBandTargets(frequenciesDbRef.current, sampleRate, centers);

      context.clearRect(0, 0, width, height);

      const attack = isPlaying ? 0.45 : 0.12;
      const release = isPlaying ? 0.18 : 0.08;
      const peakDrop = isPlaying ? 0.006 : 0.02;
      const baselineY = height;
      const usableHeight = height - 2;
      const totalBarSpace = width;
      const barWidth = Math.max(MIN_BAR_WIDTH, (totalBarSpace - (barCount - 1) * BAR_GAP) / barCount);
      const totalUsed = barCount * barWidth + (barCount - 1) * BAR_GAP;
      const offsetX = (width - totalUsed) / 2;

      // Rebuild gradient only on resize
      if (cachedGradHeight !== height) {
        cachedGradHeight = height;
        cachedGrad = context.createLinearGradient(0, 0, 0, baselineY);
        const alpha = isPlaying ? 0.55 : 0.3;
        const alphaBase = isPlaying ? 0.12 : 0.06;
        cachedGrad.addColorStop(0, `hsla(${accent} / ${alpha})`);
        cachedGrad.addColorStop(1, `hsla(${accent} / ${alphaBase})`);
      }

      // Batch bars with the same fill
      context.fillStyle = cachedGrad ?? peakColorPlaying;
      for (let i = 0; i < barCount; i += 1) {
        const target = targetsRef.current[i] ?? 0;
        const current = currentRef.current[i] ?? 0;
        const eased = current + (target - current) * (target > current ? attack : release);
        currentRef.current[i] = eased;

        peaksRef.current[i] = target >= (peaksRef.current[i] ?? 0)
          ? target
          : Math.max(eased, (peaksRef.current[i] ?? 0) - peakDrop);

        const barH = Math.max(0, eased * usableHeight);
        if (barH > 0.5) {
          const x = offsetX + i * (barWidth + BAR_GAP);
          context.fillRect(x, baselineY - barH, barWidth, barH);
        }
      }

      // Peak markers in a single batch
      context.fillStyle = isPlaying ? peakColorPlaying : peakColorPaused;
      for (let i = 0; i < barCount; i += 1) {
        const peakH = (peaksRef.current[i] ?? 0) * usableHeight;
        if (peakH > 1) {
          const x = offsetX + i * (barWidth + BAR_GAP);
          context.fillRect(x, baselineY - peakH, barWidth, 2);
        }
      }

      rafRef.current = requestAnimationFrame(drawFrame);
    };

    rafRef.current = requestAnimationFrame(drawFrame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, sampleRate]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
});
