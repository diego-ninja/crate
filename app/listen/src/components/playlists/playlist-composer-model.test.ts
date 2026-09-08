import { describe, expect, it } from "vitest";

import {
  getTrackKey,
  initialPlaylistComposerState,
  playlistComposerReducer,
  searchTrackKey,
  toComposerTrack,
} from "@/components/playlists/playlist-composer-model";

describe("playlist composer model", () => {
  it("uses the most stable available identity for tracks", () => {
    expect(
      getTrackKey({
        globalTrackUid: "global-1",
        entityUid: "entity-1",
        title: "Track",
        artist: "Artist",
      }),
    ).toBe("global:global-1");
    expect(
      getTrackKey({
        entityUid: "entity-1",
        title: "Track",
        artist: "Artist",
      }),
    ).toBe("entity:entity-1");
    expect(
      getTrackKey({
        libraryTrackId: 42,
        title: "Track",
        artist: "Artist",
      }),
    ).toBe("id:42");
  });

  it("normalizes catalog search results into composer tracks", () => {
    expect(
      toComposerTrack({
        id: 42,
        global_track_uid: "global-1",
        entity_uid: "entity-1",
        title: "Track",
        artist: "Artist",
        album: "Album",
        duration: 180,
        path: "/music/track.flac",
      }),
    ).toEqual({
      globalTrackUid: "global-1",
      entityUid: "entity-1",
      libraryTrackId: 42,
      path: "/music/track.flac",
      title: "Track",
      artist: "Artist",
      album: "Album",
      duration: 180,
    });
    expect(
      searchTrackKey({
        id: "remote-1",
        global_uid: "global-1",
        title: "Track",
        artist: "Artist",
        album: "Album",
        duration: 180,
      }),
    ).toBe("global:global-1");
  });

  it("adds tracks only once and preserves explicit removal", () => {
    const track = {
      entityUid: "entity-1",
      title: "Track",
      artist: "Artist",
    };
    const added = playlistComposerReducer(initialPlaylistComposerState, {
      type: "add-track",
      value: track,
    });
    const deduplicated = playlistComposerReducer(added, {
      type: "add-track",
      value: track,
    });
    expect(deduplicated.tracks).toEqual([track]);

    expect(
      playlistComposerReducer(deduplicated, {
        type: "remove-track",
        key: "entity:entity-1",
      }).tracks,
    ).toEqual([]);
  });

  it("resets the composer from the modal inputs", () => {
    const track = { title: "Track", artist: "Artist" };
    expect(
      playlistComposerReducer(initialPlaylistComposerState, {
        type: "reset",
        initialName: "Roadtrip",
        initialDescription: "Late-night set",
        initialCoverDataUrl: "data:image/png;base64,cover",
        initialVisibility: "public",
        initialCollaborative: true,
        initialTracks: [track],
      }),
    ).toMatchObject({
      name: "Roadtrip",
      description: "Late-night set",
      coverDataUrl: "data:image/png;base64,cover",
      visibility: "public",
      isCollaborative: true,
      tracks: [track],
    });
  });
});
