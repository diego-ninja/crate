import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: ({
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    src?: string | null;
  }) => (
    <img
      {...props}
      alt={alt}
      data-artwork-managed="true"
      data-canonical-source={src ?? ""}
      src={src ?? undefined}
    />
  ),
}));

import { PlaylistArtwork } from "./PlaylistArtwork";

describe("PlaylistArtwork", () => {
  it("uses global album artwork when playlist tracks only have global refs", () => {
    const { container } = render(
      <PlaylistArtwork
        name="Remote set"
        tracks={[
          {
            artist: "High Vis",
            album: "Blending",
            global_album_uid: "global-blending",
          },
        ]}
        className="h-24 w-24"
      />,
    );

    const img = container.querySelector("img[alt='Remote set']");

    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toContain(
      "/api/catalog/albums/global-blending/cover",
    );
    expect(img).toHaveAttribute("data-artwork-managed", "true");
  });

  it("keeps playlist artwork canonical until CrateImage resolves transport", () => {
    const assetWindow = window as typeof window & {
      __crateResolveApiAssetUrl?: (value: string) => string;
    };
    const resolver = vi.fn((value: string) => `${value}&media_ticket=signed`);
    assetWindow.__crateResolveApiAssetUrl = resolver;
    const { container } = render(
      <PlaylistArtwork
        name="Canonical set"
        coverDataUrl="/api/playlists/9/cover?v=2"
        tracks={[]}
        className="h-24 w-24"
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "data-canonical-source",
      "/api/playlists/9/cover?v=2",
    );
    expect(resolver).not.toHaveBeenCalled();
    delete assetWindow.__crateResolveApiAssetUrl;
  });

  it("uses the semantic shadow for the Crate mark", () => {
    const { container } = render(
      <PlaylistArtwork name="Marked set" showCrateMark tracks={[]} />,
    );

    expect(container.querySelector("img[alt='']")).toHaveClass(
      "drop-shadow-artwork-compact-mark",
    );
    expect(container.innerHTML).not.toContain("rgba(");
  });

  it("uses themed CSS for the generated placeholder gradient", () => {
    const { container } = render(
      <PlaylistArtwork name="Generated set" tracks={[]} />,
    );

    const placeholder = container.firstElementChild as HTMLElement | null;

    expect(placeholder).toHaveClass("playlist-artwork-placeholder");
    expect(
      placeholder?.style.getPropertyValue("--playlist-artwork-hue-1"),
    ).toMatch(/^\d+$/);
    expect(
      placeholder?.style.getPropertyValue("--playlist-artwork-hue-2"),
    ).toMatch(/^\d+$/);
    expect(container.innerHTML).not.toContain("hsl(");
  });
});
