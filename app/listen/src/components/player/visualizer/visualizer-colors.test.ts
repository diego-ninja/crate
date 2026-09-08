import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VISUALIZER_COLORS,
  parseVisualizerColor,
  readVisualizerColors,
  VISUALIZER_COLOR_TOKENS,
} from "./visualizer-colors";

describe("visualizer colors", () => {
  it("keeps the semantic roles mapped to CSS tokens", () => {
    expect(Object.values(VISUALIZER_COLOR_TOKENS)).toEqual([
      "--accent-action",
      "--visualizer-sphere-color-2",
      "--visualizer-sphere-color-3",
    ]);
  });

  it.each([
    ["rgb(6, 182, 212)", [6 / 255, 182 / 255, 212 / 255]],
    ["color(srgb 0.4 0.9 1)", [0.4, 0.9, 1]],
    ["rgb(20% 40% 60% / 0.5)", [0.2, 0.4, 0.6]],
  ])("parses %s into normalized RGB", (value, expected) => {
    expect(parseVisualizerColor(value)).toEqual(expected);
  });

  it("returns null for values unsupported by the WebGL palette", () => {
    expect(parseVisualizerColor("var(--accent-action)")).toBeNull();
  });

  it("provides one stable fallback triplet for unavailable CSS", () => {
    expect(DEFAULT_VISUALIZER_COLORS).toEqual([
      [0.024, 0.714, 0.831],
      [0.4, 0.9, 1],
      [0.1, 0.3, 0.8],
    ]);
  });

  it("reads the current theme palette and falls back per color", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (target) =>
        ({
          color: (target as HTMLElement).style.color.includes("accent-action")
            ? "color(srgb 0.2 0.4 0.6)"
            : "",
        }) as CSSStyleDeclaration,
    );

    expect(readVisualizerColors(document.createElement("span"))).toEqual([
      [0.2, 0.4, 0.6],
      [0.4, 0.9, 1],
      [0.1, 0.3, 0.8],
    ]);
  });
});
