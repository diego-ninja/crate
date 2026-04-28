import { describe, expect, it } from "vitest";

import { resolvePlayableTrackId, toPlayableTrack } from "@/lib/playable-track";

describe("playable track mapper", () => {
  it("normalizes snake_case API payloads into player tracks", () => {
    const track = toPlayableTrack({
      id: 12,
      storage_id: "storage-12",
      title: "Track One",
      artist: "Artist",
      artist_id: 4,
      artist_slug: "artist",
      album: "Album",
      album_id: 8,
      album_slug: "album",
      path: "/music/artist/album/01.flac",
      format: "flac",
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
    }, { cover: "/api/albums/8/cover" });

    expect(track).toEqual(expect.objectContaining({
      id: "storage-12",
      storageId: "storage-12",
      artistId: 4,
      artistSlug: "artist",
      albumId: 8,
      albumSlug: "album",
      albumCover: "/api/albums/8/cover",
      format: "flac",
      bitrate: 1411,
      sampleRate: 44100,
      bitDepth: 16,
    }));
  });

  it("preserves camelCase metadata and resolves a stable playback id", () => {
    expect(resolvePlayableTrackId({
      id: "fallback-id",
      storageId: "storage-99",
      title: "Track Two",
      artist: "Artist",
    })).toBe("storage-99");

    const track = toPlayableTrack({
      id: "fallback-id",
      storageId: "storage-99",
      title: "Track Two",
      artist: "Artist",
      sampleRate: 48000,
      bitDepth: null,
      bitrate: 320,
      format: "aac",
    });

    expect(track).toEqual(expect.objectContaining({
      id: "storage-99",
      sampleRate: 48000,
      bitDepth: null,
      bitrate: 320,
      format: "aac",
    }));
  });
});
