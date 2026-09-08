import { describe, expect, it } from "vitest";

import {
  buildBandTargets,
  getDisplayedCenters,
} from "@/components/player/bar/waveform-drawing";

describe("waveform drawing math", () => {
  it("selects fewer display bands as the canvas narrows", () => {
    expect(getDisplayedCenters(640).length).toBeGreaterThan(
      getDisplayedCenters(120).length,
    );
    expect(getDisplayedCenters(120).length).toBeGreaterThan(0);
  });

  it("returns silent targets when there is no spectrum data", () => {
    const centers = getDisplayedCenters(240);

    expect(buildBandTargets([], 44100, centers)).toEqual(
      Array.from({ length: centers.length }, () => 0),
    );
  });

  it("aggregates valid spectrum data into normalized targets", () => {
    const centers = getDisplayedCenters(240).slice(0, 4);
    const targets = buildBandTargets(
      Array.from({ length: 512 }, () => -20),
      44100,
      centers,
    );

    expect(targets).toHaveLength(centers.length);
    expect(targets.every((target) => target >= 0 && target <= 1)).toBe(true);
    expect(targets.some((target) => target > 0)).toBe(true);
  });
});
