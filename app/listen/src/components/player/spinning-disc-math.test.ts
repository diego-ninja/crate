import { describe, expect, it } from "vitest";

import {
  clamp,
  getJogTime,
  getPointerAngle,
  normalizeDeltaDegrees,
  projectPlaybackTime,
} from "@/components/player/spinning-disc-math";

const bounds = {
  height: 200,
  left: 0,
  top: 0,
  width: 200,
} as DOMRect;

describe("spinning disc math", () => {
  it("clamps values to the requested range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(4, 0, 10)).toBe(4);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("normalizes pointer deltas across the rotation boundary", () => {
    expect(normalizeDeltaDegrees(270)).toBe(-90);
    expect(normalizeDeltaDegrees(-270)).toBe(90);
    expect(normalizeDeltaDegrees(45)).toBe(45);
  });

  it("calculates pointer angles around the disc center", () => {
    expect(getPointerAngle({ clientX: 200, clientY: 100 }, bounds)).toBe(0);
    expect(getPointerAngle({ clientX: 100, clientY: 0 }, bounds)).toBe(-90);
  });

  it("projects playback while respecting pause, buffering and duration", () => {
    const base = {
      anchorTime: 30,
      anchorTimestamp: 1000,
      duration: 31,
      isBuffering: false,
      isPlaying: true,
      timestamp: 1500,
    };

    expect(projectPlaybackTime(base)).toBe(30.5);
    expect(projectPlaybackTime({ ...base, timestamp: 5000 })).toBe(31);
    expect(projectPlaybackTime({ ...base, isBuffering: true })).toBe(30);
    expect(projectPlaybackTime({ ...base, isPlaying: false })).toBe(30);
  });

  it("converts accumulated rotation into a bounded seek time", () => {
    expect(
      getJogTime({ accumDegrees: 180, duration: 120, startTime: 10 }),
    ).toBe(11.25);
    expect(
      getJogTime({ accumDegrees: -3600, duration: 120, startTime: 10 }),
    ).toBe(0);
    expect(
      getJogTime({ accumDegrees: 36000, duration: 120, startTime: 10 }),
    ).toBe(120);
  });
});
