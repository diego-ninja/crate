import { describe, expect, it } from "vitest";

import { buildArtistShowItems } from "@/components/artist/artist-model";

describe("artist show model", () => {
  it("deduplicates repeated artist show events before rendering", () => {
    const items = buildArtistShowItems([
      {
        id: "show-99",
        show_id: 99,
        artist_name: "High Vis",
        artist_id: 52,
        artist_slug: "high-vis",
        date: "2026-07-31",
        local_time: "19:00",
        venue: "Grant Park",
        city: "Chicago",
        country: "USA",
        country_code: "US",
      },
      {
        id: "show-99",
        show_id: 99,
        artist_name: "High Vis",
        artist_id: 52,
        artist_slug: "high-vis",
        date: "2026-07-31",
        local_time: "19:00",
        venue: "Grant Park",
        city: "Chicago",
        country: "USA",
        country_code: "US",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.event_key).toBe("show-99");
  });
});
