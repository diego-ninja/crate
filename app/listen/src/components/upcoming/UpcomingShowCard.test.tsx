import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { UpcomingShowCard } from "./UpcomingShowCard";
import type { UpcomingItem } from "./upcoming-model";

const item: UpcomingItem = {
  id: 42,
  event_key: "show-42",
  type: "show",
  date: "2026-09-12",
  time: "20:00",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "The Forum",
  subtitle: "London, United Kingdom",
  cover_url: null,
  status: "onsale",
  is_upcoming: true,
  url: "https://tickets.example/show-42",
  venue: "The Forum",
  city: "London",
  region: "England",
  country: "United Kingdom",
  genres: ["hardcore"],
  probable_setlist: [],
};

describe("UpcomingShowCard surface shadows", () => {
  it("uses semantic accent card shadows for expanded shows", () => {
    renderWithListenProviders(
      <UpcomingShowCard item={item} expanded onToggle={vi.fn()} />,
    );

    expect(
      screen.getByText("Converge").closest(".shadow-accent-action-card"),
    ).toHaveClass("shadow-accent-action-card");
  });

  it("uses the stronger semantic shadow for featured expanded shows", () => {
    renderWithListenProviders(
      <UpcomingShowCard item={item} expanded featured onToggle={vi.fn()} />,
    );

    expect(
      screen
        .getByText("Converge")
        .closest(".shadow-accent-action-card-featured"),
    ).toHaveClass("shadow-accent-action-card-featured");
  });
});
