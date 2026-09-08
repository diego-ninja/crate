import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { useApi } from "@/hooks/use-api";
import { fetchAlbumRadio } from "@/lib/radio";

import { Album } from "./Album";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/hooks/use-lazy-playlist-options", () => ({
  useLazyPlaylistOptions: () => ({
    playlistOptions: [],
    ensurePlaylistOptionsLoaded: vi.fn(),
  }),
}));

vi.mock("@/components/bandcamp/BandcampSupportButton", () => ({
  BandcampSupportButton: ({
    presentation,
  }: {
    presentation?: "secondary-action";
  }) => (
    <button
      type="button"
      aria-label="Buy this album on Bandcamp"
      className={presentation === "secondary-action" ? "mock-secondary" : ""}
    >
      Bandcamp
    </button>
  ),
}));

vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({
    openCreatePlaylist: vi.fn(),
  }),
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    saveAlbum: vi.fn(async () => true),
    unsaveAlbum: vi.fn(async () => true),
  }),
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: () => false,
    likeTrack: vi.fn(async () => true),
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async () => ({ ok: true })),
    getApiBase: vi.fn(() => ""),
    getAuthToken: vi.fn(() => null),
    resolveMaybeApiAssetUrl: vi.fn((url?: string | null) => url ?? null),
  };
});

vi.mock("@/lib/radio", () => ({
  fetchAlbumRadio: vi.fn(),
}));

const ALBUM_DATA = {
  id: 42,
  entity_uid: "album-entity-42",
  slug: "morir",
  artist_id: 9,
  artist_entity_uid: "artist-entity-9",
  artist_slug: "crossed",
  artist: "Crossed",
  name: "MORIR",
  display_name: "MORIR",
  path: "/music/Crossed/MORIR",
  track_count: 3,
  total_size_mb: 12,
  total_length_sec: 128,
  has_cover: true,
  cover_file: "cover.jpg",
  cover_url: null,
  tracks: [
    {
      id: 101,
      entity_uid: "track-entity-101",
      filename: "01-culpa.flac",
      format: "flac",
      size_mb: 12,
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
      length_sec: 128,
      rating: 0,
      path: "/music/Crossed/MORIR/01-culpa.flac",
      is_available: true,
      source: null,
      source_url: null,
      tags: {
        title: "CULPA",
        artist: "Crossed",
        album: "MORIR",
        albumartist: "Crossed",
        tracknumber: "1",
        discnumber: "1",
        date: "2022",
        genre: "hardcore",
        musicbrainz_albumid: "",
        musicbrainz_trackid: "",
      },
    },
    {
      id: 102,
      entity_uid: "track-entity-102",
      filename: "02-dolor.flac",
      format: "flac",
      size_mb: 13,
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
      length_sec: 142,
      rating: 0,
      path: "/music/Crossed/MORIR/02-dolor.flac",
      is_available: true,
      source: null,
      source_url: null,
      tags: {
        title: "DOLOR",
        artist: "Crossed",
        album: "MORIR",
        albumartist: "Crossed",
        tracknumber: "2",
        discnumber: "1",
        date: "2022",
        genre: "hardcore",
        musicbrainz_albumid: "",
        musicbrainz_trackid: "",
      },
    },
    {
      id: 103,
      entity_uid: "track-entity-103",
      filename: "03-nada.flac",
      format: "flac",
      size_mb: 14,
      bitrate: 1411,
      sample_rate: 44100,
      bit_depth: 16,
      length_sec: 164,
      rating: 0,
      path: "/music/Crossed/MORIR/03-nada.flac",
      is_available: true,
      source: null,
      source_url: null,
      tags: {
        title: "NADA",
        artist: "Crossed",
        album: "MORIR",
        albumartist: "Crossed",
        tracknumber: "3",
        discnumber: "1",
        date: "2022",
        genre: "hardcore",
        musicbrainz_albumid: "",
        musicbrainz_trackid: "",
      },
    },
  ],
  album_tags: {
    artist: "Crossed",
    album: "MORIR",
    year: "2022",
    genre: "hardcore",
    musicbrainz_albumid: null,
  },
  genres: ["hardcore"],
  genre_profile: [],
  contributors: [],
  playable_track_count: 1,
  is_pre_release: false,
  release_date: null,
  release_status: null,
  release_type: null,
  source_name: null,
  source_url: null,
};

function mockDesktopPointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("min-width: 768px") ||
        query === "(hover: hover) and (pointer: fine)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockMobilePointer() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 1,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("hover: none") || query.includes("pointer: coarse"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

beforeEach(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  mockDesktopPointer();
  vi.clearAllMocks();
  vi.mocked(fetchAlbumRadio).mockResolvedValue({
    tracks: [],
    source: { type: "radio", name: "Album Radio" },
  });
  vi.mocked(useApi).mockReturnValue({
    data: ALBUM_DATA,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
});

function trackRow(title: string) {
  const row = screen.getByText(title).closest("[aria-selected]");
  if (!row) throw new Error(`Track row not found for ${title}`);
  return row;
}

function rect(top: number, bottom: number, width = 320): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: width,
    width,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("Album page", () => {
  it("offers explicit import only for remote-only albums", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        ...ALBUM_DATA,
        id: null,
        global_album_uid: "global-morir",
        availability: {
          local: false,
          remote: true,
          healthy: true,
          source_name: "Node B",
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    expect(
      screen.getByRole("button", { name: "Make available locally" }),
    ).toBeInTheDocument();
  });

  it("does not offer remote import when the album is already local", () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    expect(
      screen.queryByRole("button", { name: "Make available locally" }),
    ).toBeNull();
  });

  it("shows a countdown for a future pre-release", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-07-30T10:15:30.000Z"));
      vi.mocked(useApi).mockReturnValue({
        data: {
          ...ALBUM_DATA,
          is_pre_release: true,
          release_date: "2026-08-02",
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      renderWithListenProviders(<Album />, {
        route: "/artists/crossed/morir",
        path: "/artists/:artistSlug/:albumSlug",
      });

      const countdown = screen.getByTestId("release-countdown");
      expect(within(countdown).getByText("Days")).toBeInTheDocument();
      expect(within(countdown).getByText("Hours")).toBeInTheDocument();
      expect(within(countdown).getByText("Min")).toBeInTheDocument();
      expect(within(countdown).getByText("Sec")).toBeInTheDocument();
      expect(within(countdown).getByText("August 2, 2026")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("places the pre-release badge above the album title", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        ...ALBUM_DATA,
        is_pre_release: true,
        release_date: "2026-08-20",
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const badge = screen.getByText("Pre-release");
    const title = screen.getByRole("heading", { name: "MORIR" });
    expect(badge.parentElement).toHaveClass("flex", "flex-col");
    expect(badge.compareDocumentPosition(title)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("groups desktop hero actions into primary pills and secondary icon labels", () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const primary = screen.getByRole("group", {
      name: "Primary album actions",
    });
    const playButton = within(primary).getByRole("button", { name: "Play" });
    expect(playButton).toHaveTextContent("Play");
    expect(playButton).toHaveClass(
      "shadow-action-solid",
      "hover:shadow-action-solid-hover",
    );
    const shuffleButton = within(primary).getByRole("button", {
      name: "Shuffle",
    });
    expect(shuffleButton).toHaveTextContent("Shuffle");
    expect(shuffleButton).toHaveClass("shadow-control-inset");

    const secondary = screen.getByRole("group", {
      name: "Secondary album actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Album Radio" }),
    ).toHaveTextContent("Radio");
    expect(
      within(secondary).getByRole("button", { name: "Make available offline" }),
    ).toHaveTextContent("Offline");
    expect(
      within(secondary).getByRole("button", { name: "Add to collection" }),
    ).toHaveTextContent("Add");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "More" }),
    ).toHaveTextContent("More");
  });

  it("localizes the album action chrome", () => {
    renderWithListenProviders(<Album />, {
      locale: "es",
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const primary = screen.getByRole("group", {
      name: "Acciones principales de álbum",
    });
    expect(
      within(primary).getByRole("button", { name: "Reproducir" }),
    ).toHaveTextContent("Reproducir");
    expect(
      within(primary).getByRole("button", { name: "Aleatorio" }),
    ).toHaveTextContent("Aleatorio");

    const secondary = screen.getByRole("group", {
      name: "Acciones secundarias de álbum",
    });
    expect(
      within(secondary).getByRole("button", { name: "Radio de álbum" }),
    ).toHaveTextContent("Radio");
    expect(
      within(secondary).getByRole("button", { name: "Añadir a colección" }),
    ).toHaveTextContent("Añadir");
    expect(
      within(secondary).getByRole("button", { name: "Compartir" }),
    ).toHaveTextContent("Compartir");
    expect(
      within(secondary).getByRole("button", { name: "Más" }),
    ).toHaveTextContent("Más");
  });

  it("uses global album identity from a human remote album route", async () => {
    const playAll = vi.fn();
    const baseTrack = ALBUM_DATA.tracks[0]!;
    vi.mocked(fetchAlbumRadio).mockResolvedValue({
      tracks: [
        {
          id: "global-track-1",
          globalTrackUid: "global-track-1",
          title: "Water Wings",
          artist: "Birds In Row",
          album: "Gris Klein",
          duration: 210,
        },
      ],
      source: { type: "radio", name: "Gris Klein Radio" },
    });
    vi.mocked(useApi).mockReturnValue({
      data: {
        ...ALBUM_DATA,
        id: null,
        entity_uid: undefined,
        global_album_uid: "global-gris-klein",
        global_artist_uid: "global-birds-in-row",
        artist_id: undefined,
        artist_entity_uid: undefined,
        artist_slug: "birds-in-row",
        artist: "Birds In Row",
        name: "Gris Klein",
        display_name: "Gris Klein",
        slug: "gris-klein",
        tracks: [
          {
            ...baseTrack,
            id: "global-track-1",
            entity_uid: undefined,
            global_track_uid: "global-track-1",
            global_album_uid: "global-gris-klein",
            global_artist_uid: "global-birds-in-row",
            tags: {
              ...baseTrack.tags,
              title: "Water Wings",
              artist: "Birds In Row",
              album: "Gris Klein",
              albumartist: "Birds In Row",
            },
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Album />, {
      route: "/artists/birds-in-row/gris-klein",
      path: "/artists/:artistSlug/:albumSlug",
      playerActions: { playAll },
    });

    const secondary = screen.getByRole("group", {
      name: "Secondary album actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Add to collection" }),
    ).toHaveTextContent("Add");
    expect(
      within(secondary).queryByRole("button", {
        name: "Make available offline",
      }),
    ).toBeNull();

    fireEvent.click(
      within(secondary).getByRole("button", { name: "Album Radio" }),
    );

    await waitFor(() => {
      expect(fetchAlbumRadio).toHaveBeenCalledWith({
        albumId: "global-gris-klein",
        artistName: "Birds In Row",
        albumName: "Gris Klein",
      });
    });
    expect(playAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ globalTrackUid: "global-track-1" }),
      ]),
      0,
      { type: "radio", name: "Gris Klein Radio" },
    );
  });

  it("renders the desktop more menu outside the horizontally scrolling action row", async () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-[12px]",
      "z-app-context-menu",
    );

    const menuItem = await screen.findByRole("menuitem", { name: "Play now" });
    expect(menuItem.closest(".overflow-x-auto")).toBeNull();
  });

  it("uses frameless labelled secondary actions on mobile album pages", async () => {
    mockMobilePointer();

    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const secondary = screen.getByRole("group", {
      name: "Secondary album actions",
    });
    expect(secondary).toHaveClass("grid");

    const radio = within(secondary).getByRole("button", {
      name: "Album Radio",
    });
    expect(radio).toHaveTextContent("Radio");
    expect(radio).toHaveClass("hover:text-accent-action");
    expect(radio.className).toContain("hover:drop-shadow");
    expect(radio).not.toHaveClass("rounded-lg");

    expect(
      within(secondary).getByRole("button", { name: "Make available offline" }),
    ).toHaveTextContent("Offline");
    expect(
      within(secondary).getByRole("button", { name: "Add to collection" }),
    ).toHaveTextContent("Add");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", {
        name: "Buy this album on Bandcamp",
      }),
    ).toHaveTextContent("Bandcamp");

    const heroMenu = screen.getByTestId("album-mobile-hero-menu");
    expect(heroMenu).toHaveAttribute("aria-label", "More");
    expect(heroMenu.parentElement).not.toBeNull();
    expect(heroMenu.parentElement!).toHaveClass("fixed", "z-app-header");
    expect(heroMenu.parentElement!).not.toHaveClass("z-app-context-menu");
    expect(
      screen.getByTestId("album-mobile-hero-menu-icon"),
    ).toBeInTheDocument();
    expect(
      within(secondary).queryByRole("button", { name: "More" }),
    ).toBeNull();

    fireEvent.click(heroMenu);
    expect(
      await screen.findByRole("menuitem", { name: "Play now" }),
    ).toBeInTheDocument();
  });

  it("hides mobile album genres and cover art while keeping the hero cover space", () => {
    mockMobilePointer();
    vi.mocked(useApi).mockReturnValue({
      data: {
        ...ALBUM_DATA,
        genre_profile: [
          {
            name: "Chaotic Screamo With A Very Long Descriptor",
            slug: "chaotic-screamo-with-a-very-long-descriptor",
          },
          { name: "Post Hardcore", slug: "post-hardcore" },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const genrePill = screen.getByRole("button", {
      name: /chaotic screamo with a very long descriptor/i,
    });
    expect(genrePill.closest("div")).toHaveClass("hidden", "sm:flex");

    expect(screen.getByTestId("album-mobile-cover-spacer")).toHaveClass(
      "aspect-square",
      "sm:hidden",
    );
    expect(screen.getByTestId("album-desktop-cover")).toHaveClass(
      "hidden",
      "sm:block",
    );
    expect(screen.getByTestId("album-hero-background")).toHaveClass(
      "brightness-[0.72]",
      "opacity-[0.82]",
      "sm:grayscale",
      "sm:brightness-[0.42]",
      "sm:opacity-[0.42]",
    );
    expect(screen.getByTestId("album-hero-background")).not.toHaveClass(
      "grayscale",
    );
    expect(screen.getByTestId("album-hero-mobile-gradient")).toHaveStyle({
      background: "var(--hero-artwork-gradient-mobile)",
    });
    expect(screen.getByTestId("album-hero-desktop-gradient")).toHaveStyle({
      background: "var(--hero-artwork-gradient-desktop)",
    });
    expect(screen.getByTestId("album-hero-content")).toHaveClass(
      "pb-[calc(var(--album-mobile-action-overlap)+var(--album-mobile-info-action-gap))]",
      "sm:pb-6",
    );
    expect(screen.getByTestId("album-action-row")).toHaveClass(
      "-mt-[var(--album-mobile-action-overlap)]",
      "pt-0",
      "sm:mt-0",
    );
    expect(screen.getByTestId("album-hero-info")).toHaveClass(
      "flex",
      "min-w-0",
      "text-left",
    );
    expect(screen.getByTestId("album-hero-info")).toHaveClass(
      "translate-y-[var(--album-mobile-info-y)]",
      "sm:translate-y-0",
    );
    expect(screen.getByTestId("album-hero-info")).not.toHaveClass(
      "translate-y-12",
    );
  });

  it("aligns the desktop action rail with the hero and track list", () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    const actionRow = screen.getByTestId("album-action-row");
    expect(actionRow).toHaveClass("sm:px-0");
    expect(actionRow.firstElementChild).toHaveClass("sm:px-6");
  });

  it("anchors mobile album metadata above the measured primary action buttons", async () => {
    mockMobilePointer();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "album-hero-info") {
          const offset =
            Number(
              document
                .querySelector<HTMLElement>('[data-testid="album-shell"]')
                ?.style.getPropertyValue("--album-mobile-info-y")
                .replace("px", ""),
            ) || 0;
          return rect(300 + offset, 390 + offset);
        }
        if (this.dataset.testid === "album-primary-actions") {
          return rect(474, 522, 398);
        }
        return rect(0, 1);
      });

    try {
      renderWithListenProviders(<Album />, {
        route: "/artists/crossed/morir",
        path: "/artists/:artistSlug/:albumSlug",
      });

      await waitFor(() => {
        expect(
          screen
            .getByTestId("album-shell")
            .style.getPropertyValue("--album-mobile-info-y"),
        ).toBe("64px");
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("uses plain click for single selection and cmd/ctrl click for additive selection", () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    fireEvent.click(screen.getByText("CULPA"));
    expect(trackRow("CULPA")).toHaveAttribute("aria-selected", "true");
    expect(trackRow("DOLOR")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("DOLOR"));
    expect(trackRow("CULPA")).toHaveAttribute("aria-selected", "false");
    expect(trackRow("DOLOR")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("CULPA"), { metaKey: true });
    expect(trackRow("CULPA")).toHaveAttribute("aria-selected", "true");
    expect(trackRow("DOLOR")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("uses shift click to select a contiguous desktop range", () => {
    renderWithListenProviders(<Album />, {
      route: "/artists/crossed/morir",
      path: "/artists/:artistSlug/:albumSlug",
    });

    fireEvent.click(screen.getByText("CULPA"));
    fireEvent.click(screen.getByText("NADA"), { shiftKey: true });

    expect(trackRow("CULPA")).toHaveAttribute("aria-selected", "true");
    expect(trackRow("DOLOR")).toHaveAttribute("aria-selected", "true");
    expect(trackRow("NADA")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });
});
