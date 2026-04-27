import { describe, expect, it } from "vitest";

import { getTrackQualityBadge } from "@/components/player/bar/player-bar-utils";

describe("player quality badge mapping", () => {
  it("classifies AAC 320 tracks as high quality", () => {
    expect(getTrackQualityBadge({
      id: "storage-1",
      title: "Track One",
      artist: "Artist",
      format: "m4a",
      bitrate: 320,
      sampleRate: 44100,
      bitDepth: null,
    })).toEqual(expect.objectContaining({
      label: "AAC 320",
      tier: "high",
    }));
  });

  it("classifies 24-bit high-sample-rate FLAC as hi-res", () => {
    expect(getTrackQualityBadge({
      id: "storage-2",
      title: "Track Two",
      artist: "Artist",
      format: "flac",
      bitrate: 1411,
      sampleRate: 96000,
      bitDepth: 24,
    })).toEqual(expect.objectContaining({
      label: "Hi-Res 24/96",
      detail: "24-bit / 96 kHz",
      tier: "hi-res",
    }));
  });
});
