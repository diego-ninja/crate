import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nativeTransitionFlushReason,
  projectedNativePositionSeconds,
} from "./use-native-playback-runtime";

describe("native playback runtime helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies sequential native transitions as completed", () => {
    expect(nativeTransitionFlushReason(undefined, 1, 2, 4, "off")).toBe(
      "completed",
    );
    expect(nativeTransitionFlushReason(undefined, 3, 0, 4, "all")).toBe(
      "completed",
    );
  });

  it("keeps explicit playlist transitions from flushing a play event", () => {
    expect(nativeTransitionFlushReason("playlist", 0, 3, 4, "off")).toBe(null);
    expect(nativeTransitionFlushReason("user", 0, 3, 4, "off")).toBe("skipped");
  });

  it("projects a playing native position without exceeding duration", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    expect(projectedNativePositionSeconds(4_000, 9_000, true, 5_000)).toBe(5);
  });

  it("does not project elapsed time while paused", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    expect(projectedNativePositionSeconds(4_000, 1_000, false, 20_000)).toBe(4);
  });
});
