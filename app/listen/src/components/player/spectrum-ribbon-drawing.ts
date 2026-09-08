import { readCanvasColorToken } from "@/lib/canvas-color";
import { SPECTRUM_RIBBON_COLOR_TOKENS } from "./visualizer-color-tokens";

export interface SpectrumRibbonBands {
  low: number;
  lowMid: number;
  mid: number;
  highMid: number;
  high: number;
}

export const SPECTRUM_RIBBON_PERSISTENCE = {
  idleDecayAlpha: 0.13,
  playingDecayAlpha: 0.055,
  threadCount: 26,
} as const;

const MIN_DB = -92;
const MAX_DB = -18;
const BAND_RANGES = [
  [40, 120],
  [120, 420],
  [420, 1600],
  [1600, 5200],
  [5200, 14000],
] as const;
const POINT_COUNT = 88;
const THREAD_COUNT = SPECTRUM_RIBBON_PERSISTENCE.threadCount;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function gaussian(x: number, center: number, width: number) {
  const distance = (x - center) / width;
  return Math.exp(-distance * distance);
}

function dbToUnit(db: number) {
  if (!Number.isFinite(db)) return 0;
  return Math.pow(clamp((db - MIN_DB) / (MAX_DB - MIN_DB), 0, 1), 0.72);
}

export function buildSpectrumRibbonBands(
  frequenciesDb: readonly number[],
  sampleRate: number,
): SpectrumRibbonBands {
  if (!frequenciesDb.length || sampleRate <= 0) {
    return { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 };
  }

  const nyquist = sampleRate / 2;
  const binFrequency = nyquist / frequenciesDb.length;
  const values = BAND_RANGES.map(([from, to]) => {
    const start = Math.max(1, Math.floor(from / binFrequency));
    const end = Math.min(
      frequenciesDb.length - 1,
      Math.max(start + 1, Math.ceil(to / binFrequency)),
    );
    let peak = MIN_DB;
    let sum = 0;
    let count = 0;

    for (let index = start; index <= end; index += 1) {
      const value = frequenciesDb[index] ?? MIN_DB;
      peak = Math.max(peak, value);
      sum += value;
      count += 1;
    }

    const average = count > 0 ? sum / count : MIN_DB;
    return dbToUnit(peak * 0.68 + average * 0.32);
  });

  return {
    low: values[0] ?? 0,
    lowMid: values[1] ?? 0,
    mid: values[2] ?? 0,
    highMid: values[3] ?? 0,
    high: values[4] ?? 0,
  };
}

function waveformAt(waveform: readonly number[] | undefined, ratio: number) {
  if (!waveform?.length) return 0;
  const index = clamp(
    Math.floor(ratio * (waveform.length - 1)),
    0,
    waveform.length - 1,
  );
  return waveform[index] ?? 0;
}

function buildRibbonSignature(
  t: number,
  bands: SpectrumRibbonBands,
  phase: number,
  threadRatio: number,
) {
  const lowWeight = bands.low * 0.45 + bands.lowMid * 0.25;
  const midWeight = bands.mid * 0.42 + bands.highMid * 0.22;
  const highWeight = bands.high * 0.22;
  const drift = (threadRatio - 0.5) * 0.028;
  const lobeDrift =
    Math.sin(phase * 1.35 + threadRatio * 9.7) * 0.018 +
    Math.sin(phase * 0.58 - threadRatio * 6.2) * 0.012;
  const lowBreath = 1 + Math.sin(phase * 1.9 + threadRatio * 7.4) * 0.18;
  const midBreath = 1 + Math.sin(phase * 1.46 - threadRatio * 10.8) * 0.22;
  const tailBreath = 1 + Math.sin(phase * 0.92 + threadRatio * 12.6) * 0.2;
  const flowCenter = (phase * 0.065 + threadRatio * 0.41) % 1;
  const counterFlowCenter =
    (1 - ((phase * 0.041 + threadRatio * 0.29) % 1)) % 1;
  const flow =
    0.2 * gaussian(t, flowCenter, 0.036) -
    0.15 * gaussian(t, counterFlowCenter, 0.052);

  return (
    -0.26 * gaussian(t, 0.13, 0.18) +
    (-1.08 - lowWeight * 0.36) *
      lowBreath *
      gaussian(t, 0.34 + drift + lobeDrift, 0.052 + lowWeight * 0.012) +
    (0.86 + lowWeight * 0.34) *
      (2 - lowBreath) *
      gaussian(t, 0.43 - drift * 0.6 - lobeDrift * 0.8, 0.056) +
    (-0.3 - midWeight * 0.2) *
      midBreath *
      gaussian(t, 0.54 + lobeDrift * 0.45, 0.058) +
    (0.52 + midWeight * 0.42) *
      (2 - midBreath) *
      gaussian(t, 0.62 - drift - lobeDrift, 0.05 + midWeight * 0.01) +
    (-0.42 - highWeight * 0.24) *
      tailBreath *
      gaussian(t, 0.74 + drift * 0.5 + lobeDrift * 0.7, 0.098) +
    flow +
    0.16 * Math.sin(t * Math.PI * 2.2 + phase + threadRatio * 3.2) +
    0.07 * Math.sin(t * Math.PI * 5.1 - phase * 0.92 + threadRatio * 8.8)
  );
}

function buildPhosphorGradient(
  context: CanvasRenderingContext2D,
  width: number,
  colors: readonly string[],
) {
  const gradient = context.createLinearGradient(0, 0, width, 0);
  const stops = [0, 0.08, 0.26, 0.5, 0.72, 0.92, 1];
  stops.forEach((position, index) => {
    gradient.addColorStop(position, colors[index] ?? "transparent");
  });
  return gradient;
}

interface SpectrumRibbonPalette {
  fade: string;
  gradient: readonly string[];
  shadow: string;
  trace: string;
  traceShadow: string;
}

export function readSpectrumRibbonPalette(
  canvas: HTMLCanvasElement,
): SpectrumRibbonPalette {
  const read = (tokenName: `--${string}`) =>
    readCanvasColorToken(canvas, tokenName) ?? "transparent";

  return {
    fade: read("--text-primary"),
    gradient: SPECTRUM_RIBBON_COLOR_TOKENS.map(read),
    shadow: read("--visualizer-ribbon-shadow"),
    trace: read("--visualizer-ribbon-trace"),
    traceShadow: read("--visualizer-ribbon-trace-shadow"),
  };
}

function drawThread(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: SpectrumRibbonBands,
  waveform: readonly number[] | undefined,
  time: number,
  thread: number,
  emphasis = 1,
) {
  const threadRatio = thread / Math.max(1, THREAD_COUNT - 1);
  const phase = time * (0.00054 + thread * 0.000008) + threadRatio * 7.3;
  const energy =
    0.12 +
    bands.low * 0.22 +
    bands.lowMid * 0.22 +
    bands.mid * 0.28 +
    bands.highMid * 0.16 +
    bands.high * 0.12;
  const centerY =
    height *
    (0.5 +
      Math.sin(phase * 0.38 + threadRatio * Math.PI * 2) *
        0.012 *
        (0.5 + energy));
  const offset =
    (threadRatio - 0.5) *
    height *
    (0.1 + bands.mid * 0.07) *
    (1 + Math.sin(phase * 0.9 + threadRatio * 10.2) * 0.22);
  const amplitude = height * (0.25 + energy * 0.36) * emphasis;
  const points: Array<{ x: number; y: number }> = [];

  for (let point = 0; point <= POINT_COUNT; point += 1) {
    const t = point / POINT_COUNT;
    const signature = buildRibbonSignature(t, bands, phase, threadRatio);
    const fine =
      waveformAt(waveform, t) * (0.08 + energy * 0.11) +
      Math.sin(t * Math.PI * 12.2 + phase * 1.7 + thread * 0.4) * 0.04 +
      Math.sin(t * Math.PI * 29.4 - phase * 1.14 + thread) * 0.018 +
      Math.sin((t + threadRatio * 0.17) * Math.PI * 43.2 + phase * 0.56) * 0.01;
    const envelope = Math.pow(Math.sin(Math.PI * t), 0.74);
    const verticalDrift =
      Math.sin(phase * 1.15 + t * Math.PI * 1.6 + threadRatio * 4.8) *
      height *
      0.018 *
      envelope;
    const xDrift =
      envelope *
      width *
      (Math.sin(phase * 0.72 + t * Math.PI * 2.6 + threadRatio * 5.8) * 0.009 +
        Math.sin(phase * 1.18 - t * Math.PI * 4.8 + threadRatio * 9.1) * 0.006);
    points.push({
      x: width * t + xDrift,
      y:
        centerY +
        offset * (0.22 + envelope * 0.78) +
        (signature + fine) * amplitude * (0.22 + envelope * 0.92) +
        verticalDrift,
    });
  }

  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let point = 1; point < points.length; point += 1) {
    context.lineTo(points[point]!.x, points[point]!.y);
  }
  context.stroke();
}

function drawTravelingTrace(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: SpectrumRibbonBands,
  waveform: readonly number[] | undefined,
  time: number,
  palette: SpectrumRibbonPalette,
) {
  const head = (time * 0.00008) % 1;
  const windowSize = 0.12;
  const start = Math.max(0, head - windowSize);
  const end = Math.min(1, head + windowSize * 0.32);

  context.save();
  context.beginPath();
  context.rect(width * start - 24, 0, width * (end - start) + 48, height);
  context.clip();
  context.globalCompositeOperation = "lighter";
  context.strokeStyle = palette.trace;
  context.shadowColor = palette.traceShadow;
  context.shadowBlur = 18;
  context.globalAlpha = 0.42;
  context.lineWidth = 1.15;
  drawThread(context, width, height, bands, waveform, time, 13, 1.08);
  context.restore();
}

export function drawSpectrumRibbonFrame({
  context,
  width,
  height,
  bands,
  waveform,
  time,
  isPlaying,
  palette,
}: {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  bands: SpectrumRibbonBands;
  waveform: readonly number[] | undefined;
  time: number;
  isPlaying: boolean;
  palette: SpectrumRibbonPalette;
}) {
  const gradient = buildPhosphorGradient(context, width, palette.gradient);

  context.globalCompositeOperation = "lighter";
  context.strokeStyle = gradient;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = palette.shadow;
  context.shadowBlur = isPlaying ? 12 : 7;

  for (let thread = 0; thread < THREAD_COUNT; thread += 1) {
    const distanceFromCenter = Math.abs(
      thread / Math.max(1, THREAD_COUNT - 1) - 0.5,
    );
    context.globalAlpha =
      (isPlaying ? 0.046 : 0.03) * (1 - distanceFromCenter * 0.66);
    context.lineWidth = thread % 7 === 0 ? 0.8 : 0.34;
    drawThread(
      context,
      width,
      height,
      bands,
      waveform,
      time,
      thread,
      0.94 + distanceFromCenter * 0.18,
    );
  }

  context.globalAlpha = isPlaying ? 0.58 : 0.34;
  context.lineWidth = 0.92;
  context.shadowBlur = isPlaying ? 18 : 10;
  drawThread(
    context,
    width,
    height,
    bands,
    waveform,
    time,
    Math.floor(THREAD_COUNT / 2),
    1.04,
  );

  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.shadowBlur = 0;
  if (isPlaying) {
    drawTravelingTrace(context, width, height, bands, waveform, time, palette);
  }
}
