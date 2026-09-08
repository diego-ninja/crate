import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { HomeUpcomingSection } from "@/components/home/HomeUpcomingSections";
import type { HomeUpcomingItem } from "@/components/home/home-model";
import { I18nProvider } from "@/i18n";

const PREVIEW_ITEMS: HomeUpcomingItem[] = [
  {
    id: 1,
    type: "show",
    date: "2030-04-12",
    artist: "High Vis",
    artist_id: 12,
    artist_slug: "high-vis",
    title: "Sala Radar",
    subtitle: "Madrid, Spain",
    venue: "Sala Radar",
    is_upcoming: true,
  },
];

const MULTIPLE_PREVIEW_ITEMS: HomeUpcomingItem[] = [
  {
    type: "release",
    date: "2030-04-12",
    artist: "Artist One",
    title: "First release",
    subtitle: "Album",
    is_upcoming: true,
  },
  {
    type: "show",
    date: "2030-04-20",
    artist: "Artist Two",
    title: "Sala Radar",
    subtitle: "Madrid, Spain",
    is_upcoming: true,
  },
  {
    type: "release",
    date: "2030-05-01",
    artist: "Artist Three",
    title: "Third release",
    subtitle: "Album",
    is_upcoming: true,
  },
];

describe("HomeUpcomingSection", () => {
  it("uses Radar as the visible destination name", () => {
    const { container } = renderWithRouter(
      <HomeUpcomingSection
        previewItems={PREVIEW_ITEMS}
        summary={{
          followed_artists: 1,
          show_count: 1,
          release_count: 0,
          attending_count: 0,
          insight_count: 0,
        }}
        onOpenUpcoming={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Radar" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Radar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
    expect(
      container.querySelector(".home-upcoming-feature"),
    ).toBeInTheDocument();
    expect(container.querySelector(".home-upcoming-panel")).toBeInTheDocument();
  });

  it("does not repeat the featured event in the next-up list", () => {
    renderWithRouter(
      <HomeUpcomingSection
        previewItems={MULTIPLE_PREVIEW_ITEMS}
        onOpenUpcoming={vi.fn()}
      />,
    );

    expect(screen.getAllByText("First release")).toHaveLength(1);
    expect(screen.getByText("Third release")).toBeInTheDocument();
  });

  it("keeps the Radar rail visible when there are no upcoming events", () => {
    renderWithRouter(
      <HomeUpcomingSection previewItems={[]} onOpenUpcoming={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Radar" })).toBeInTheDocument();
    expect(
      screen.getByText("Follow some artists to unlock Radar"),
    ).toBeInTheDocument();
  });
});

function renderWithRouter(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="en">{ui}</I18nProvider>
    </MemoryRouter>,
  );
}
