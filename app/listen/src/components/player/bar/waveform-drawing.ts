import { readCanvasColorToken } from "@/lib/canvas-color";
import { WAVEFORM_COLOR_TOKENS } from "../visualizer-color-tokens";

const MIN_DISPLAY_DB = -85;
const MAX_DISPLAY_DB = -15;
const BAR_GAP = 2;
const MIN_BAR_WIDTH = 2;

function generateFractionalOctaveCenters(
  divisionsPerOctave: number,
  minFrequency = 31.5,
  maxFrequency = 16000,
) {
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

export interface WaveformCanvasSize {
  dpr: number;
  height: number;
  width: number;
}

export interface WaveformPalette {
  activeGradientBottom: string | null;
  activeGradientTop: string | null;
  idleGradientBottom: string | null;
  idleGradientTop: string | null;
  peakActive: string | null;
  peakIdle: string | null;
}

export function readWaveformPalette(
  canvas: HTMLCanvasElement,
): WaveformPalette {
  return {
    activeGradientTop: readCanvasColorToken(
      canvas,
      WAVEFORM_COLOR_TOKENS.activeGradientTop,
    ),
    activeGradientBottom: readCanvasColorToken(
      canvas,
      WAVEFORM_COLOR_TOKENS.activeGradientBottom,
    ),
    idleGradientTop: readCanvasColorToken(
      canvas,
      WAVEFORM_COLOR_TOKENS.idleGradientTop,
    ),
    idleGradientBottom: readCanvasColorToken(
      canvas,
      WAVEFORM_COLOR_TOKENS.idleGradientBottom,
    ),
    peakActive: readCanvasColorToken(canvas, WAVEFORM_COLOR_TOKENS.peakActive),
    peakIdle: readCanvasColorToken(canvas, WAVEFORM_COLOR_TOKENS.peakIdle),
  };
}

export function getDisplayedCenters(width: number): readonly number[] {
  const maxBars = Math.floor((width + BAR_GAP) / (MIN_BAR_WIDTH + BAR_GAP));
  if (maxBars >= SIXTH_OCTAVE_CENTERS.length) return SIXTH_OCTAVE_CENTERS;
  if (maxBars >= THIRD_OCTAVE_CENTERS.length) return THIRD_OCTAVE_CENTERS;
  const step = Math.max(2, Math.ceil(THIRD_OCTAVE_CENTERS.length / maxBars));
  return THIRD_OCTAVE_CENTERS.filter((_, index) => index % step === 0);
}

export function buildBandTargets(
  frequenciesDb: number[],
  sampleRate: number,
  centers: readonly number[],
): number[] {
  if (!frequenciesDb.length || !centers.length) {
    return Array.from({ length: centers.length }, () => 0);
  }

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
      const amplitude = dbToAmplitude(
        (frequenciesDb[index] ?? MIN_DISPLAY_DB) + weightingDb,
      );
      peak = Math.max(peak, amplitude);
      rmsSum += amplitude * amplitude;
      count += 1;
    }

    if (!count) return 0;

    const rms = Math.sqrt(rmsSum / count);
    const composite = peak * 0.6 + rms * 0.4;
    const compensatedDb = amplitudeToDb(composite);
    const normalized = clamp(
      (compensatedDb - MIN_DISPLAY_DB) / (MAX_DISPLAY_DB - MIN_DISPLAY_DB),
      0,
      1,
    );
    return Math.pow(normalized, 0.7);
  });
}

export function syncWaveformCanvasSize(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  previousSize: WaveformCanvasSize,
): WaveformCanvasSize {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nextSize = { width, height, dpr };
  if (
    previousSize.width !== width ||
    previousSize.height !== height ||
    previousSize.dpr !== dpr
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return nextSize;
}

export function drawWaveformFrame({
  cachedGradient,
  cachedGradientHeight,
  context,
  current,
  frequenciesDb,
  height,
  isPlaying,
  palette,
  peaks,
  sampleRate,
  width,
}: {
  cachedGradient: CanvasGradient | null;
  cachedGradientHeight: number;
  context: CanvasRenderingContext2D;
  current: number[];
  frequenciesDb: number[];
  height: number;
  isPlaying: boolean;
  palette: WaveformPalette;
  peaks: number[];
  sampleRate: number;
  width: number;
}): { gradient: CanvasGradient | null; gradientHeight: number } {
  const centers = getDisplayedCenters(width);
  const targets = buildBandTargets(frequenciesDb, sampleRate, centers);
  const barCount = centers.length;
  const attack = isPlaying ? 0.45 : 0.12;
  const release = isPlaying ? 0.18 : 0.08;
  const peakDrop = isPlaying ? 0.006 : 0.02;
  const baselineY = height;
  const usableHeight = height - 2;
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    (width - (barCount - 1) * BAR_GAP) / barCount,
  );
  const totalUsed = barCount * barWidth + (barCount - 1) * BAR_GAP;
  const offsetX = (width - totalUsed) / 2;

  let gradient = cachedGradient;
  let gradientHeight = cachedGradientHeight;
  if (gradientHeight !== height) {
    gradientHeight = height;
    gradient = context.createLinearGradient(0, 0, 0, baselineY);
    gradient.addColorStop(
      0,
      (isPlaying ? palette.activeGradientTop : palette.idleGradientTop) ??
        "transparent",
    );
    gradient.addColorStop(
      1,
      (isPlaying ? palette.activeGradientBottom : palette.idleGradientBottom) ??
        "transparent",
    );
  }

  context.clearRect(0, 0, width, height);
  context.fillStyle = gradient ?? palette.peakActive ?? "transparent";
  for (let index = 0; index < barCount; index += 1) {
    const target = targets[index] ?? 0;
    const currentValue = current[index] ?? 0;
    const eased =
      currentValue +
      (target - currentValue) * (target > currentValue ? attack : release);
    current[index] = eased;
    peaks[index] =
      target >= (peaks[index] ?? 0)
        ? target
        : Math.max(eased, (peaks[index] ?? 0) - peakDrop);

    const barHeight = Math.max(0, eased * usableHeight);
    if (barHeight > 0.5) {
      const x = offsetX + index * (barWidth + BAR_GAP);
      context.fillRect(x, baselineY - barHeight, barWidth, barHeight);
    }
  }

  context.fillStyle =
    (isPlaying ? palette.peakActive : palette.peakIdle) ?? "transparent";
  for (let index = 0; index < barCount; index += 1) {
    const peakHeight = (peaks[index] ?? 0) * usableHeight;
    if (peakHeight > 1) {
      const x = offsetX + index * (barWidth + BAR_GAP);
      context.fillRect(x, baselineY - peakHeight, barWidth, 2);
    }
  }

  return { gradient, gradientHeight };
}

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
  const denominator =
    (f2 + Math.pow(20.6, 2)) *
    Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) *
    (f2 + Math.pow(12200, 2));
  return 2 + 20 * Math.log10(numerator / denominator);
}
