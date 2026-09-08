import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { UpcomingEventRow } from "./UpcomingEventRow";

describe("UpcomingEventRow", () => {
  it("keeps release artwork in the same horizontal content row", () => {
    renderWithListenProviders(
      <UpcomingEventRow
        item={{
          type: "release",
          date: "2030-01-20",
          artist: "Converge",
          artist_id: 7,
          artist_slug: "converge",
          title: "No Heroes",
          subtitle: "Album",
          cover_url: null,
          status: "announced",
          is_upcoming: true,
          album_id: 42,
          album_slug: "no-heroes",
        }}
      />,
    );

    const article = document.querySelector("article");
    const contentRow = article?.querySelector<HTMLElement>(
      "div.relative.flex.flex-col",
    );
    const mainContent = contentRow?.querySelector<HTMLElement>(
      "div.flex.min-w-0.items-center.gap-4",
    );
    const artwork = article?.querySelector<HTMLElement>("div.relative.size-16");
    const atmosphere = article?.querySelector<HTMLElement>(
      ".upcoming-event-row-atmosphere",
    );

    expect(mainContent).toContainElement(artwork ?? null);
    expect(atmosphere?.parentElement).toBe(article);
  });
});
