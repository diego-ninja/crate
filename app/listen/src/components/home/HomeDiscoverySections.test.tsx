import { act, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  EssentialsSection,
  FavoriteArtistsSection,
  HomeTasteHero,
  openRecentItemPath,
  RadioStationCard,
  RadioStationsSection,
  RecentEntityRow,
  RecentlyPlayedSection,
  UpcomingAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import type {
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeRadioStation,
  HomeRecentItem,
  HomeSuggestedAlbum,
} from "@/components/home/home-model";
import { artistHeroApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/lib/library-routes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/library-routes")>();
  return {
    ...actual,
    artistPhotoApiUrl: vi.fn(actual.artistPhotoApiUrl),
    artistHeroApiUrl: vi.fn(actual.artistHeroApiUrl),
  };
});

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
  }),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: vi.fn(async () => true),
  }),
}));

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
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  mockDesktopPointer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function heroFixture(overrides: Partial<HomeHeroArtist> = {}): HomeHeroArtist {
  return {
    id: 7,
    slug: "converge",
    name: "Converge",
    listeners: 639_200,
    scrobbles: 52_600_000,
    album_count: 9,
    track_count: 118,
    bio: "Converge are a Massachusetts hardcore band.",
    ...overrides,
  };
}

function StableMobileHeroHarness({
  initialHeroes,
  refreshedHeroes,
}: {
  initialHeroes: HomeHeroArtist[];
  refreshedHeroes: HomeHeroArtist[];
}) {
  const [heroes, setHeroes] = useState(initialHeroes);

  return (
    <>
      <HomeTasteHero
        heroes={heroes}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />
      <button type="button" onClick={() => setHeroes(refreshedHeroes)}>
        Refresh hero data
      </button>
    </>
  );
}

describe("HomeTasteHero", () => {
  it("does not render when the canonical surface has no available artists", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        heroSurfaces={{
          desktop: {
            mode: "canonical",
            artists: [],
          },
          mobile: {
            mode: "canonical",
            artists: [],
          },
        }}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(artistHeroApiUrl).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desktop-editorial-hero")).toBeNull();
  });

  it("does not render on mobile when the mobile surface has no available artists", () => {
    mockMobilePointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        heroSurfaces={{
          desktop: {
            mode: "canonical",
            artists: [heroFixture()],
          },
          mobile: {
            mode: "canonical",
            artists: [],
          },
        }}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(artistHeroApiUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Converge" })).toBeNull();
  });

  it("renders the legacy carousel when the device has no featured surface", () => {
    const { container } = renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        heroSurfaces={{
          desktop: {
            mode: "legacy",
            artists: [heroFixture()],
          },
          mobile: {
            mode: "legacy",
            artists: [heroFixture()],
          },
        }}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByTestId("desktop-legacy-hero")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-hero-artwork")).toBeNull();
    expect(container.querySelector(".home-legacy-hero")).toBeInTheDocument();
    expect(
      screen.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    expect(container.querySelector(".home-hero-scrim-horizontal")).toBeNull();
  });

  it("renders the editorial Just Landed content without recommendation controls", () => {
    const { container } = renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            genres: ["Hardcore", "Mathcore", "Metalcore"],
            artwork_provenance: "fallback",
          }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByText("Featured Artist")).toBeInTheDocument();
    expect(screen.queryByText("Just landed")).toBeNull();
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.getByTitle("Hardcore")).toHaveClass("rounded-md");
    expect(screen.getByText("hardcore")).toBeInTheDocument();
    expect(screen.getByText("mathcore")).toBeInTheDocument();
    expect(screen.queryByText("metalcore")).toBeNull();
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByText("Not interested")).toBeNull();
    expect(container.querySelector("img.grayscale")).toBeInTheDocument();
  });

  it("uses a manual vertical carousel on desktop", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Converge" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous artist" })).toHaveClass(
      "bg-transparent",
      "border-0",
    );
    expect(screen.getByRole("button", { name: "Next artist" })).toHaveClass(
      "bg-transparent",
      "border-0",
    );
    expect(screen.getByRole("button", { name: "Show Botch" })).toHaveClass(
      "rounded-full",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next artist" }));

    expect(screen.getByRole("heading", { name: "Botch" })).toBeInTheDocument();
  });

  it("starts the desktop carousel at a random artist", () => {
    mockDesktopPointer();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.75);

    try {
      renderWithListenProviders(
        <HomeTasteHero
          heroes={[
            heroFixture(),
            heroFixture({ id: 8, name: "Botch" }),
            heroFixture({ id: 9, name: "Mastodon" }),
          ]}
          isFollowing={() => false}
          onOpenArtist={vi.fn()}
          onPlay={vi.fn()}
          onToggleFollow={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("heading", { name: "Mastodon" }),
      ).toBeInTheDocument();
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("does not repeat the same artist in the desktop carousel", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({ id: 7, slug: "dredg", name: "Dredg" }),
          heroFixture({ id: 8, slug: "dredg-copy", name: "dredg" }),
          heroFixture({ id: 9, slug: "botch", name: "Botch" }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Show Dredg/i })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Show Botch" }),
    ).toBeInTheDocument();
  });

  it("aligns the desktop hero content to the central Home grid", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            desktop_artwork_bounds: {
              left: 0.2,
              top: 0,
              right: 0.8,
              bottom: 1,
            },
          }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByTestId("desktop-hero-content")).toHaveClass(
      "mx-auto",
      "w-full",
      "max-w-[1480px]",
      "px-6",
    );
    expect(screen.getByTestId("desktop-hero-artwork")).toHaveClass(
      "object-fill",
    );
  });

  it("keeps the Featured Artist kicker tight to the artist name", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByText("Featured Artist")).toHaveClass("leading-none");
    expect(screen.getByRole("heading", { name: "Converge" })).toHaveClass(
      "mt-1",
    );
  });

  it("shows the active heart glow and reversible particle transition", () => {
    mockMobilePointer();
    let following = false;
    const onToggleFollow = vi.fn();
    const props = {
      heroes: [heroFixture()],
      isFollowing: () => following,
      onOpenArtist: vi.fn(),
      onPlay: vi.fn(),
      onToggleFollow,
    };
    const { rerender } = renderWithListenProviders(
      <HomeTasteHero {...props} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Follow Converge" }));

    expect(screen.getByTestId("hero-follow-particles")).not.toHaveClass(
      "crate-follow-particles--unfollow",
    );
    expect(screen.getByTestId("hero-follow-heart")).toHaveClass(
      "animate-crate-icon-active-pulse",
      "crate-follow-heart-in",
    );
    expect(onToggleFollow).toHaveBeenCalledTimes(1);

    following = true;
    rerender(<HomeTasteHero {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Unfollow Converge" }));

    expect(screen.getByTestId("hero-follow-particles")).toHaveClass(
      "crate-follow-particles--unfollow",
    );
    expect(screen.getByTestId("hero-follow-heart")).toHaveClass(
      "crate-follow-heart-out",
    );
    expect(onToggleFollow).toHaveBeenCalledTimes(2);
  });

  it("keeps the desktop greeting stable above the artist copy inside the editorial header", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
        desktopIntro={
          <div>
            <h1>Good morning</h1>
            <p>Saturday, August 1</p>
          </div>
        }
      />,
    );

    const hero = screen.getByTestId("desktop-editorial-hero");
    expect(hero).toHaveClass(
      "mx-auto",
      "w-full",
      "max-w-[1480px]",
      "aspect-[1480/600]",
      "min-h-[clamp(480px,38dvh,600px)]",
    );
    expect(
      within(screen.getByTestId("desktop-hero-intro")).getByRole("heading", {
        name: "Good morning",
      }),
    ).toBeInTheDocument();
    for (const layer of screen.getAllByTestId("desktop-hero-copy-layer")) {
      expect(layer).toHaveClass("top-[39%]");
      expect(layer).not.toHaveClass("bottom-0");
    }
  });

  it("uses long side and bottom fades for desktop surface integration", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByTestId("desktop-artist-hero-frame")).toBeInTheDocument();

    expect(
      screen.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("desktop-hero-right-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-hero-bottom-scrim")).toHaveClass(
      "h-[58%]",
    );
  });

  it("requests the dedicated hero composition for desktop", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            entity_uid: "artist-entity",
            artwork_revision: "hero-revision-2",
          }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(artistHeroApiUrl).toHaveBeenCalledWith(
      expect.objectContaining({ artistEntityUid: "artist-entity" }),
      "desktop",
      { size: 1480, version: "hero-revision-2" },
    );
    expect(screen.getByTestId("desktop-hero-artwork")).toHaveClass(
      "inset-0",
      "h-full",
      "w-full",
    );
    expect(screen.getByTestId("desktop-hero-artwork")).not.toHaveClass(
      "max-w-[1480px]",
      "w-auto",
      "max-w-none",
      "aspect-[21/9]",
    );
    expect(screen.getByTestId("desktop-hero-artwork")).not.toHaveClass(
      "grayscale",
    );
    expect(
      screen.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("desktop-hero-right-scrim")).toBeInTheDocument();
  });

  it("keeps the active hero artwork visible while the preload warms up", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByTestId("desktop-hero-artwork")).not.toHaveClass(
      "opacity-0",
    );
  });

  it("uses the canonical composition view for the asset and bounds", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            artwork_revision: "stale-revision",
            hero_compositions: {
              desktop: {
                schema_version: 1,
                composition: "desktop",
                render_revision: "canonical-revision",
                recipe_hash: "recipe-hash",
                width: 1480,
                height: 600,
                bounds: { left: 0.12, top: 0, right: 0.8, bottom: 1 },
                asset_path: "/api/artists/7/hero",
              },
            },
          }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(artistHeroApiUrl).toHaveBeenCalledWith(
      expect.objectContaining({ artistId: 7 }),
      "desktop",
      { size: 1480, version: "canonical-revision" },
    );
    expect(screen.getByTestId("desktop-hero-left-edge-scrim")).toHaveStyle({
      left: "12%",
    });
  });

  it("renders one selected mobile artist without carousel controls", () => {
    mockMobilePointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[
          heroFixture({
            entity_uid: "artist-entity",
            artwork_revision: "hero-revision-2",
            mobile_artwork_bounds: {
              left: 0.2,
              top: 0.1,
              right: 0.8,
              bottom: 0.75,
            },
          }),
          heroFixture({ id: 8, name: "Botch" }),
        ]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Converge" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Botch")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Previous artist" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Next artist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Botch" })).toBeNull();
    expect(screen.getByTestId("mobile-hero-artwork")).toHaveClass(
      "inset-0",
      "h-full",
      "w-full",
      "object-fill",
    );
    expect(screen.getByTestId("mobile-hero-artwork-mask")).toHaveStyle({
      maskImage: "none",
    });
    expect(screen.getByTestId("mobile-hero-scrim")).toHaveClass("h-[82%]");
    expect(screen.queryByTestId("mobile-hero-intro-layout")).toBeNull();
    expect(artistHeroApiUrl).toHaveBeenCalledWith(
      expect.objectContaining({ artistEntityUid: "artist-entity" }),
      "mobile",
      { size: 1080, version: "hero-revision-2" },
    );
    expect(
      screen.queryByTestId("mobile-hero-edge-scrim"),
    ).not.toBeInTheDocument();
  });

  it("selects a mobile artist once and keeps it stable while Home remains mounted", () => {
    mockMobilePointer();
    vi.useFakeTimers();

    try {
      vi.mocked(Math.random).mockReturnValue(0.99);
      renderWithListenProviders(
        <StableMobileHeroHarness
          initialHeroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
          refreshedHeroes={[
            heroFixture({ bio: "Refreshed Converge" }),
            heroFixture({ id: 8, name: "Botch", bio: "Refreshed Botch" }),
          ].reverse()}
        />,
      );

      expect(
        screen.getByRole("heading", { name: "Botch" }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Refresh hero data" }),
      );

      expect(
        screen.getByRole("heading", { name: "Botch" }),
      ).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(24_000);
      });

      expect(
        screen.getByRole("heading", { name: "Botch" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("can select a different mobile artist after Home is mounted again", () => {
    mockMobilePointer();

    vi.mocked(Math.random).mockReturnValue(0);
    const firstMount = renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Converge" }),
    ).toBeInTheDocument();

    firstMount.unmount();
    vi.mocked(Math.random).mockReturnValue(0.99);

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Botch" })).toBeInTheDocument();
  });

  it("does not autoplay the desktop carousel", () => {
    mockDesktopPointer();
    vi.useFakeTimers();

    try {
      renderWithListenProviders(
        <HomeTasteHero
          heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
          isFollowing={() => false}
          onOpenArtist={vi.fn()}
          onPlay={vi.fn()}
          onToggleFollow={vi.fn()}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(24_000);
      });

      expect(
        screen.getByRole("heading", { name: "Converge" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("crossfades desktop hero copy without vertical movement", () => {
    mockDesktopPointer();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture(), heroFixture({ id: 8, name: "Botch" })]}
        isFollowing={() => false}
        onOpenArtist={vi.fn()}
        onPlay={vi.fn()}
        onToggleFollow={vi.fn()}
      />,
    );

    for (const layer of screen.getAllByTestId("desktop-hero-copy-layer")) {
      expect(layer).not.toHaveClass("translate-y-0", "translate-y-6");
      expect(layer).toHaveClass("transition-opacity");
    }
  });

  it("keeps artist navigation separate from Play and Follow actions", () => {
    mockMobilePointer();
    const onOpenArtist = vi.fn();
    const onPlay = vi.fn();
    const onToggleFollow = vi.fn();

    renderWithListenProviders(
      <HomeTasteHero
        heroes={[heroFixture()]}
        isFollowing={() => false}
        onOpenArtist={onOpenArtist}
        onPlay={onPlay}
        onToggleFollow={onToggleFollow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play Converge" }));
    fireEvent.click(screen.getByRole("button", { name: "Follow Converge" }));

    expect(
      screen.getByRole("button", { name: "Play Converge" }),
    ).toHaveTextContent("Play artist");
    const followButton = screen.getByRole("button", {
      name: "Follow Converge",
    });
    expect(followButton).not.toHaveClass("border");
    expect(followButton).not.toHaveClass("bg-black/30");

    expect(onPlay).toHaveBeenCalledWith(heroFixture());
    expect(onToggleFollow).toHaveBeenCalledWith(heroFixture());
    expect(onOpenArtist).not.toHaveBeenCalled();
  });

  it("does not bubble hero actions to an enclosing click surface", () => {
    mockMobilePointer();
    const onEnclosingClick = vi.fn();

    renderWithListenProviders(
      <div onClick={onEnclosingClick}>
        <HomeTasteHero
          heroes={[heroFixture()]}
          isFollowing={() => false}
          onOpenArtist={vi.fn()}
          onPlay={vi.fn()}
          onToggleFollow={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play Converge" }));
    fireEvent.click(screen.getByRole("button", { name: "Follow Converge" }));

    expect(onEnclosingClick).not.toHaveBeenCalled();
  });
});

describe("RecentEntityRow", () => {
  it("shows only the first four recently played rows on mobile and keeps view all", () => {
    mockMobilePointer();
    const onViewAll = vi.fn();
    const items: HomeRecentItem[] = Array.from({ length: 6 }, (_, index) => ({
      type: "album",
      album_id: index + 1,
      album_name: `Recent Album ${index + 1}`,
      artist_name: `Artist ${index + 1}`,
    }));

    renderWithListenProviders(
      <RecentlyPlayedSection
        items={items}
        onOpenItem={vi.fn()}
        onViewAll={onViewAll}
      />,
    );

    expect(screen.getByText("Recent Album 1")).toBeInTheDocument();
    expect(screen.getByText("Recent Album 4")).toBeInTheDocument();
    expect(screen.queryByText("Recent Album 5")).toBeNull();
    expect(screen.queryByText("Recent Album 6")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll Recently played left" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll Recently played right" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View all/i }));

    expect(onViewAll).toHaveBeenCalledWith("recently-played");
  });

  it("localizes the recently played section chrome", () => {
    mockMobilePointer();
    const items: HomeRecentItem[] = [
      {
        type: "album",
        album_id: 1,
        album_name: "El Cielo",
        artist_name: "Dredg",
      },
    ];

    renderWithListenProviders(
      <RecentlyPlayedSection
        items={items}
        onOpenItem={vi.fn()}
        onViewAll={vi.fn()}
      />,
      { locale: "es" },
    );

    expect(screen.getByText("Reproducido recientemente")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Álbumes, artistas y playlists que has tocado últimamente.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ver todo/i }),
    ).toBeInTheDocument();
  });

  it("does not render type badges on recently played rows", () => {
    const items: HomeRecentItem[] = [
      {
        type: "album",
        album_id: 42,
        album_name: "El Cielo",
        artist_name: "Dredg",
      },
      {
        type: "artist",
        artist_id: 7,
        artist_name: "Hum",
      },
      {
        type: "playlist",
        playlist_id: 12,
        playlist_name: "Morning Rotation",
        playlist_description: "Recent favorites",
        playlist_scope: "user",
      },
    ];

    renderWithListenProviders(
      <div>
        {items.map((item) => (
          <RecentEntityRow key={item.type} item={item} onClick={vi.fn()} />
        ))}
      </div>,
    );

    const albumRow = screen.getByRole("button", { name: /El Cielo/i });
    const artistRow = screen.getByRole("button", { name: /Hum/i });
    const playlistRow = screen.getByRole("button", {
      name: /Morning Rotation/i,
    });

    expect(within(albumRow).queryByText("album")).toBeNull();
    expect(within(artistRow).queryByText("artist")).toBeNull();
    expect(within(playlistRow).queryByText("playlist")).toBeNull();
  });

  it("renders remote favorite artists with global catalog routes and artwork", () => {
    renderWithListenProviders(
      <FavoriteArtistsSection
        artists={[
          {
            global_artist_uid: "artist-global-1",
            artist_name: "High Vis",
            play_count: 9,
            minutes_listened: 31,
          },
        ]}
        onViewAll={vi.fn()}
      />,
    );

    expect(screen.getByText("High Vis").closest("article")).not.toBeNull();
    expect(screen.getByAltText("High Vis")).toHaveAttribute(
      "src",
      "/api/catalog/artists/artist-global-1/photo?size=320&format=webp",
    );
  });

  it("opens the normalized album context menu from a recent album card", async () => {
    const item: HomeRecentItem = {
      type: "album",
      album_id: 42,
      album_name: "El Cielo",
      artist_name: "Dredg",
      artist_id: 7,
      artist_slug: "dredg",
      album_slug: "el-cielo",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /El Cielo/i }), {
      clientX: 160,
      clientY: 120,
    });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-[12px]");
    expect(within(menu).getByText("El Cielo")).toBeInTheDocument();
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share album" }),
    ).toBeInTheDocument();
  });

  it("uses global album identity for recent album artwork and navigation", () => {
    const item: HomeRecentItem = {
      type: "album",
      global_album_uid: "album-global-1",
      global_artist_uid: "artist-global-1",
      album_name: "Blending",
      artist_name: "High Vis",
      subtitle: "Album",
    };

    const { container } = renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    expect(openRecentItemPath(item)).toBe("/artists/high-vis/blending");
    expect(container.innerHTML).toContain(
      "/api/catalog/albums/album-global-1/cover",
    );
  });

  it("opens the normalized artist context menu from the more button", async () => {
    const item: HomeRecentItem = {
      type: "artist",
      artist_id: 7,
      artist_name: "Dredg",
      artist_slug: "dredg",
      subtitle: "Artist",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share artist" }),
    ).toBeInTheDocument();
  });

  it("opens the normalized playlist context menu from a recent playlist card", async () => {
    const item: HomeRecentItem = {
      type: "playlist",
      playlist_id: 12,
      playlist_name: "Morning Rotation",
      playlist_description: "Recent favorites",
      playlist_scope: "user",
    };

    renderWithListenProviders(
      <RecentEntityRow item={item} onClick={vi.fn()} />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /Morning Rotation/i }),
      {
        clientX: 160,
        clientY: 120,
      },
    );

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Morning Rotation")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Share playlist" }),
    ).toBeInTheDocument();
  });
});

describe("RadioStationCard", () => {
  it("shows the radio seed type and removes generic subtitle copy", () => {
    const station: HomeRadioStation = {
      type: "artist",
      title: "Converge Radio",
      seed_type: "artist",
      seed_label: "Converge",
      subtitle: "Based on your heavy rotation",
      play_count: 24,
      artist_name: "Converge",
      artist_id: 7,
      artist_slug: "converge",
    };

    const { container } = renderWithListenProviders(
      <RadioStationCard station={station} onPlay={vi.fn()} />,
    );

    expect(screen.getByText("Artist Radio")).toBeInTheDocument();
    expect(screen.getByText("Converge")).toBeInTheDocument();
    expect(screen.queryByText("Based on your heavy rotation")).toBeNull();
    expect(container.querySelector(".home-radio-card")).toBeInTheDocument();
    expect(container.querySelector(".home-radio-badge")).toBeInTheDocument();
  });

  it("uses global artist artwork for remote radio stations", () => {
    const station: HomeRadioStation = {
      type: "artist",
      title: "High Vis Radio",
      seed_type: "artist",
      seed_value: "global-high-vis",
      seed_label: "High Vis",
      subtitle: "",
      play_count: 24,
      artist_name: "High Vis",
      global_artist_uid: "global-high-vis",
    };

    renderWithListenProviders(
      <RadioStationCard station={station} onPlay={vi.fn()} />,
    );

    expect(artistPhotoApiUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        globalArtistUid: "global-high-vis",
        artistName: "High Vis",
      }),
      { size: 256 },
    );
  });
});

describe("RadioStationsSection", () => {
  it("uses the shared square-card rail fit", () => {
    const stations: HomeRadioStation[] = [
      {
        type: "artist",
        title: "Converge Radio",
        seed_type: "artist",
        seed_label: "Converge",
        subtitle: "",
        play_count: 24,
        artist_name: "Converge",
        artist_id: 7,
      },
    ];

    const { container } = renderWithListenProviders(
      <RadioStationsSection
        stations={stations}
        onPlayStation={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-rail-fit="square-card"]')).not.toBe(
      null,
    );
  });
});

describe("EssentialsSection", () => {
  it("labels generated home core-track playlists as Artist Sets", () => {
    const items: HomeGeneratedPlaylistSummary[] = [
      {
        id: "core-tracks-artist-1",
        name: "Converge",
        description: "A discovery route into Converge.",
        artwork_tracks: [],
        artwork_artists: [],
        track_count: 8,
        badge: "Core Tracks",
        kind: "core",
      },
    ];

    renderWithListenProviders(
      <EssentialsSection
        items={items}
        onOpenPlaylist={vi.fn()}
        onPlayPlaylist={vi.fn()}
        onShufflePlaylist={vi.fn()}
        onStartRadio={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    expect(screen.getByText("Artist Sets")).toBeInTheDocument();
    expect(screen.queryByText("Core tracks")).toBeNull();
  });
});

describe("UpcomingAlbumsSection", () => {
  it("renders the dedicated upcoming rail and routes View all to its section", () => {
    const albums: HomeSuggestedAlbum[] = [
      {
        artist_name: "Rival Schools",
        album_name: "New Record",
        release_date: "2026-09-01",
        is_pre_release: true,
      },
    ];
    const onViewAll = vi.fn();

    renderWithListenProviders(
      <UpcomingAlbumsSection albums={albums} onViewAll={onViewAll} />,
    );

    expect(screen.getByText("What's coming up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(onViewAll).toHaveBeenCalledWith("upcoming-albums");
  });
});
