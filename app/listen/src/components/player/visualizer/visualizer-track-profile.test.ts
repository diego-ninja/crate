import { describe, expect, it } from "vitest";

import {
  buildVisualizerTrackProfile,
  normalizeMoodMap,
} from "@/components/player/visualizer/visualizer-track-profile";

describe("visualizer track profile", () => {
  it("returns the neutral profile without analysis data", () => {
    const profile = buildVisualizerTrackProfile(null);

    expect(profile.hasAnalysis).toBe(false);
    expect(profile.moodTag).toBeNull();
    expect(profile.settingsDelta).toEqual({
      separation: 0,
      glow: 0,
      scale: 0,
      persistence: 0,
      octaves: 0,
    });
  });

  it("normalizes JSON mood maps and derives a readable summary", () => {
    const profile = buildVisualizerTrackProfile({
      bpm: 154,
      audio_key: "F#",
      audio_scale: "minor",
      energy: 0.8,
      danceability: 0.7,
      valence: 0.35,
      acousticness: 0.1,
      instrumentalness: 0.6,
      loudness: -8,
      dynamic_range: 7,
      mood_json: normalizeMoodMap('{"dark":0.9,"aggressive":0.4}'),
      bliss_signature: { texture: 0.6, motion: 0.7, density: 0.8 },
    });

    expect(profile.hasAnalysis).toBe(true);
    expect(profile.moodTag).toBe("dark");
    expect(profile.summary).toBe("154 BPM · dark · minor");
    expect(profile.motion.orbitSpeed).toBeGreaterThan(0.75);
  });

  it("rejects malformed mood JSON", () => {
    expect(normalizeMoodMap("not-json")).toBeNull();
    expect(normalizeMoodMap("[]")).toBeNull();
  });
});
