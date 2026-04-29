import { describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: apiMock,
  };
});

import { buildTrackMenuPlayerTrack, fetchAlbumTracks, trackToMenuData } from "@/components/actions/shared";

describe("track action shared helpers", () => {
  it("builds a playable track preserving quality metadata and derived cover", () => {
    const track = buildTrackMenuPlayerTrack({
      id: 12,
      entity_uid: "entity-12",
      title: "Track One",
      artist: "Artist",
      artist_id: 8,
      artist_slug: "artist",
      album: "Album",
      album_id: 44,
      album_slug: "album",
      path: "/music/Artist/Album/01-track.m4a",
      format: "m4a",
      bitrate: 320,
      sample_rate: 44100,
      bit_depth: null,
    });

    expect(track).toEqual(expect.objectContaining({
      id: "entity-12",
      entityUid: "entity-12",
      storageId: undefined,
      albumCover: expect.stringContaining("/api/albums/44/cover"),
      format: "m4a",
      bitrate: 320,
      sampleRate: 44100,
      bitDepth: null,
    }));
  });

  it("converts player tracks back to menu data without losing suggestion metadata", () => {
    expect(trackToMenuData({
      id: "entity-55",
      entityUid: "entity-55",
      title: "Track Two",
      artist: "Artist",
      album: "Album",
      isSuggested: true,
      suggestionSource: "playlist",
      format: "flac",
      bitrate: 1411,
      sampleRate: 96000,
      bitDepth: 24,
    })).toEqual(expect.objectContaining({
      entity_uid: "entity-55",
      is_suggested: true,
      suggestion_source: "playlist",
      format: "flac",
      bitrate: 1411,
      sample_rate: 96000,
      bit_depth: 24,
    }));
  });

  it("maps fetched album tracks into playable tracks with quality fields", async () => {
    apiMock.mockResolvedValueOnce({
      artist: "Artist",
      name: "Album",
      display_name: "Album",
      tracks: [{
        id: 7,
        entity_uid: "entity-7",
        filename: "01-track.flac",
        path: "/music/Artist/Album/01-track.flac",
        length_sec: 211,
        format: "flac",
        bitrate: 1411,
        sample_rate: 96000,
        bit_depth: 24,
        tags: { title: "Track Seven" },
      }],
    });

    const tracks = await fetchAlbumTracks({
      artist: "Artist",
      album: "Album",
      albumId: 77,
      albumSlug: "album",
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(tracks).toEqual([
      expect.objectContaining({
        id: "entity-7",
        entityUid: "entity-7",
        storageId: undefined,
        title: "Track Seven",
        albumId: 77,
        albumSlug: "album",
        format: "flac",
        bitrate: 1411,
        sampleRate: 96000,
        bitDepth: 24,
      }),
    ]);
  });
});
