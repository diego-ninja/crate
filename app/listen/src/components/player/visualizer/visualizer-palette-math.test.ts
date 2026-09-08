import { describe, expect, it } from "vitest";

import {
  adjustPaletteColor,
  clamp,
} from "@/components/player/visualizer/visualizer-palette-math";

describe("visualizer palette math", () => {
  it("clamps values to the requested range", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it("keeps a neutral palette unchanged", () => {
    const adjusted = adjustPaletteColor([0.2, 0.4, 0.6], 0, 0, 0, 0);
    expect(adjusted[0]).toBeCloseTo(0.2);
    expect(adjusted[1]).toBeCloseTo(0.4);
    expect(adjusted[2]).toBeCloseTo(0.6);
  });

  it("keeps adjusted colors inside the WebGL color range", () => {
    const adjusted = adjustPaletteColor([0.2, 0.4, 0.6], 0.8, -0.5, 1.4, 0.35);
    expect(adjusted.every((value) => value >= 0 && value <= 1)).toBe(true);
  });
});
