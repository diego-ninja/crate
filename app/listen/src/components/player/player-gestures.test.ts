import { describe, expect, it } from "vitest";

import {
  getHorizontalPlayerSwipeAction,
  getPlayerSwipeThreshold,
} from "@/components/player/player-gestures";

describe("player gestures", () => {
  it("scales the swipe threshold with viewport width and clamps extremes", () => {
    expect(getPlayerSwipeThreshold(320)).toBe(28);
    expect(getPlayerSwipeThreshold(390)).toBeCloseTo(31.2);
    expect(getPlayerSwipeThreshold(1200)).toBe(44);
  });

  it("detects intentional horizontal swipes", () => {
    expect(getHorizontalPlayerSwipeAction({ deltaX: -42, deltaY: 6, viewportWidth: 390 })).toBe("next");
    expect(getHorizontalPlayerSwipeAction({ deltaX: 42, deltaY: 6, viewportWidth: 390 })).toBe("previous");
  });

  it("ignores short or vertical gestures", () => {
    expect(getHorizontalPlayerSwipeAction({ deltaX: -24, deltaY: 0, viewportWidth: 390 })).toBeNull();
    expect(getHorizontalPlayerSwipeAction({ deltaX: -42, deltaY: 30, viewportWidth: 390 })).toBeNull();
  });
});
