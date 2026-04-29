import { describe, expect, it } from "vitest";

import { hasTrackReference, toTrackReferencePayload } from "@/lib/track-reference";

describe("track reference helpers", () => {
  it("drops legacy storage ids when an entity uid exists", () => {
    expect(
      toTrackReferencePayload({
        id: 12,
        entity_uid: "track-entity-12",
        title: "Track One",
        artist: "Artist",
        album: "Album",
        duration: 123,
        path: "/music/artist/album/01.flac",
      }),
    ).toEqual({
      track_id: 12,
      entity_uid: "track-entity-12",
      title: "Track One",
      artist: "Artist",
      album: "Album",
      duration: 123,
      path: "/music/artist/album/01.flac",
    });
  });

  it("accepts path references when no canonical identity is available", () => {
    expect(hasTrackReference({
      path: "/music/artist/album/02.flac",
    })).toBe(true);

    expect(hasTrackReference({})).toBe(false);
  });
});
