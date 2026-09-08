import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Library } from "@/pages/Library";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

let isDesktop = false;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({
    openCreatePlaylist: vi.fn(),
  }),
}));

vi.mock("@/components/cards/ArtistCard", () => ({
  ArtistCard: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/components/cards/AlbumCard", () => ({
  AlbumCard: ({ album }: { album: string }) => <div>{album}</div>,
}));

vi.mock("@/components/cards/TrackRow", () => ({
  TrackRow: ({ track }: { track: { title: string } }) => (
    <div>{track.title}</div>
  ),
}));

vi.mock("@/components/ui/WindowVirtualList", () => ({
  WindowVirtualList: <T,>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (item: T, index: number) => ReactNode;
  }) => <div>{items.map((item, index) => renderItem(item, index))}</div>,
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    likedTracks: [
      {
        track_id: 101,
        path: "artist/album/song.flac",
        relative_path: "artist/album/song.flac",
        liked_at: "2026-06-01T00:00:00Z",
        title: "Concubine",
        artist: "Converge",
        album: "Jane Doe",
        duration: 79,
      },
    ],
    loading: false,
  }),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn((url: string | null) => {
    if (url === "/api/me") {
      return {
        data: {
          followed_artists: 2,
          saved_albums: 3,
          liked_tracks: 4,
          playlists: 1,
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (url === "/api/me/playlists-page") {
      return {
        data: {
          playlists: [],
          followed_curated_playlists: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (url === "/api/catalog/me/artists") {
      return {
        data: [
          {
            artist_name: "Converge",
            artist_id: 1,
            global_artist_uid: "gartist-1",
            artist_entity_uid: "artist-1",
            artist_slug: "converge",
            created_at: "2026-06-01T00:00:00Z",
            album_count: 2,
            track_count: 24,
            has_photo: true,
            photo_url: "/api/catalog/artists/gartist-1/photo",
          },
        ],
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    if (url === "/api/catalog/me/albums") {
      return {
        data: [
          {
            saved_at: "2026-06-01T00:00:00Z",
            id: 10,
            global_album_uid: "galbum-10",
            album_entity_uid: "album-10",
            slug: "jane-doe",
            artist: "Converge",
            artist_id: 1,
            artist_entity_uid: "artist-1",
            artist_slug: "converge",
            name: "Jane Doe",
            year: "2001",
            has_cover: true,
            track_count: 12,
            total_duration: 2700,
          },
        ],
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    }

    return {
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  }),
}));

describe("Library", () => {
  beforeEach(() => {
    isDesktop = false;
  });

  it("renders the playlists collection section on mobile without tab pills", () => {
    renderLibrary();

    expect(
      screen.getByRole("heading", { name: "Collection" }),
    ).toBeInTheDocument();
    expect(screen.getByText("New Playlist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Playlist" })).toHaveClass(
      "library-new-playlist",
    );
    expect(
      screen.queryByRole("button", { name: /Playlists/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Artists/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bandcamp/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Contributions/i }),
    ).not.toBeInTheDocument();
  });

  it("localizes the collection landing on mobile", () => {
    renderLibrary("/library", "/library", "es");

    expect(
      screen.getByRole("heading", { name: "Colección" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nueva playlist" }),
    ).toBeInTheDocument();
  });

  it("renders dedicated mobile artist section with sort options", () => {
    renderLibrary("/collection/artists", "/collection/:section");

    expect(
      screen.getByRole("heading", { name: "Artists" }),
    ).toBeInTheDocument();
    const sortButton = screen.getByRole("button", {
      name: "Sort artists: Recently added",
    });
    expect(sortButton).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Name" }),
    ).not.toBeInTheDocument();

    fireEvent.click(sortButton);

    expect(screen.getByRole("listbox", { name: "Sort artists" })).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Recently added" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Name" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Popularity" }),
    ).toBeInTheDocument();
  });

  it("renders dedicated mobile album section with the custom sort dropdown", () => {
    renderLibrary("/collection/albums", "/collection/:section");

    expect(screen.getByRole("heading", { name: "Albums" })).toBeInTheDocument();
    const sortButton = screen.getByRole("button", {
      name: "Sort albums: Recently added",
    });

    fireEvent.click(sortButton);

    expect(screen.getByRole("listbox", { name: "Sort albums" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Artist" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Year" })).toBeInTheDocument();
  });

  it("renders liked tracks with the custom sort dropdown", () => {
    renderLibrary("/collection/liked", "/collection/:section");

    expect(
      screen.getByRole("heading", { name: "Liked tracks" }),
    ).toBeInTheDocument();
    const sortButton = screen.getByRole("button", {
      name: "Sort liked tracks: Recently added",
    });

    fireEvent.click(sortButton);

    expect(
      screen.getByRole("listbox", { name: "Sort liked tracks" }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Album" })).toBeInTheDocument();
  });

  it("keeps Bandcamp and Contributions visible on desktop", () => {
    isDesktop = true;

    renderLibrary();

    expect(
      screen.getByRole("heading", { name: "Your Library" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bandcamp/i })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Contributions/i }),
    ).toBeVisible();
  });
});

function renderLibrary(route = "/library", path = "/library", locale?: "es") {
  return renderWithListenProviders(<Library />, {
    path,
    route,
    locale,
  });
}
