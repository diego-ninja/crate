import type { TrackInfo } from "@/lib/track-info";

export type PaletteTriplet = [number, number, number];

export type MoodEntry = { label: string; value: number };

export function cssColor(color: PaletteTriplet, alpha = 1) {
  return `color(srgb ${color.join(" ")} / ${alpha})`;
}

export function prettyLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function parseMoodEntries(input: TrackInfo["mood_json"]): MoodEntry[] {
  if (!input) return [];

  let source: unknown = input;
  if (typeof input === "string") {
    try {
      source = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }

  const entries: MoodEntry[] = [];
  for (const [label, raw] of Object.entries(source)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0.04) {
      continue;
    }
    entries.push({ label: prettyLabel(label), value: raw });
  }

  return entries.sort((a, b) => b.value - a.value);
}

export function formatBitrate(value: number | null | undefined) {
  return value && value > 0 ? `${Math.round(value)} kbps` : null;
}

export function formatSampleRate(value: number | null | undefined) {
  return value && value > 0
    ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`
    : null;
}

export function formatBitDepth(value: number | null | undefined) {
  return value && value > 0 ? `${value}-bit` : null;
}

export function formatKey(
  audioKey: string | null | undefined,
  audioScale: string | null | undefined,
) {
  if (!audioKey) return null;
  const scale = audioScale ? prettyLabel(audioScale) : null;
  return scale ? `${audioKey} ${scale}` : audioKey;
}

export function hasTrackAnalysis(info: TrackInfo) {
  return [
    info.bpm,
    info.energy,
    info.danceability,
    info.valence,
    info.acousticness,
    info.instrumentalness,
    info.loudness,
    info.dynamic_range,
  ].some((value) => typeof value === "number");
}
