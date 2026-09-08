import { describe, expect, it } from "vitest";

import { parseSyncedLyrics } from "@/components/player/useFullscreenPlayerLyrics";

describe("parseSyncedLyrics", () => {
  it("parses timestamps and trims lyric text", () => {
    expect(
      parseSyncedLyrics("[00:01.50] First line\n[02:03.25]  Second line  "),
    ).toEqual([
      { time: 1.5, text: "First line" },
      { time: 123.25, text: "Second line" },
    ]);
  });

  it("ignores lines without a supported timestamp", () => {
    expect(parseSyncedLyrics("intro\n[00:10.00] valid\n[bad] ignored")).toEqual(
      [{ time: 10, text: "valid" }],
    );
  });
});
