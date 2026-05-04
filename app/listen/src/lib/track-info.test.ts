import { describe, expect, it } from "vitest";

import { mergeTrackQualityParts, resolveTrackInfoUrl } from "./track-info";

describe("resolveTrackInfoUrl", () => {
  it("prefers entity_uid over legacy ids when available", () => {
    expect(
      resolveTrackInfoUrl({
        id: "42",
        entityUid: "entity-42",
        libraryTrackId: 42,
        path: "Artist/Album/Track.flac",
      }),
    ).toBe("/api/tracks/by-entity/entity-42/info");
  });

  it("falls back to the library track id when entity_uid is missing", () => {
    expect(
      resolveTrackInfoUrl({
        id: "42",
        libraryTrackId: 42,
        path: "Artist/Album/Track.flac",
      }),
    ).toBe("/api/tracks/42/info");
  });
});

describe("mergeTrackQualityParts", () => {
  it("does not let a partial later source wipe out known lossless metadata", () => {
    expect(
      mergeTrackQualityParts(
        { format: "flac", bitrate: 1411, sampleRate: 44100, bitDepth: 16 },
        { format: "flac", bitrate: 1411, sampleRate: undefined, bitDepth: undefined },
      ),
    ).toEqual({
      format: "flac",
      bitrate: 1411,
      sampleRate: 44100,
      bitDepth: 16,
    });
  });
});
