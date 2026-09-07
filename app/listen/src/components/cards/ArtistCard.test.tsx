import { act, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ArtistCard } from "./ArtistCard";

const { resolveMaybeApiAssetUrlMock } = vi.hoisted(() => ({
  resolveMaybeApiAssetUrlMock: vi.fn(
    (url: string | null | undefined) => url ?? null,
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    resolveMaybeApiAssetUrl: resolveMaybeApiAssetUrlMock,
  };
});

const { toggleArtistFollowMock } = vi.hoisted(() => ({
  toggleArtistFollowMock: vi.fn(async () => true),
}));

vi.mock("@/contexts/ArtistFollowsContext", () => ({
  useArtistFollows: () => ({
    isFollowing: () => false,
    toggleArtistFollow: toggleArtistFollowMock,
  }),
}));

function mockPointerEnvironment(desktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        desktop &&
        (query.includes("min-width: 768px") ||
          query === "(hover: hover) and (pointer: fine)"),
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
  mockPointerEnvironment(false);
  toggleArtistFollowMock.mockClear();
  resolveMaybeApiAssetUrlMock.mockImplementation(
    (url: string | null | undefined) => url ?? null,
  );
});

describe("ArtistCard", () => {
  it("keeps hover actions anchored to the circular artwork", () => {
    mockPointerEnvironment(true);

    renderWithListenProviders(
      <ArtistCard name="Dredg" artistId={1} artistSlug="dredg" />,
    );

    const followButton = screen.getByRole("button", { name: "Follow Dredg" });

    expect(followButton.closest("[data-artwork-state]")).toBeInTheDocument();
  });

  it("does not add inline actions to external artist links", () => {
    mockPointerEnvironment(true);

    renderWithListenProviders(
      <ArtistCard
        name="Dredg"
        artistId={1}
        href="https://www.last.fm/music/Dredg"
        external
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Follow Dredg" }),
    ).not.toBeInTheDocument();
  });

  it("renders responsive WebP candidates for generated artist photos", () => {
    renderWithListenProviders(
      <ArtistCard name="High Vis" artistId={9} layout="grid" />,
    );

    const image = screen.getByAltText("High Vis");
    expect(image).toHaveAttribute("sizes");
    expect(image.getAttribute("srcset")).toMatch(/size=160[^,]* 160w/);
    expect(image.getAttribute("srcset")).toMatch(/size=320[^,]* 320w/);
    expect(image.getAttribute("srcset")).toMatch(/format=webp/);
    expect(screen.getByText("High Vis").closest("article")).toHaveClass(
      "listen-deferred-grid-item",
    );
  });

  it("uses the rendered compact width when selecting responsive artwork", () => {
    renderWithListenProviders(
      <ArtistCard name="High Vis" artistId={9} compact />,
    );

    expect(screen.getByAltText("High Vis")).toHaveAttribute("sizes", "100px");
  });

  it("shows a flat monogram disc while external artwork is pending", () => {
    renderWithListenProviders(
      <ArtistCard
        name="Poison The Well"
        photo="/api/network/external-artist/photo?name=Poison%20The%20Well"
        href="https://www.last.fm/music/Poison+The+Well"
        external
      />,
    );

    const placeholder = screen.getByTestId("artist-artwork-placeholder");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveAttribute("data-placeholder-style", "flat-disc");
    expect(placeholder).toHaveTextContent("PW");
    expect(placeholder).toHaveClass("rounded-full");
    expect(placeholder.childElementCount).toBe(1);
    expect(placeholder.className).not.toMatch(
      /gradient|border|shadow|backdrop/,
    );
    expect(placeholder.firstElementChild?.className).not.toMatch(
      /gradient|border|shadow|backdrop|rounded/,
    );
  });

  it("keeps polling pending external artwork beyond the initial burst", async () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithListenProviders(
        <ArtistCard
          name="Poison The Well"
          photo="/api/network/external-artist/photo?name=Poison%20The%20Well"
          href="https://www.last.fm/music/Poison+The+Well"
          external
        />,
      );

      const image = screen.getByAltText("Poison The Well");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("decoding", "async");

      fireEvent.error(image);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("retry=1"),
      );

      fireEvent.error(screen.getByAltText("Poison The Well"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("retry=2"),
      );

      fireEvent.error(screen.getByAltText("Poison The Well"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("retry=3"),
      );

      fireEvent.error(screen.getByAltText("Poison The Well"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        expect.stringContaining("retry=4"),
      );
      expect(screen.getByAltText("Poison The Well")).not.toHaveStyle({
        display: "none",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps failed artwork hidden until a retry loads", async () => {
    vi.useFakeTimers();
    try {
      renderWithListenProviders(
        <ArtistCard
          name="Le Temps Du Loup"
          photo="/api/network/external-artist/photo?name=Le%20Temps%20Du%20Loup"
          href="https://www.last.fm/music/Le+Temps+Du+Loup"
          external
        />,
      );

      const image = screen.getByAltText("Le Temps Du Loup");
      expect(image).toHaveClass("opacity-0");

      fireEvent.error(image);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      const retryImage = screen.getByAltText("Le Temps Du Loup");
      expect(retryImage).toHaveAttribute(
        "src",
        expect.stringContaining("retry=1"),
      );
      expect(retryImage).toHaveClass("opacity-0");

      fireEvent.load(retryImage);

      expect(screen.getByAltText("Le Temps Du Loup")).toHaveClass(
        "opacity-100",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders external artists with muted imagery and no provider overlay", () => {
    renderWithListenProviders(
      <ArtistCard
        name="Chelsea Wolfe"
        photo="https://lastfm.example/chelsea-wolfe.jpg"
        href="https://www.last.fm/music/Chelsea+Wolfe"
        external
        imageTone="muted"
      />,
    );

    const image = screen.getByAltText("Chelsea Wolfe");
    expect(image).toHaveAttribute(
      "src",
      "https://lastfm.example/chelsea-wolfe.jpg",
    );
    expect(image).toHaveClass("grayscale");
    expect(screen.getByText("Chelsea Wolfe").closest("a")).toHaveAttribute(
      "href",
      "https://www.last.fm/music/Chelsea+Wolfe",
    );
    expect(screen.queryByText("Last.fm")).not.toBeInTheDocument();
  });

  it("normalizes API-relative external photos before rendering", () => {
    resolveMaybeApiAssetUrlMock.mockImplementation((url) =>
      url?.startsWith("/api/")
        ? `https://api.example.test${url}&token=desktop-token`
        : url ?? null,
    );

    renderWithListenProviders(
      <ArtistCard
        name="Poison The Well"
        photo="/api/network/external-artist/photo?name=Poison%20The%20Well"
        href="https://www.last.fm/music/Poison+The+Well"
        external
        imageTone="muted"
      />,
    );

    expect(screen.getByAltText("Poison The Well")).toHaveAttribute(
      "src",
      "https://api.example.test/api/network/external-artist/photo?name=Poison%20The%20Well&token=desktop-token",
    );
  });

  it.each([
    {
      external: false,
      name: "High Vis",
      photo: "/api/artists/9/photo?size=384&format=webp",
    },
    {
      external: true,
      name: "Poison The Well",
      photo:
        "/api/network/external-artist/photo?name=Poison%20The%20Well&size=384",
    },
  ])(
    "keeps loaded $name artwork visible when credentials rotate",
    ({ external, name, photo }) => {
      let ticket = "ticket-1";
      resolveMaybeApiAssetUrlMock.mockImplementation((url) => {
        if (!url) return null;
        const separator = url.includes("?") ? "&" : "?";
        return `${url}${separator}media_ticket=${ticket}`;
      });

      function CredentialRotationHarness() {
        const [, setCredentialVersion] = useState(1);
        return (
          <>
            <button
              type="button"
              onClick={() => {
                ticket = "ticket-2";
                setCredentialVersion(2);
              }}
            >
              Rotate credentials
            </button>
            <ArtistCard
              name={name}
              artistId={external ? undefined : 9}
              photo={photo}
              external={external}
            />
          </>
        );
      }

      renderWithListenProviders(<CredentialRotationHarness />);

      fireEvent.load(screen.getByAltText(name));
      expect(screen.getByAltText(name)).toHaveClass("opacity-100");

      fireEvent.click(
        screen.getByRole("button", { name: "Rotate credentials" }),
      );

      expect(screen.getByAltText(name)).toHaveClass("opacity-100");
    },
  );

  it("keeps related library artwork visible when its signed prop rotates", () => {
    function SignedRelatedArtistHarness() {
      const [token, setToken] = useState("token-1");
      return (
        <>
          <button type="button" onClick={() => setToken("token-2")}>
            Rotate signed photo
          </button>
          <ArtistCard
            name="High Vis"
            artistId={9}
            photo={`/api/artists/9/photo?size=384&format=webp&token=${token}`}
          />
        </>
      );
    }

    renderWithListenProviders(<SignedRelatedArtistHarness />);

    fireEvent.load(screen.getByAltText("High Vis"));
    expect(screen.getByAltText("High Vis")).toHaveClass("opacity-100");

    fireEvent.click(
      screen.getByRole("button", { name: "Rotate signed photo" }),
    );

    expect(screen.getByAltText("High Vis")).toHaveClass("opacity-100");
  });

  it("does not request a generated artist photo when catalog says none exists", () => {
    renderWithListenProviders(
      <ArtistCard
        name="High Vis"
        globalArtistUid="artist-global-1"
        hasPhoto={false}
      />,
    );

    expect(screen.queryByAltText("High Vis")).not.toBeInTheDocument();
  });

  it("opens the desktop action menu when the artist only has stable route identifiers", async () => {
    mockPointerEnvironment(true);
    resolveMaybeApiAssetUrlMock.mockImplementation((url) =>
      url?.startsWith("/api/")
        ? `https://api.example.test${url}&media_ticket=menu-ticket`
        : url ?? null,
    );

    renderWithListenProviders(
      <ArtistCard
        name="Dredg"
        artistEntityUid="artist-entity-1"
        artistSlug="dredg"
      />,
    );

    const card = screen.getByText("Dredg").closest("article");
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-[12px]");
    expect(within(menu).getByText("Dredg")).toBeInTheDocument();
    expect(within(menu).getByAltText("Dredg")).toHaveAttribute(
      "src",
      expect.stringContaining("https://api.example.test/api/"),
    );
    expect(
      await within(menu).findByRole("menuitem", { name: "Share artist" }),
    ).toBeInTheDocument();
  });

  it("keeps follow/unfollow out of the mobile avatar tap target", async () => {
    renderWithListenProviders(
      <ArtistCard name="Dredg" artistId={1} artistSlug="dredg" />,
    );

    expect(
      screen.queryByRole("button", { name: "Follow Dredg" }),
    ).not.toBeInTheDocument();

    const card = screen.getByText("Dredg").closest("article");
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(
      await within(menu).findByRole("menuitem", { name: "Follow artist" }),
    ).toBeInTheDocument();
  });
});
