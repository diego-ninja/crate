import { describe, expect, it } from "vitest";

import type { Track } from "@/contexts/player-types";
import { selectUniqueTracks } from "./use-player-intelligence-actions";

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: "Artist",
});

describe("selectUniqueTracks", () => {
  it("excludes tracks already present and de-duplicates candidates", () => {
    const existing = [track("existing")];

    expect(
      selectUniqueTracks(
        [track("existing"), track("new"), track("new")],
        existing,
      ).map((candidate) => candidate.id),
    ).toEqual(["new"]);
  });

  it("uses cache identity when the same track has a different object shape", () => {
    const existing: Track[] = [{ ...track("library"), title: "Original" }];

    expect(
      selectUniqueTracks([{ ...track("library"), title: "Updated" }], existing),
    ).toEqual([]);
  });
});
