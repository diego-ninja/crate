import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBase: vi.fn(() => "https://api.example.test"),
  getAuthToken: vi.fn(() => "listen-token"),
}));

import { albumCoverApiUrl, artistApiPath, artistBackgroundApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

describe("library route asset helpers", () => {
  it("appends query options before the auth token for album covers", () => {
    const url = albumCoverApiUrl({ albumId: 42 }, { size: 256 });

    expect(url).toBe("https://api.example.test/api/albums/42/cover?size=256&token=listen-token");
  });

  it("preserves multiple asset query params when adding the auth token", () => {
    const url = artistBackgroundApiUrl({ artistId: 7 }, { size: 1280, random: true });

    expect(url).toBe("https://api.example.test/api/artists/7/background?size=1280&random=1&token=listen-token");
  });

  it("builds sized artist photo URLs for small listen surfaces", () => {
    const url = artistPhotoApiUrl({ artistId: 9 }, { size: 128 });

    expect(url).toBe("https://api.example.test/api/artists/9/photo?size=128&token=listen-token");
  });

  it("preserves the artist slug as a backend fallback for deep links", () => {
    const path = artistApiPath({ artistId: 52, artistSlug: "poison-the-well" });

    expect(path).toBe("/api/artists/52?slug=poison-the-well");
  });
});
