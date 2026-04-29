import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`API ${status}`);
      this.status = status;
    }
  },
}));

vi.mock("@/lib/library-routes", () => ({
  albumCoverApiUrl: vi.fn(() => undefined),
  artistPhotoApiUrl: vi.fn(() => undefined),
}));

import { api } from "@/lib/api";
import { fetchArtistRadio, fetchHomePlaylistRadio, fetchRadioContinuation } from "@/lib/radio";
import type { PlaySource } from "@/contexts/player-types";

const mockApi = vi.mocked(api);

describe("fetchRadioContinuation", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("uses the shaped radio session endpoint when a session is active", async () => {
    mockApi.mockResolvedValue({
      session_id: "sess-1",
      tracks: [
        {
          track_id: 42,
          entity_uid: "123e4567-e89b-12d3-a456-426614174042",
          storage_id: "track-42",
          title: "Axe to Fall",
          artist: "Converge",
          album: "Axe to Fall",
          album_id: 7,
          distance: 0.12,
        },
      ],
    });

    const controller = new AbortController();
    const source: PlaySource = {
      type: "radio",
      name: "Discovery Radio",
      radio: {
        seedType: "discovery",
        shapedSessionId: "sess-1",
      },
    };

    const tracks = await fetchRadioContinuation(source, 12, { signal: controller.signal });

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/next",
      "POST",
      { session_id: "sess-1", count: 12 },
      { signal: controller.signal },
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174042",
      entityUid: "123e4567-e89b-12d3-a456-426614174042",
      libraryTrackId: 42,
      title: "Axe to Fall",
      artist: "Converge",
    });
  });

  it("falls back to legacy track continuation by entity UID when present", async () => {
    mockApi.mockResolvedValue({
      session: {
        type: "track",
        seed: {
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
        },
      },
      tracks: [
        {
          track_id: 7,
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
          title: "Locust Reign",
          artist: "Converge",
          album: "Petitioning the Empty Sky",
        },
      ],
    });

    const source: PlaySource = {
      type: "radio",
      name: "Track Radio",
      radio: {
        seedType: "track",
        seedEntityUid: "123e4567-e89b-12d3-a456-426614174000",
      },
    };

    const tracks = await fetchRadioContinuation(source, 9);

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=9&entity_uid=123e4567-e89b-12d3-a456-426614174000",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174000",
      entityUid: "123e4567-e89b-12d3-a456-426614174000",
      libraryTrackId: 7,
    });
  });

  it("treats string UUID seed ids as entity UIDs for legacy continuations", async () => {
    mockApi.mockResolvedValue({
      session: { type: "track" },
      tracks: [
        {
          track_id: 7,
          track_entity_uid: "123e4567-e89b-12d3-a456-426614174000",
          title: "Locust Reign",
          artist: "Converge",
          album: "Petitioning the Empty Sky",
        },
      ],
    });

    const source: PlaySource = {
      type: "radio",
      name: "Track Radio",
      radio: {
        seedType: "track",
        seedId: "123e4567-e89b-12d3-a456-426614174000",
      },
    };

    const tracks = await fetchRadioContinuation(source, 9);

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/track?limit=9&entity_uid=123e4567-e89b-12d3-a456-426614174000",
      "GET",
      undefined,
      { signal: undefined },
    );
    expect(tracks[0]).toMatchObject({
      id: "123e4567-e89b-12d3-a456-426614174000",
      entityUid: "123e4567-e89b-12d3-a456-426614174000",
    });
  });
});

describe("seeded radio wrappers", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("starts artist radio via the shaped radio session endpoint", async () => {
    mockApi.mockResolvedValue({
      session_id: "artist-sess",
      seed_label: "Converge",
      tracks: [],
    });

    const result = await fetchArtistRadio(7, "Converge");

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      {
        mode: "seeded",
        seed_type: "artist",
        seed_value: "7",
      },
      { signal: undefined },
    );
    expect(result.source.radio).toMatchObject({
      seedType: "artist",
      seedId: 7,
      shapedSessionId: "artist-sess",
    });
  });

  it("starts home playlist radio via the shaped radio session endpoint", async () => {
    mockApi.mockResolvedValue({
      session_id: "home-sess",
      seed_label: "Daily Discovery",
      tracks: [],
    });

    const result = await fetchHomePlaylistRadio({
      playlistId: "daily-discovery",
      playlistName: "Daily Discovery",
    });

    expect(mockApi).toHaveBeenCalledWith(
      "/api/radio/start",
      "POST",
      {
        mode: "seeded",
        seed_type: "home-playlist",
        seed_value: "daily-discovery",
      },
      { signal: undefined },
    );
    expect(result.source.radio).toMatchObject({
      seedType: "home-playlist",
      seedId: "daily-discovery",
      shapedSessionId: "home-sess",
    });
  });
});
