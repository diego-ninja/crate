import { fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { AlbumCard } from "./AlbumCard";

const apiMocks = vi.hoisted(() => ({
  resolveMaybeApiAssetUrl: vi.fn((url: string | null | undefined) =>
    url?.startsWith("/api/")
      ? `https://api.example.test${url}&token=native-token`
      : url ?? null,
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  resolveMaybeApiAssetUrl: apiMocks.resolveMaybeApiAssetUrl,
}));

vi.mock("@/contexts/SavedAlbumsContext", () => ({
  useSavedAlbums: () => ({
    isSaved: () => false,
    toggleAlbumSaved: vi.fn(async () => false),
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

beforeAll(() => {
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

beforeEach(() => {
  mockDesktopPointer();
});

describe("AlbumCard", () => {
  it("uses the themed foreground for the desktop play icon", () => {
    const { container } = renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      container.querySelector("button.bg-accent-action svg"),
    ).toHaveAttribute("fill", "currentColor");
  });

  it("resolves API cover paths for configurable native servers", () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        globalAlbumUid="album-global-1"
        cover="/api/catalog/albums/album-global-1/cover?size=256"
      />,
    );

    expect(apiMocks.resolveMaybeApiAssetUrl).toHaveBeenCalledWith(
      "/api/catalog/albums/album-global-1/cover?size=256",
    );
    expect(screen.getByAltText("Inlet")).toHaveAttribute(
      "src",
      "https://api.example.test/api/catalog/albums/album-global-1/cover?size=256&token=native-token",
    );
    expect(screen.getByAltText("Inlet")).toHaveAttribute(
      "data-artwork-managed",
      "true",
    );
  });

  it("renders responsive WebP candidates for generated covers", () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toHaveClass("shadow-icon-control");
    const image = screen.getByAltText("Inlet");
    expect(image).toHaveAttribute("sizes");
    expect(image.getAttribute("srcset")).toMatch(/size=160[^,]* 160w/);
    expect(image.getAttribute("srcset")).toMatch(/size=320[^,]* 320w/);
    expect(image.getAttribute("srcset")).toMatch(/format=webp/);
    expect(image.closest("article")).toHaveClass("listen-deferred-grid-item");
  });

  it("keeps the save heart circular at desktop sizes", () => {
    renderWithListenProviders(
      <AlbumCard artist="Hum" album="Inlet" albumId={42} layout="grid" />,
    );

    expect(
      screen.getByRole("button", { name: "Add to collection" }),
    ).toHaveClass("size-10", "rounded-full", "right-4", "top-4");
  });

  it("opens the desktop action menu when the album only has stable route identifiers", async () => {
    renderWithListenProviders(
      <AlbumCard
        artist="Hum"
        album="Inlet"
        albumEntityUid="album-entity-1"
        albumSlug="inlet"
      />,
    );

    const card = screen.getByText("Inlet").closest("article");
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { clientX: 160, clientY: 120 });

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("listen-glass-panel", "w-72", "rounded-[12px]");
    expect(within(menu).getByText("Inlet")).toBeInTheDocument();
    expect(within(menu).getByText("Hum")).toBeInTheDocument();
    expect(within(menu).getByAltText("Inlet")).toHaveAttribute(
      "src",
      expect.stringContaining("https://api.example.test/api/"),
    );
    expect(
      await within(menu).findByRole("menuitem", { name: "Share album" }),
    ).toBeInTheDocument();
  });
});
