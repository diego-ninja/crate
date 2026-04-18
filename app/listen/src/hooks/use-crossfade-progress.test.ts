import { describe, expect, it } from "vitest";

import { getCrossfadeAwareProgress } from "./use-crossfade-progress";

describe("getCrossfadeAwareProgress", () => {
  it("returns the live playback values when there is no crossfade", () => {
    expect(getCrossfadeAwareProgress(null, 12, 240)).toEqual({
      displayedTime: 12,
      displayedDuration: 240,
    });
  });

  it("keeps the seek bar on the incoming track during a crossfade", () => {
    expect(
      getCrossfadeAwareProgress(
        {
          outgoing: {
            id: "a",
            title: "Outgoing",
            artist: "Band",
          },
          incoming: {
            id: "b",
            title: "Incoming",
            artist: "Band",
          },
          durationMs: 6000,
          startedAt: 1000,
          outgoingDurationSeconds: 321,
        },
        1.75,
        246,
      ),
    ).toEqual({
      displayedTime: 1.75,
      displayedDuration: 246,
    });
  });
});
