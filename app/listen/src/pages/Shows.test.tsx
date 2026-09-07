import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { useApi } from "@/hooks/use-api";

import { Shows } from "./Shows";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async () => ({ ok: true })),
  };
});

const UPCOMING_RESPONSE = {
  items: [
    {
      id: 1,
      type: "show",
      date: "2030-04-12",
      artist: "High Vis",
      artist_id: 12,
      artist_slug: "high-vis",
      title: "Sala Radar",
      subtitle: "Madrid, Spain",
      cover_url: null,
      status: "onsale",
      time: "20:00",
      venue: "Sala Radar",
      address_line1: "Calle del Ruido, 12",
      city: "Madrid",
      country: "Spain",
      genres: ["hardcore", "post-hardcore"],
      probable_setlist: [{ title: "Talk for Hours" }],
      is_upcoming: true,
      user_attending: true,
    },
    {
      id: 2,
      type: "release",
      date: "2030-05-01",
      artist: "Dredg",
      artist_id: 13,
      artist_slug: "dredg",
      title: "Future LP",
      subtitle: "Album",
      cover_url: null,
      status: "announced",
      album_id: 22,
      tidal_url: "https://example.com/future-lp",
      is_upcoming: true,
    },
  ],
  insights: [],
  summary: {
    followed_artists: 8,
    show_count: 3,
    release_count: 2,
    attending_count: 1,
    insight_count: 0,
  },
};

const mockUseApi = vi.mocked(useApi);

const GENRE_DETAIL_RESPONSE = {
  id: 18,
  name: "hardcore",
  slug: "hardcore",
  canonical_slug: "hardcore-punk",
  artists: [],
  albums: [],
  shows: [
    {
      id: 10,
      type: "show",
      date: "2030-07-03",
      artist: "Converge",
      artist_id: 1,
      artist_slug: "converge",
      title: "Circolo Magnolia",
      subtitle: "Segrate, Italy",
      cover_url: null,
      status: "onsale",
      venue: "Circolo Magnolia",
      city: "Segrate",
      country: "Italy",
      genres: ["hardcore"],
      is_upcoming: true,
    },
  ],
};

describe("Shows page", () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: UPCOMING_RESPONSE,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("brands the upcoming surface as Radar", () => {
    renderWithListenProviders(<Shows />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Radar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Upcoming")).not.toBeInTheDocument();
    expect(screen.queryByText("Show prep")).not.toBeInTheDocument();
    expect(screen.queryByText("Attending soon")).not.toBeInTheDocument();
    expect(
      screen.getByText(/shows, releases, and signals from artists you follow/i),
    ).toBeInTheDocument();
  });

  it("localizes the Radar chrome", () => {
    renderWithListenProviders(<Shows />, { locale: "es" });

    expect(
      screen.getByText(
        /Conciertos, lanzamientos y señales de artistas que sigues/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Artistas seguidos")).toBeInTheDocument();
    expect(screen.getByText("Próximo concierto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todo" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Conciertos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Filtra por artista, sala o ciudad..."),
    ).toBeInTheDocument();
  });

  it("keeps the summary metrics out of the default mobile flow", () => {
    renderWithListenProviders(<Shows />);

    const summary = screen.getByRole("list", { name: "Radar summary" });
    expect(summary).toHaveClass("hidden", "md:flex");
    expect(screen.getByText("Followed artists")).toBeInTheDocument();
    expect(screen.getByText("Attending")).toBeInTheDocument();
    expect(screen.queryByText("Insights")).not.toBeInTheDocument();
  });

  it("explains when followed artists have no current Radar signals", () => {
    mockUseApi.mockReturnValue({
      data: {
        items: [],
        insights: [],
        summary: {
          followed_artists: 1,
          show_count: 0,
          release_count: 0,
          attending_count: 0,
          insight_count: 0,
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Shows />);

    expect(screen.getByText("No new Radar signals yet")).toBeInTheDocument();
  });

  it("uses one expanded show card as the next show source of truth", () => {
    renderWithListenProviders(<Shows />);

    expect(screen.getByText("Next show")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute(
      "href",
      expect.stringContaining("maps"),
    );
    expect(screen.getByTitle("hardcore")).toBeInTheDocument();
  });

  it("keeps release rows focused on date, countdown, and album access", () => {
    renderWithListenProviders(<Shows />);

    expect(screen.queryByText("announced")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      expect.stringContaining("future-lp"),
    );
    expect(
      screen.queryByRole("link", { name: "Source" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/days to go/i)).toBeInTheDocument();
  });

  it("uses genre shows when Radar is opened from a genre page", () => {
    mockUseApi.mockImplementation((url: string | null) => {
      if (url === "/api/genres/hardcore?view=genre-detail-v5") {
        return {
          data: GENRE_DETAIL_RESPONSE,
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: {
          items: [],
          insights: [],
          summary: {
            followed_artists: 0,
            show_count: 0,
            release_count: 0,
            attending_count: 0,
            insight_count: 0,
          },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    renderWithListenProviders(<Shows />, {
      route: "/upcoming?genre=hardcore",
      path: "/upcoming",
    });

    expect(screen.getByText("Converge")).toBeInTheDocument();
    expect(screen.getByText("Circolo Magnolia")).toBeInTheDocument();
    expect(
      screen.queryByText("Follow some artists to unlock Radar"),
    ).not.toBeInTheDocument();
  });
});
