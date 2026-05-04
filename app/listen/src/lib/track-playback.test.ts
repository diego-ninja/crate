import { describe, expect, it } from "vitest";

import { getTrackQualityFromPlaybackQuality, resolveTrackPlaybackUrl } from "@/lib/track-playback";

describe("track playback helpers", () => {
  it("builds original playback endpoints without a delivery query", () => {
    expect(resolveTrackPlaybackUrl({
      entityUid: "track-entity-1",
      libraryTrackId: 12,
      id: "12",
    }, "original")).toBe("/api/tracks/by-entity/track-entity-1/playback");
  });

  it("builds playback endpoints from canonical entity_uids", () => {
    expect(resolveTrackPlaybackUrl({
      entityUid: "track-entity-1",
      libraryTrackId: 12,
      id: "12",
    }, "balanced")).toBe("/api/tracks/by-entity/track-entity-1/playback?delivery=balanced");
  });

  it("prefers the codec when mapping delivery quality", () => {
    expect(getTrackQualityFromPlaybackQuality({
      format: "m4a",
      codec: "aac",
      bitrate: 192,
      sample_rate: 44100,
      bit_depth: null,
      bytes: null,
      lossless: false,
    }, { preferCodec: true })).toEqual({
      format: "aac",
      bitrate: 192,
      sampleRate: 44100,
      bitDepth: undefined,
    });
  });

  it("keeps the original container format for source quality", () => {
    expect(getTrackQualityFromPlaybackQuality({
      format: "flac",
      codec: null,
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
      bytes: null,
      lossless: true,
    })).toEqual({
      format: "flac",
      bitrate: 1411,
      sampleRate: 44100,
      bitDepth: 16,
    });
  });
});
