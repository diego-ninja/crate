import type { TrackInfo } from "@/lib/track-info";

export interface MoodMap {
  [key: string]: number | null | undefined;
}

export interface TrackVisualizerInfo {
  bpm: number | null;
  audio_key: string | null;
  audio_scale: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness?: number | null;
  dynamic_range?: number | null;
  mood_json?: MoodMap | null;
  bliss_signature?: {
    texture: number | null;
    motion: number | null;
    density: number | null;
  } | null;
}

export interface VisualizerPaletteBias {
  brightness: number;
  coolness: number;
  saturation: number;
  hueShift: number;
}

export interface VisualizerSettingsDelta {
  separation: number;
  glow: number;
  scale: number;
  persistence: number;
  octaves: number;
}

export interface VisualizerMotionProfile {
  orbitSpeed: number;
  cameraDrift: number;
  cameraDepth: number;
  pulseGain: number;
  turbulence: number;
  orbitPhase: number;
  shellDensity: number;
  beatResponse: number;
  beatDecay: number;
  sectionRate: number;
  sectionDepth: number;
  lowBandWeight: number;
  midBandWeight: number;
  highBandWeight: number;
}

export interface VisualizerTrackProfile {
  moodTag: string | null;
  hasAnalysis: boolean;
  summary: string | null;
  settingsDelta: VisualizerSettingsDelta;
  motion: VisualizerMotionProfile;
  paletteBias: VisualizerPaletteBias;
}

export const DEFAULT_PROFILE: VisualizerTrackProfile = {
  moodTag: null,
  hasAnalysis: false,
  summary: null,
  settingsDelta: {
    separation: 0,
    glow: 0,
    scale: 0,
    persistence: 0,
    octaves: 0,
  },
  motion: {
    orbitSpeed: 1,
    cameraDrift: 1,
    cameraDepth: 0,
    pulseGain: 1,
    turbulence: 1,
    orbitPhase: 0,
    shellDensity: 1,
    beatResponse: 1,
    beatDecay: 0.88,
    sectionRate: 1,
    sectionDepth: 0.12,
    lowBandWeight: 1,
    midBandWeight: 1,
    highBandWeight: 1,
  },
  paletteBias: {
    brightness: 0,
    coolness: 0,
    saturation: 0,
    hueShift: 0,
  },
};

const KEY_INDEX: Record<string, number> = {
  c: 0,
  "b#": 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  fb: 4,
  f: 5,
  "e#": 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
  cb: 11,
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function topMood(moods?: MoodMap | null): string | null {
  if (!moods) return null;

  let bestKey: string | null = null;
  let bestValue = -Infinity;
  for (const [key, value] of Object.entries(moods)) {
    const score = typeof value === "number" ? value : Number.NEGATIVE_INFINITY;
    if (score > bestValue) {
      bestValue = score;
      bestKey = key;
    }
  }

  return bestKey;
}

export function moodScore(moods: MoodMap | null | undefined, key: string) {
  const value = moods?.[key];
  return clamp(typeof value === "number" ? value : 0, 0, 1);
}

export function hasAnalysisData(info: TrackVisualizerInfo | null) {
  if (!info) return false;

  const numericFields = [
    info.bpm,
    info.energy,
    info.danceability,
    info.valence,
    info.acousticness,
    info.instrumentalness,
    info.loudness,
    info.dynamic_range,
  ];

  if (numericFields.some((value) => typeof value === "number")) {
    return true;
  }

  return Object.values(info.mood_json ?? {}).some(
    (value) => typeof value === "number",
  );
}

export function describeTempo(bpm: number) {
  if (bpm >= 155) return "fast";
  if (bpm >= 122) return "driving";
  if (bpm <= 90) return "slow";
  return "steady";
}

export function getKeyIndex(audioKey: string | null | undefined) {
  if (!audioKey) return null;
  return KEY_INDEX[audioKey.trim().toLowerCase()] ?? null;
}

export function normalizeMoodMap(
  moodJson: TrackInfo["mood_json"],
): MoodMap | null {
  if (!moodJson) return null;
  if (typeof moodJson === "string") {
    try {
      const parsed = JSON.parse(moodJson);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as MoodMap)
        : null;
    } catch {
      return null;
    }
  }

  return typeof moodJson === "object" && !Array.isArray(moodJson)
    ? (moodJson as MoodMap)
    : null;
}

export function toVisualizerInfo(
  info: TrackInfo | null,
): TrackVisualizerInfo | null {
  if (!info) return null;
  return {
    bpm: info.bpm,
    audio_key: info.audio_key,
    audio_scale: info.audio_scale,
    energy: info.energy,
    danceability: info.danceability,
    valence: info.valence,
    acousticness: info.acousticness,
    instrumentalness: info.instrumentalness,
    loudness: info.loudness,
    dynamic_range: info.dynamic_range,
    mood_json: normalizeMoodMap(info.mood_json),
    bliss_signature: info.bliss_signature,
  };
}
