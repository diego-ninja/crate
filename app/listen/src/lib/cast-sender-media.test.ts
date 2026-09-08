import { describe, expect, it } from "vitest";

import { buildCastTicketRequest } from "./cast-sender-media";

describe("cast sender media", () => {
  it("prefers the stable library entity reference for ticket requests", () => {
    expect(
      buildCastTicketRequest({
        id: "track",
        entityUid: "track-entity",
        title: "Track",
        artist: "Artist",
      }),
    ).toMatchObject({
      purpose: "google_cast",
      track_entity_uid: "track-entity",
      delivery: "auto",
    });
  });
});
