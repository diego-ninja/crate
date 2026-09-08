import { describe, expect, it } from "vitest";

import { buildTrackResolutionKey } from "./use-player-track-recovery";

describe("buildTrackResolutionKey", () => {
  it("changes when any playback resolution input changes", () => {
    const base = buildTrackResolutionKey(
      "current",
      "next",
      2,
      3,
      "/stream/next-a",
    );

    expect(base).toBe("current:next:2:3:/stream/next-a");
    expect(
      buildTrackResolutionKey("current", "next", 2, 3, "/stream/next-b"),
    ).not.toBe(base);
    expect(
      buildTrackResolutionKey("current", "next", 2, 4, "/stream/next-a"),
    ).not.toBe(base);
  });
});
