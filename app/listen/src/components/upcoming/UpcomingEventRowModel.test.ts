import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import {
  buildUpcomingEventRowModel,
  type UpcomingEventRowModel,
} from "./upcoming-event-row-model";
import type { UpcomingItem } from "./upcoming-model";

const translate = ((key: string) => key) as TFunction;

const release: UpcomingItem = {
  type: "release",
  date: "2030-01-20",
  time: "20:00",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  album_id: 42,
  album_slug: "no-heroes",
  title: "No Heroes",
  subtitle: "Album",
  cover_url: null,
  status: "announced",
  is_upcoming: true,
};

describe("buildUpcomingEventRowModel", () => {
  it("derives release navigation, label and countdown presentation", () => {
    const model: UpcomingEventRowModel = buildUpcomingEventRowModel(
      release,
      "en-US",
      translate,
    );

    expect(model.albumPath).toContain("no-heroes");
    expect(model.artistPath).toContain("converge");
    expect(model.badgeLabel).toBe("radar.release.preRelease");
    expect(model.dateLabel).toContain("Jan");
    expect(model.countdown).toMatchObject({ unit: "days" });
  });

  it("does not expose release actions for a show", () => {
    const show: UpcomingItem = {
      ...release,
      type: "show",
      title: "The Forum",
      subtitle: "London",
      album_id: undefined,
      album_slug: undefined,
    };

    const model = buildUpcomingEventRowModel(show, "en-US", translate);

    expect(model.albumPath).toBeNull();
    expect(model.artistPath).toContain("converge");
  });
});
