import { describe, expect, it } from "vitest";

import { shouldRestartTrackBeforePrev } from "./PlayerContext";

describe("shouldRestartTrackBeforePrev", () => {
  it("restarts the current track when playback is past the threshold", () => {
    expect(
      shouldRestartTrackBeforePrev({
        currentTimeSeconds: 12,
        justRestartedCurrentTrack: false,
      }),
    ).toBe(true);
  });

  it("goes to the previous track on an immediate second back press", () => {
    expect(
      shouldRestartTrackBeforePrev({
        currentTimeSeconds: 12,
        justRestartedCurrentTrack: true,
      }),
    ).toBe(false);
  });

  it("goes to the previous track when already near the start", () => {
    expect(
      shouldRestartTrackBeforePrev({
        currentTimeSeconds: 1.2,
        justRestartedCurrentTrack: false,
      }),
    ).toBe(false);
  });
});
