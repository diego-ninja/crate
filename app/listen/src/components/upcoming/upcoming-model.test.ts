import { describe, expect, it } from "vitest";

import { artistShowToUpcomingItem, itemKey } from "@/components/upcoming/upcoming-model";

describe("upcoming model", () => {
  it("preserves the original artist show event id for expansion keys", () => {
    const item = artistShowToUpcomingItem({
      id: "show-high-vis-99",
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
    });

    expect(item.event_key).toBe("show-high-vis-99");
    expect(itemKey(item, 0)).toBe("show-high-vis-99");
  });
});
