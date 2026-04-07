import { useEffect, useMemo, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";

interface MoodMap {
  [key: string]: number | null | undefined;
}

interface TrackVisualizerInfo {
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

interface VisualizerPaletteBias {
  brightness: number;
  coolness: number;
  saturation: number;
  hueShift: number;
}

interface VisualizerSettingsDelta {
  separation: number;
  glow: number;
  scale: number;
  persistence: number;
  octaves: number;
}

interface VisualizerMotionProfile {
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

const DEFAULT_PROFILE: VisualizerTrackProfile = {
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

const profileCache = new Map<string, TrackVisualizerInfo | null>();
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function topMood(moods?: MoodMap | null): string | null {
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

function moodScore(moods: MoodMap | null | undefined, key: string) {
  const value = moods?.[key];
  return clamp(typeof value === "number" ? value : 0, 0, 1);
}

function hasAnalysisData(info: TrackVisualizerInfo | null) {
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

  return Object.values(info.mood_json ?? {}).some((value) => typeof value === "number");
}

function describeTempo(bpm: number) {
  if (bpm >= 155) return "fast";
  if (bpm >= 122) return "driving";
  if (bpm <= 90) return "slow";
  return "steady";
}

function getKeyIndex(audioKey: string | null | undefined) {
  if (!audioKey) return null;
  return KEY_INDEX[audioKey.trim().toLowerCase()] ?? null;
}

function buildProfile(info: TrackVisualizerInfo | null): VisualizerTrackProfile {
  if (!info || !hasAnalysisData(info)) return DEFAULT_PROFILE;

  const energy = clamp(info.energy ?? 0.5, 0, 1);
  const danceability = clamp(info.danceability ?? 0.5, 0, 1);
  const valence = clamp(info.valence ?? 0.5, 0, 1);
  const acousticness = clamp(info.acousticness ?? 0.2, 0, 1);
  const instrumentalness = clamp(info.instrumentalness ?? 0.1, 0, 1);
  const bpm = info.bpm ?? 120;
  const bpmNorm = clamp((bpm - 70) / 110, 0, 1);
  const moodTag = topMood(info.mood_json);
  const aggressive = moodScore(info.mood_json, "aggressive");
  const dark = moodScore(info.mood_json, "dark");
  const happy = moodScore(info.mood_json, "happy");
  const sad = moodScore(info.mood_json, "sad");
  const relaxed = moodScore(info.mood_json, "relaxed");
  const party = moodScore(info.mood_json, "party");
  const electronic = moodScore(info.mood_json, "electronic");
  const acousticMood = moodScore(info.mood_json, "acoustic");
  const loudnessNorm = clamp((((info.loudness ?? -14) + 20) / 15), 0, 1);
  const dynamicRangeNorm = clamp((info.dynamic_range ?? 8) / 16, 0, 1);
  const isMinor = info.audio_scale?.toLowerCase() === "minor";
  const isMajor = info.audio_scale?.toLowerCase() === "major";
  const blissTexture = clamp(info.bliss_signature?.texture ?? 0.5, 0, 1);
  const blissMotion = clamp(info.bliss_signature?.motion ?? 0.5, 0, 1);
  const blissDensity = clamp(info.bliss_signature?.density ?? 0.5, 0, 1);
  const keyIndex = getKeyIndex(info.audio_key);
  const harmonicAngle = keyIndex != null ? (keyIndex / 12) * Math.PI * 2 : 0;
  const harmonicSin = Math.sin(harmonicAngle);
  const harmonicCos = Math.cos(harmonicAngle);

  const intensity = clamp(
    energy * 0.46 + aggressive * 0.22 + party * 0.16 + bpmNorm * 0.12 + loudnessNorm * 0.04,
    0,
    1,
  );
  const uplift = clamp(
    valence * 0.45 + happy * 0.28 + (isMajor ? 0.08 : 0) - sad * 0.12 - dark * 0.08,
    0,
    1,
  );
  const drive = clamp(
    danceability * 0.32 + party * 0.24 + bpmNorm * 0.2 + aggressive * 0.16 + energy * 0.08,
    0,
    1,
  );
  const organic = clamp(
    acousticness * 0.52 + acousticMood * 0.32 - electronic * 0.18,
    0,
    1,
  );
  const hypnotic = clamp(
    instrumentalness * 0.42 + relaxed * 0.2 + electronic * 0.14 + dynamicRangeNorm * 0.1 - drive * 0.08,
    0,
    1,
  );
  const shadow = clamp(
    dark * 0.34 + sad * 0.18 + (1 - valence) * 0.2 + (isMinor ? 0.1 : 0) + aggressive * 0.08,
    0,
    1,
  );

  const separation = clamp(
    intensity * 0.16 + drive * 0.13 - organic * 0.08 + aggressive * 0.05 - 0.1,
    -0.12,
    0.28,
  );
  const glow = clamp(
    uplift * 3 + intensity * 2.6 + happy * 0.8 + electronic * 0.6 - organic * 1.4 - shadow * 1.3 - 0.8,
    -2.5,
    5.5,
  );
  const scale = clamp(
    bpmNorm * 0.95 + intensity * 0.45 + drive * 0.2 - relaxed * 0.15 - organic * 0.12 - 0.55,
    -0.25,
    1.1,
  );
  const persistence = clamp(
    hypnotic * 0.6 + organic * 0.18 + relaxed * 0.14 + dynamicRangeNorm * 0.12 - drive * 0.22 - aggressive * 0.08 - 0.16,
    -0.25,
    0.7,
  );
  const octaves = clamp(
    Math.round(intensity * 2.7 + drive * 1.5 + electronic * 0.8 - organic * 0.8 - relaxed * 0.5 - 1.8),
    -2,
    2,
  );

  const paletteBias: VisualizerPaletteBias = {
    brightness: clamp(
      uplift * 0.24 + happy * 0.08 + (isMajor ? 0.05 : 0) - shadow * 0.18 - 0.03 + harmonicCos * 0.02,
      -0.22,
      0.22,
    ),
    coolness: clamp(
      0.02 + shadow * 0.16 + electronic * 0.08 + (isMinor ? 0.05 : 0) - happy * 0.06 - acousticMood * 0.04 + harmonicSin * 0.04,
      -0.1,
      0.22,
    ),
    saturation: clamp(
      intensity * 0.18 + drive * 0.12 + electronic * 0.08 - organic * 0.08 + happy * 0.04 - relaxed * 0.03 + blissTexture * 0.06,
      -0.08,
      0.28,
    ),
    hueShift: clamp(
      (keyIndex != null ? (keyIndex / 12 - 0.5) * 0.18 : 0) + (isMinor ? -0.02 : isMajor ? 0.02 : 0),
      -0.12,
      0.12,
    ),
  };

  const summaryParts = [
    typeof info.bpm === "number" ? `${Math.round(info.bpm)} BPM` : null,
    moodTag ? moodTag.replace(/_/g, " ") : describeTempo(bpm),
    info.audio_scale ? info.audio_scale.toLowerCase() : null,
  ].filter((value): value is string => Boolean(value));

  return {
    moodTag,
    hasAnalysis: true,
    summary: summaryParts.join(" · "),
    settingsDelta: {
      separation,
      glow,
      scale,
      persistence,
      octaves,
    },
    motion: {
      orbitSpeed: clamp(0.9 + bpmNorm * 0.35 + electronic * 0.1 + blissMotion * 0.12 - relaxed * 0.12, 0.75, 1.55),
      cameraDrift: clamp(0.85 + organic * 0.25 + shadow * 0.18 + dynamicRangeNorm * 0.1 - party * 0.08 + harmonicCos * 0.08, 0.7, 1.5),
      cameraDepth: clamp(shadow * 0.22 - uplift * 0.1 - organic * 0.04, -0.12, 0.22),
      pulseGain: clamp(0.92 + intensity * 0.36 + aggressive * 0.16 + party * 0.12 + loudnessNorm * 0.08 - relaxed * 0.1, 0.8, 1.7),
      turbulence: clamp(0.88 + electronic * 0.2 + aggressive * 0.12 - organic * 0.1 + drive * 0.08 + blissTexture * 0.18, 0.75, 1.5),
      orbitPhase: harmonicAngle,
      shellDensity: clamp(0.88 + blissDensity * 0.32 + loudnessNorm * 0.08 - dynamicRangeNorm * 0.1, 0.75, 1.3),
      beatResponse: clamp(0.88 + drive * 0.32 + party * 0.18 + blissMotion * 0.16 + loudnessNorm * 0.08, 0.8, 1.7),
      beatDecay: clamp(0.86 + dynamicRangeNorm * 0.07 + organic * 0.03 - party * 0.03 - blissDensity * 0.02, 0.78, 0.96),
      sectionRate: clamp(0.82 + bpmNorm * 0.3 + blissMotion * 0.14 - relaxed * 0.12, 0.7, 1.4),
      sectionDepth: clamp(0.1 + dynamicRangeNorm * 0.12 + organic * 0.06 + blissTexture * 0.04 - party * 0.03, 0.08, 0.28),
      lowBandWeight: clamp(1 + aggressive * 0.18 + shadow * 0.08 + party * 0.06 - acousticMood * 0.08, 0.82, 1.32),
      midBandWeight: clamp(0.96 + organic * 0.16 + relaxed * 0.08 + dynamicRangeNorm * 0.06 - electronic * 0.05, 0.85, 1.28),
      highBandWeight: clamp(0.94 + electronic * 0.18 + happy * 0.08 + blissTexture * 0.12 - shadow * 0.08, 0.8, 1.34),
    },
    paletteBias,
  };
}

export function useTrackVisualizerProfile(track: Track | undefined, enabled: boolean) {
  const [info, setInfo] = useState<TrackVisualizerInfo | null>(null);

  useEffect(() => {
    if (!enabled || !track) {
      setInfo(null);
      return;
    }

    const cacheKey = track.libraryTrackId != null
      ? `id:${track.libraryTrackId}`
      : `path:${track.path || track.id}`;

    if (profileCache.has(cacheKey)) {
      setInfo(profileCache.get(cacheKey) ?? null);
      return;
    }

    const controller = new AbortController();
    const infoUrl = track.libraryTrackId != null
      ? `/api/tracks/${track.libraryTrackId}/info`
      : `/api/track-info/${encodeURIComponent(
          (track.path || track.id).startsWith("/music/")
            ? (track.path || track.id).slice(7)
            : (track.path || track.id),
        ).replace(/%2F/g, "/")}`;

    api<TrackVisualizerInfo>(infoUrl, "GET", undefined, { signal: controller.signal })
      .then((data) => {
        profileCache.set(cacheKey, data);
        setInfo(data);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        profileCache.set(cacheKey, null);
        setInfo(null);
      });

    return () => {
      controller.abort();
    };
  }, [enabled, track?.id, track?.libraryTrackId, track?.path]);

  return useMemo(() => buildProfile(info), [info]);
}
