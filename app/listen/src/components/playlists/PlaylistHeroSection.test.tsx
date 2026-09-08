import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Play, Radio, Share2, Shuffle } from "@crate/ui/icons";

import { I18nProvider } from "@/i18n";

import { PlaylistHeroSection } from "./PlaylistHeroSection";

function mockDesktopPointer() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("min-width: 768px") ||
        query.includes("hover: hover") ||
        query.includes("pointer: fine"),
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

function renderArtwork(className: string) {
  return (
    <div
      data-testid="playlist-artwork"
      className={className}
      aria-label="Playlist artwork"
    />
  );
}

function renderWithI18n(ui: ReactNode, locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);
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
});

describe("PlaylistHeroSection", () => {
  it("keeps the hero background in the artist/album language without blur", () => {
    const { container } = renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    expect(container.querySelector('[class*="blur-"]')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="playlist-hero-mobile-gradient"]'),
    ).toHaveStyle({ background: "var(--hero-artwork-gradient-mobile)" });
    expect(
      container.querySelector('[data-testid="playlist-hero-desktop-gradient"]'),
    ).toHaveStyle({
      background: "var(--hero-artwork-gradient-desktop-strong)",
    });
  });

  it("uses an explicit mobile hero height so copy sits directly above CTAs", () => {
    const { container } = renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const hero = container.firstElementChild as HTMLElement;
    expect(hero).toHaveClass("h-[420px]");
    expect(hero).not.toHaveClass("min-h-[430px]");
  });

  it("uses artist/album-style primary pills and secondary icon labels", () => {
    renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        description="A playlist for badly lit rooms."
        metaItems={["12 tracks", "42 min"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[
          {
            key: "radio",
            label: "Radio",
            ariaLabel: "Playlist Radio",
            icon: Radio,
            onClick: vi.fn(),
          },
          {
            key: "share",
            label: "Share",
            ariaLabel: "Share",
            icon: Share2,
            onClick: vi.fn(),
          },
        ]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
          {
            key: "shuffle",
            label: "Shuffle playlist",
            icon: Shuffle,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const primary = screen.getByRole("group", {
      name: "Primary playlist actions",
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
      name: "Secondary playlist actions",
    });
    expect(
      within(secondary).getByRole("button", { name: "Playlist Radio" }),
    ).toHaveTextContent("Radio");
    expect(
      within(secondary).getByRole("button", { name: "Share" }),
    ).toHaveTextContent("Share");
    expect(
      within(secondary).getByRole("button", { name: "More" }),
    ).toHaveTextContent("More");
  });

  it("localizes the shared playlist hero chrome", () => {
    renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        description="A playlist for badly lit rooms."
        metaItems={["12 tracks", "42 min"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[
          {
            key: "radio",
            label: "Radio",
            ariaLabel: "Radio de playlist",
            icon: Radio,
            onClick: vi.fn(),
          },
          {
            key: "share",
            label: "Compartir",
            ariaLabel: "Compartir",
            icon: Share2,
            onClick: vi.fn(),
          },
        ]}
        menuItems={[
          {
            key: "play",
            label: "Reproducir playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
      "es",
    );

    const primary = screen.getByRole("group", {
      name: "Acciones principales de playlist",
    });
    expect(
      within(primary).getByRole("button", { name: "Reproducir" }),
    ).toHaveTextContent("Reproducir");
    expect(
      within(primary).getByRole("button", { name: "Aleatorio" }),
    ).toHaveTextContent("Aleatorio");

    const secondary = screen.getByRole("group", {
      name: "Acciones secundarias de playlist",
    });
    expect(
      within(secondary).getByRole("button", { name: "Compartir" }),
    ).toHaveTextContent("Compartir");
    expect(
      within(secondary).getByRole("button", { name: "Más" }),
    ).toHaveTextContent("Más");
  });

  it("opens the normalized glass context menu with playlist media header", async () => {
    renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        subtitle="Public playlist"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass(
      "listen-glass-panel",
      "w-72",
      "rounded-[12px]",
      "z-app-context-menu",
    );
    expect(within(menu).getByText("Friday Damage")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Play playlist" }),
    ).toBeInTheDocument();
  });

  it("moves More to the fixed mobile hero corner", async () => {
    mockMobilePointer();

    renderWithI18n(
      <PlaylistHeroSection
        title="Friday Damage"
        metaItems={["12 tracks"]}
        artwork={renderArtwork}
        onPlay={vi.fn()}
        onShuffle={vi.fn()}
        secondaryActions={[
          {
            key: "radio",
            label: "Radio",
            ariaLabel: "Playlist Radio",
            icon: Radio,
            onClick: vi.fn(),
          },
        ]}
        menuItems={[
          {
            key: "play",
            label: "Play playlist",
            icon: Play,
            onSelect: vi.fn(),
          },
        ]}
      />,
    );

    const secondary = screen.getByRole("group", {
      name: "Secondary playlist actions",
    });
    expect(
      within(secondary).queryByRole("button", { name: "More" }),
    ).toBeNull();

    const heroMenu = screen.getByTestId("playlist-mobile-hero-menu");
    expect(heroMenu).toHaveAttribute("aria-label", "More");
    expect(heroMenu.parentElement).toHaveClass("fixed", "z-app-header");

    fireEvent.click(heroMenu);
    expect(
      await screen.findByRole("menuitem", { name: "Play playlist" }),
    ).toBeInTheDocument();
  });
});
