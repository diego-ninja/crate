import { describe, expect, it } from "vitest";

import type { PlaySource, Track } from "@/contexts/player-types";
import {
  collectUniqueTracks,
  getPlaySourceSignature,
} from "./playback-intelligence-model";

const TRACK_A: Track = { id: "a", title: "A", artist: "Artist" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Artist" };

describe("playback intelligence model", () => {
  it("builds a stable source signature from radio identity", () => {
    const source: PlaySource = {
      type: "album",
      name: "Album",
      radio: { seedType: "album", seedId: 42 },
    };

    expect(getPlaySourceSignature(source)).toBe(
      "album::Album::album::42::::::::",
    );
  });

  it("uses the legacy storage id only when there is no entity identity", () => {
    const source: PlaySource = {
      type: "track",
      name: "Track",
      radio: {
        seedType: "track",
        seedStorageId: "legacy-track",
      },
    };

    expect(getPlaySourceSignature(source)).toContain("legacy-track");
  });

  it("removes queue and recent duplicates while preserving candidate order", () => {
    expect(collectUniqueTracks([TRACK_A, TRACK_B], [TRACK_A], [])).toEqual([
      TRACK_B,
    ]);
    expect(collectUniqueTracks([TRACK_A, TRACK_B], [], [TRACK_A])).toEqual([
      TRACK_B,
    ]);
  });
});
