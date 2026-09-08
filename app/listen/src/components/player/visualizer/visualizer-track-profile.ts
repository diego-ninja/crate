import {
  DEFAULT_PROFILE,
  clamp,
  describeTempo,
  getKeyIndex,
  hasAnalysisData,
  moodScore,
  topMood,
} from "./visualizer-track-profile-model";
import type {
  TrackVisualizerInfo,
  VisualizerPaletteBias,
  VisualizerTrackProfile,
} from "./visualizer-track-profile-model";

export {
  normalizeMoodMap,
  toVisualizerInfo,
} from "./visualizer-track-profile-model";
export type {
  MoodMap,
  TrackVisualizerInfo,
  VisualizerMotionProfile,
  VisualizerPaletteBias,
  VisualizerSettingsDelta,
  VisualizerTrackProfile,
} from "./visualizer-track-profile-model";

export function buildVisualizerTrackProfile(
  info: TrackVisualizerInfo | null,
): VisualizerTrackProfile {
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
  const loudnessNorm = clamp(((info.loudness ?? -14) + 20) / 15, 0, 1);
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
    energy * 0.46 +
      aggressive * 0.22 +
      party * 0.16 +
      bpmNorm * 0.12 +
      loudnessNorm * 0.04,
    0,
    1,
  );
  const uplift = clamp(
    valence * 0.45 +
      happy * 0.28 +
      (isMajor ? 0.08 : 0) -
      sad * 0.12 -
      dark * 0.08,
    0,
    1,
  );
  const drive = clamp(
    danceability * 0.32 +
      party * 0.24 +
      bpmNorm * 0.2 +
      aggressive * 0.16 +
      energy * 0.08,
    0,
    1,
  );
  const organic = clamp(
    acousticness * 0.52 + acousticMood * 0.32 - electronic * 0.18,
    0,
    1,
  );
  const hypnotic = clamp(
    instrumentalness * 0.42 +
      relaxed * 0.2 +
      electronic * 0.14 +
      dynamicRangeNorm * 0.1 -
      drive * 0.08,
    0,
    1,
  );
  const shadow = clamp(
    dark * 0.34 +
      sad * 0.18 +
      (1 - valence) * 0.2 +
      (isMinor ? 0.1 : 0) +
      aggressive * 0.08,
    0,
    1,
  );

  const separation = clamp(
    intensity * 0.16 + drive * 0.13 - organic * 0.08 + aggressive * 0.05 - 0.1,
    -0.12,
    0.28,
  );
  const glow = clamp(
    uplift * 3 +
      intensity * 2.6 +
      happy * 0.8 +
      electronic * 0.6 -
      organic * 1.4 -
      shadow * 1.3 -
      0.8,
    -2.5,
    5.5,
  );
  const scale = clamp(
    bpmNorm * 0.95 +
      intensity * 0.45 +
      drive * 0.2 -
      relaxed * 0.15 -
      organic * 0.12 -
      0.55,
    -0.25,
    1.1,
  );
  const persistence = clamp(
    hypnotic * 0.6 +
      organic * 0.18 +
      relaxed * 0.14 +
      dynamicRangeNorm * 0.12 -
      drive * 0.22 -
      aggressive * 0.08 -
      0.16,
    -0.25,
    0.7,
  );
  const octaves = clamp(
    Math.round(
      intensity * 2.7 +
        drive * 1.5 +
        electronic * 0.8 -
        organic * 0.8 -
        relaxed * 0.5 -
        1.8,
    ),
    -2,
    2,
  );

  const paletteBias: VisualizerPaletteBias = {
    brightness: clamp(
      uplift * 0.24 +
        happy * 0.08 +
        (isMajor ? 0.05 : 0) -
        shadow * 0.18 -
        0.03 +
        harmonicCos * 0.02,
      -0.22,
      0.22,
    ),
    coolness: clamp(
      0.02 +
        shadow * 0.16 +
        electronic * 0.08 +
        (isMinor ? 0.05 : 0) -
        happy * 0.06 -
        acousticMood * 0.04 +
        harmonicSin * 0.04,
      -0.1,
      0.22,
    ),
    saturation: clamp(
      intensity * 0.18 +
        drive * 0.12 +
        electronic * 0.08 -
        organic * 0.08 +
        happy * 0.04 -
        relaxed * 0.03 +
        blissTexture * 0.06,
      -0.08,
      0.28,
    ),
    hueShift: clamp(
      (keyIndex != null ? (keyIndex / 12 - 0.5) * 0.18 : 0) +
        (isMinor ? -0.02 : isMajor ? 0.02 : 0),
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
      orbitSpeed: clamp(
        0.9 +
          bpmNorm * 0.35 +
          electronic * 0.1 +
          blissMotion * 0.12 -
          relaxed * 0.12,
        0.75,
        1.55,
      ),
      cameraDrift: clamp(
        0.85 +
          organic * 0.25 +
          shadow * 0.18 +
          dynamicRangeNorm * 0.1 -
          party * 0.08 +
          harmonicCos * 0.08,
        0.7,
        1.5,
      ),
      cameraDepth: clamp(
        shadow * 0.22 - uplift * 0.1 - organic * 0.04,
        -0.12,
        0.22,
      ),
      pulseGain: clamp(
        0.92 +
          intensity * 0.36 +
          aggressive * 0.16 +
          party * 0.12 +
          loudnessNorm * 0.08 -
          relaxed * 0.1,
        0.8,
        1.7,
      ),
      turbulence: clamp(
        0.88 +
          electronic * 0.2 +
          aggressive * 0.12 -
          organic * 0.1 +
          drive * 0.08 +
          blissTexture * 0.18,
        0.75,
        1.5,
      ),
      orbitPhase: harmonicAngle,
      shellDensity: clamp(
        0.88 +
          blissDensity * 0.32 +
          loudnessNorm * 0.08 -
          dynamicRangeNorm * 0.1,
        0.75,
        1.3,
      ),
      beatResponse: clamp(
        0.88 +
          drive * 0.32 +
          party * 0.18 +
          blissMotion * 0.16 +
          loudnessNorm * 0.08,
        0.8,
        1.7,
      ),
      beatDecay: clamp(
        0.86 +
          dynamicRangeNorm * 0.07 +
          organic * 0.03 -
          party * 0.03 -
          blissDensity * 0.02,
        0.78,
        0.96,
      ),
      sectionRate: clamp(
        0.82 + bpmNorm * 0.3 + blissMotion * 0.14 - relaxed * 0.12,
        0.7,
        1.4,
      ),
      sectionDepth: clamp(
        0.1 +
          dynamicRangeNorm * 0.12 +
          organic * 0.06 +
          blissTexture * 0.04 -
          party * 0.03,
        0.08,
        0.28,
      ),
      lowBandWeight: clamp(
        1 +
          aggressive * 0.18 +
          shadow * 0.08 +
          party * 0.06 -
          acousticMood * 0.08,
        0.82,
        1.32,
      ),
      midBandWeight: clamp(
        0.96 +
          organic * 0.16 +
          relaxed * 0.08 +
          dynamicRangeNorm * 0.06 -
          electronic * 0.05,
        0.85,
        1.28,
      ),
      highBandWeight: clamp(
        0.94 +
          electronic * 0.18 +
          happy * 0.08 +
          blissTexture * 0.12 -
          shadow * 0.08,
        0.8,
        1.34,
      ),
    },
    paletteBias,
  };
}
