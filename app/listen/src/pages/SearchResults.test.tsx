import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
  };
});

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: vi.fn(() => false),
    toggleTrackLike: vi.fn(async () => false),
  }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: vi.fn(() => false),
    toggleArtistFollow: vi.fn(async () => false),
  }),
}));

import { api, ApiError } from "@/lib/api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { SearchResults } from "./SearchResults";

describe("SearchResults", () => {
  it("offers a functional search form when opened without a query", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });
    const user = userEvent.setup();
    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search",
    });

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    const surface = screen
      .getByRole("heading", { name: "Search" })
      .closest(".shadow-card");
    expect(surface).not.toBeNull();
    expect(surface).toHaveClass("shadow-card");
    await user.type(input, "Converge");
    expect(screen.getByRole("button", { name: "Search" })).toHaveClass(
      "shadow-action",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(screen.getByText('Results for "Converge"')).toBeInTheDocument();
    });
  });

  it("shows a helpful empty state when no music matches the query", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=imaginary-band",
    });

    await waitFor(() => {
      expect(screen.getByText("No music found")).toBeInTheDocument();
    });
    expect(api).toHaveBeenCalledWith(
      "/api/catalog/search?q=imaginary-band&limit=50",
      "GET",
      undefined,
      expect.any(Object),
    );
    expect(
      screen.getByText("Try another artist, album, or track."),
    ).toBeInTheDocument();
  });

  it("localizes the empty search state", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=banda-imaginaria",
      locale: "es",
    });

    await waitFor(() => {
      expect(screen.getByText("No se encontró música")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Prueba con otro artista, álbum o canción."),
    ).toBeInTheDocument();
  });

  it("shows an error state instead of no results when search fails", async () => {
    vi.mocked(api).mockRejectedValue(new ApiError(401, "Not authenticated"));

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=high-vis",
    });

    await waitFor(() => {
      expect(screen.getByText("Search unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("No music found")).not.toBeInTheDocument();
  });

  it("renders global catalog tracks as playable rows", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [
        {
          title: "Travel by Telephone",
          artist: "Rival Schools",
          album: "United By Fate",
          album_entity_uid: "album-entity-1",
          global_track_uid: "track-global-1",
          global_album_uid: "album-global-1",
          availability: { catalog: true, stream: true, import: false },
        },
      ],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=rival-schools",
    });

    await waitFor(() => {
      expect(screen.getByText("Travel by Telephone")).toBeInTheDocument();
    });
    expect(screen.getByTitle("Play Travel by Telephone")).toBeInTheDocument();
    expect(screen.queryByText("Remote")).not.toBeInTheDocument();
  });

  it("renders global artists and albums without federation labels", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [
        {
          name: "Rival Schools",
          global_artist_uid: "artist-global-1",
        },
      ],
      albums: [
        {
          name: "United By Fate",
          artist: "Rival Schools",
          year: "2001",
          has_cover: true,
          global_album_uid: "album-global-1",
        },
      ],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=rival-schools",
    });

    await waitFor(() => {
      expect(screen.getByText("Rival Schools")).toBeInTheDocument();
      expect(screen.getByText("United By Fate")).toBeInTheDocument();
    });
    expect(screen.queryByText("Remote")).not.toBeInTheDocument();
    expect(screen.getByAltText("United By Fate")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/catalog/albums/album-global-1/cover"),
    );
  });

  it("renders global artist photos when catalog reports a photo", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [
        {
          name: "Rival Schools",
          global_artist_uid: "artist-global-1",
          has_photo: true,
        },
      ],
      albums: [],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=rival-schools",
    });

    await waitFor(() => {
      expect(screen.getByText("Rival Schools")).toBeInTheDocument();
    });
    expect(screen.getByAltText("Rival Schools")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/catalog/artists/artist-global-1/photo"),
    );
    expect(screen.queryByText("Remote")).not.toBeInTheDocument();
  });

  it("renders global catalog results as one transparent collection", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [
        {
          name: "High Vis",
          global_artist_uid: "artist-global-1",
          entity_uid: "artist-global-1",
        },
      ],
      albums: [
        {
          name: "Blending",
          artist: "High Vis",
          year: "2022",
          has_cover: true,
          global_album_uid: "album-global-1",
          entity_uid: "album-global-1",
        },
      ],
      tracks: [
        {
          title: "Talk For Hours",
          artist: "High Vis",
          album: "Blending",
          globalTrackUid: "track-global-1",
          global_album_uid: "album-global-1",
          entity_uid: "track-global-1",
          album_entity_uid: "album-global-1",
          availability: {
            catalog: true,
            stream: true,
            import: false,
            local: false,
            remote: true,
            healthy: true,
          },
        },
      ],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=high-vis",
    });

    await waitFor(() => {
      expect(screen.getByText("High Vis")).toBeInTheDocument();
      expect(screen.getAllByText("Blending").length).toBeGreaterThan(0);
      expect(screen.getByText("Talk For Hours")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /High Vis/i })).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(
      links.find(
        (link) => link.getAttribute("href") === "/artists/high-vis/blending",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Remote")).not.toBeInTheDocument();
  });

  it("links local catalog albums through local human routes even when they have global uids", async () => {
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [
        {
          id: 3,
          name: "Gris Klein",
          artist: "Birds In Row",
          has_cover: true,
          global_album_uid: "785621b5-738e-5922-b6e3-108984976091",
          entity_uid: "904e7879-9549-5f49-81c0-59843a562968",
        },
      ],
      tracks: [],
    });

    renderWithListenProviders(<SearchResults />, {
      path: "/search",
      route: "/search?q=gris-klein",
    });

    await waitFor(() => {
      expect(screen.getByText("Gris Klein")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Gris Klein/i })).toHaveAttribute(
      "href",
      "/artists/birds-in-row/gris-klein",
    );
  });
});
