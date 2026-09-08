import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NormalizedShow } from "./show-types";
import { ShowCard } from "./ShowCard";

const show: NormalizedShow = {
  id: 42,
  date: "2026-09-12",
  time: "20:00",
  venue: "The Forum",
  addressLine1: "1 High Street",
  city: "London",
  region: "England",
  postalCode: "NW1",
  country: "United Kingdom",
  url: "https://tickets.example/show-42",
  status: "onsale",
  title: "The Forum",
  primaryArtist: { name: "Converge", id: 7, slug: "converge" },
  lineupArtists: [{ name: "Converge", id: 7, slug: "converge" }],
  genres: ["hardcore"],
  coverUrl: "",
  artistPhotoUrl: "",
  backgroundUrl: "",
};

describe("ShowCard surface shadows", () => {
  it("uses the semantic card shadow for a static show", () => {
    render(<ShowCard show={show} />);

    expect(screen.getByText("Converge").closest(".shadow-card")).toHaveClass(
      "shadow-card",
    );
  });

  it("uses the semantic accent card shadow for an expanded show", () => {
    render(<ShowCard show={show} expanded onToggle={vi.fn()} />);

    expect(
      screen.getByText("Converge").closest(".shadow-accent-action-card"),
    ).toHaveClass("shadow-accent-action-card");
  });
});
