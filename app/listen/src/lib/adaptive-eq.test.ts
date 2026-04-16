import { describe, expect, it } from "vitest";

import { computeAdaptiveGains } from "./adaptive-eq";
import { EQ_BAND_COUNT } from "./equalizer";
import type { EqFeatures } from "@/hooks/use-eq-features";

function mkFeatures(partial: Partial<EqFeatures>): EqFeatures {
  return {
    energy: null,
    loudness: null,
    dynamicRange: null,
    brightness: null,
    danceability: null,
    valence: null,
    acousticness: null,
    instrumentalness: null,
    ...partial,
  };
}

describe("computeAdaptiveGains", () => {
  it("returns flat when features are null", () => {
    const gains = computeAdaptiveGains(null);
    expect(gains).toHaveLength(EQ_BAND_COUNT);
    expect(gains.every((g) => g === 0)).toBe(true);
  });

  it("returns flat when all features are null", () => {
    const gains = computeAdaptiveGains(mkFeatures({}));
    expect(gains.every((g) => g === 0)).toBe(true);
  });

  it("protects highly dynamic tracks — always flat", () => {
    const gains = computeAdaptiveGains(mkFeatures({
      brightness: 0.15,   // would normally lift highs
      energy: 0.9,        // would normally push bass
      dynamicRange: 18,   // escape hatch
    }));
    expect(gains.every((g) => g === 0)).toBe(true);
  });

  it("lifts highs on dark tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ brightness: 0.18 }));
    // Bands 7, 8, 9 correspond to 4K / 8K / 16K.
    expect(gains[7]!).toBeGreaterThan(0);
    expect(gains[8]!).toBeGreaterThan(0);
    expect(gains[9]!).toBeGreaterThan(0);
    // Lows stay neutral with only brightness signal.
    expect(gains[0]!).toBe(0);
    expect(gains[1]!).toBe(0);
  });

  it("cuts highs on bright tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ brightness: 0.75 }));
    expect(gains[7]!).toBeLessThan(0);
    expect(gains[8]!).toBeLessThan(0);
  });

  it("reinforces bass on high-energy tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ energy: 0.85 }));
    expect(gains[0]!).toBeGreaterThan(0); // 32 Hz
    expect(gains[1]!).toBeGreaterThan(0); // 64 Hz
  });

  it("adds warmth to mellow low-energy tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ energy: 0.2 }));
    expect(gains[3]!).toBeGreaterThan(0); // 250 Hz (warmth)
  });

  it("tames upper mids on hot masters", () => {
    const gains = computeAdaptiveGains(mkFeatures({ loudness: -8 }));
    expect(gains[5]!).toBeLessThan(0); // 1K
    expect(gains[6]!).toBeLessThan(0); // 2K
  });

  it("nudges mids up on quiet masters", () => {
    const gains = computeAdaptiveGains(mkFeatures({ loudness: -22 }));
    expect(gains[4]!).toBeGreaterThan(0); // 500
    expect(gains[5]!).toBeGreaterThan(0); // 1K
  });

  it("applies subtle V-shape to compressed tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ dynamicRange: 4 }));
    expect(gains[1]!).toBeGreaterThan(0); // 64
    expect(gains[8]!).toBeGreaterThan(0); // 8K
  });

  it("adds warmth on acoustic-heavy tracks", () => {
    const gains = computeAdaptiveGains(mkFeatures({ acousticness: 0.8 }));
    expect(gains[3]!).toBeGreaterThan(0); // 250 (body)
    expect(gains[7]!).toBeLessThan(0);    // 4K (gentle tame)
  });

  it("composes multiple heuristics additively", () => {
    // Dark + high energy + compressed → bass lift + high lift + V-shape.
    const gains = computeAdaptiveGains(mkFeatures({
      brightness: 0.2,
      energy: 0.85,
      dynamicRange: 5,
    }));
    expect(gains[1]!).toBeGreaterThan(1); // 64 gets multiple boosts
    expect(gains[8]!).toBeGreaterThan(1); // 8K gets brightness lift + V-shape
  });

  it("clamps total movement to ±4 dB even with piling-on heuristics", () => {
    const gains = computeAdaptiveGains(mkFeatures({
      brightness: 0.1,
      energy: 0.95,
      loudness: -24,
      dynamicRange: 3,
      acousticness: 0.9,
    }));
    for (const g of gains) {
      expect(g).toBeGreaterThanOrEqual(-4);
      expect(g).toBeLessThanOrEqual(4);
    }
  });
});
