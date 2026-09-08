import { describe, expect, it } from "vitest";

import { toRadioTrack } from "./radio-model";

describe("radio model", () => {
  it("creates a playable track with a stable fallback identity", () => {
    const track = toRadioTrack({
      title: "Track",
      artist: "Artist",
      album: "Album",
    });

    expect(track).toMatchObject({
      id: "radio:Artist:Album:Track",
      title: "Track",
      artist: "Artist",
      album: "Album",
    });
  });
});
