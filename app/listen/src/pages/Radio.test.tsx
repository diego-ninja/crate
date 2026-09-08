import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { cacheClear } from "@/lib/cache";
import { checkDiscoveryAvailable, startShapedRadio } from "@/lib/radio";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { RadioPage } from "./Radio";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock("@/lib/radio", () => ({
  checkDiscoveryAvailable: vi.fn(),
  startShapedRadio: vi.fn(),
}));

describe("RadioPage", () => {
  beforeEach(() => {
    cacheClear();
    vi.mocked(api).mockReset();
    vi.mocked(checkDiscoveryAvailable).mockResolvedValue(true);
    vi.mocked(startShapedRadio).mockResolvedValue({
      sessionId: "radio-session-1",
      seedLabel: "hardcore",
      tracks: [],
      source: {
        type: "radio",
        name: "hardcore Radio",
        radio: {
          seedType: "genre",
          seedId: "hardcore",
          shapedSessionId: "radio-session-1",
        },
      },
    });
    vi.mocked(api).mockImplementation(async (url) => {
      if (url === "/api/radio/stations") {
        return {
          artist_stations: [
            {
              type: "artist",
              seed_type: "artist",
              seed_value: "7",
              seed_label: "Converge",
              seed_subtitle: "Artist",
              artist_id: 7,
              artist_name: "Converge",
              title: "Converge Radio",
              subtitle: "",
              play_count: 44,
              minutes_listened: 180,
            },
          ],
          genre_stations: [
            {
              type: "genre",
              seed_type: "genre",
              seed_value: "hardcore",
              seed_label: "hardcore",
              seed_subtitle: "Genre",
              genre_slug: "hardcore",
              genre_name: "hardcore",
              cover_url: "/api/genres/hardcore/cover?size=640&format=webp",
              title: "hardcore Radio",
              subtitle: "",
              play_count: 88,
              minutes_listened: 320,
            },
          ],
        };
      }
      if (url === "/api/genres") return [];
      if (url.startsWith("/api/catalog/search"))
        return { artists: [], albums: [] };
      throw new Error(`Unexpected API call: ${url}`);
    });
  });

  it("renders personalized artist and genre station rails", async () => {
    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
    });

    expect(await screen.findByText("Converge")).toBeInTheDocument();
    expect(screen.getByText("Artist Stations")).toBeInTheDocument();
    expect(screen.getByText("Genre Stations")).toBeInTheDocument();
    expect(screen.getByText("hardcore")).toBeInTheDocument();
    expect(screen.queryByText("Based on your heavy rotation")).toBeNull();
  });

  it("consumes semantic classes for the radio surface", async () => {
    const { container } = renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
    });

    expect(await screen.findByText("Converge")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("radio-page");
    expect(container.querySelector(".radio-page-hero")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Converge/i })).toHaveClass(
      "radio-station-card",
    );
    expect(screen.getByRole("textbox")).toHaveClass("radio-seed-input");
  });

  it("localizes radio chrome", async () => {
    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
      locale: "es",
    });

    expect(await screen.findByText("Converge")).toBeInTheDocument();
    expect(screen.getByText("Radios de artistas")).toBeInTheDocument();
    expect(screen.getByText("Radios de géneros")).toBeInTheDocument();
    expect(
      screen.getByText("Empezar desde cualquier cosa"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        "Busca un artista, género o álbum para iniciar la radio...",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Radio de artista")).toBeInTheDocument();
  });

  it("starts seeded genre radio from a genre station", async () => {
    const playAll = vi.fn();

    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
      playerActions: { playAll },
    });

    fireEvent.click(await screen.findByRole("button", { name: /hardcore/i }));

    await waitFor(() => {
      expect(startShapedRadio).toHaveBeenCalledWith(
        "seeded",
        "genre",
        "hardcore",
      );
    });
    expect(playAll).toHaveBeenCalled();
  });

  it("starts remote artist radio with the global artist seed", async () => {
    const playAll = vi.fn();
    vi.mocked(api).mockImplementation(async (url) => {
      if (url === "/api/radio/stations") {
        return {
          artist_stations: [
            {
              type: "artist",
              seed_type: "artist",
              seed_value: "global-high-vis",
              seed_label: "High Vis",
              seed_subtitle: "Artist",
              artist_id: null,
              global_artist_uid: "global-high-vis",
              artist_name: "High Vis",
              title: "High Vis Radio",
              subtitle: "",
              play_count: 7,
              minutes_listened: 31,
            },
          ],
          genre_stations: [],
        };
      }
      if (url === "/api/genres") return [];
      if (url.startsWith("/api/catalog/search"))
        return { artists: [], albums: [] };
      throw new Error(`Unexpected API call: ${url}`);
    });

    renderWithListenProviders(<RadioPage />, {
      route: "/radio",
      path: "/radio",
      playerActions: { playAll },
    });

    fireEvent.click(await screen.findByRole("button", { name: /High Vis/i }));

    await waitFor(() => {
      expect(startShapedRadio).toHaveBeenCalledWith(
        "seeded",
        "artist",
        "global-high-vis",
      );
    });
    expect(playAll).toHaveBeenCalled();
  });
});
