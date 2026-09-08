import { describe, expect, it } from "vitest";
import { getAdaptiveFeatureChipData } from "./equalizer-adaptive-feature-data";

describe("getAdaptiveFeatureChipData", () => {
  it("formats every available adaptive feature in a stable order", () => {
    const chips = getAdaptiveFeatureChipData({
      brightness: 0.2,
      loudness: -25,
      dynamicRange: 16,
      energy: 0.8,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
    });

    expect(chips.map(({ key, value }) => [key, value])).toEqual([
      ["brightness", "20%"],
      ["loudness", "-25.0 LUFS"],
      ["dynamic", "16.0 dB"],
      ["energy", "80%"],
    ]);
    expect(chips.every(({ zone }) => zone === "active")).toBe(true);
  });

  it("marks values inside the adaptive bands as neutral", () => {
    const chips = getAdaptiveFeatureChipData({
      brightness: 0.5,
      loudness: -14,
      dynamicRange: 10,
      energy: 0.5,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
    });

    expect(chips.map(({ zone }) => zone)).toEqual([
      "neutral",
      "neutral",
      "neutral",
      "neutral",
    ]);
  });
});
