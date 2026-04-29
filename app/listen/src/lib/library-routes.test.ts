import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  getApiBase: vi.fn(() => "https://api.example.test"),
  getAuthToken: vi.fn(() => "listen-token"),
}));

import {
  albumApiPath,
  albumCoverApiUrl,
  albumPagePath,
  artistApiPath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
  artistTopTracksPath,
  isReservedArtistChildSlug,
  recordAssetInvalidationScope,
  trackDownloadApiPath,
  trackEqFeaturesApiPath,
  trackGenreApiPath,
  trackInfoApiPath,
  trackOfflineManifestApiPath,
  trackStreamApiPath,
} from "@/lib/library-routes";

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

  it("falls back to entity UID artist assets when numeric ids are unavailable", () => {
    const url = artistPhotoApiUrl({ artistEntityUid: "artist-entity-9" }, { size: 128 });

    expect(url).toBe("https://api.example.test/api/artists/by-entity/artist-entity-9/photo?size=128&token=listen-token");
  });

  it("adds a cache-busting artist asset version after invalidation", () => {
    recordAssetInvalidationScope("artist:9", "artwork-2");

    const url = artistPhotoApiUrl({ artistId: 9 }, { size: 128 });

    expect(url).toBe("https://api.example.test/api/artists/9/photo?size=128&v=artwork-2&token=listen-token");
  });

  it("prefers the runtime invalidation version over a stale explicit asset version", () => {
    recordAssetInvalidationScope("artist:11", "artwork-live");

    const url = artistBackgroundApiUrl({ artistId: 11 }, { size: 1280, version: "stale-db-version" });

    expect(url).toBe("https://api.example.test/api/artists/11/background?size=1280&v=artwork-live&token=listen-token");
  });

  it("preserves the artist slug as a backend fallback for deep links", () => {
    const path = artistApiPath({ artistId: 52, artistSlug: "poison-the-well" });

    expect(path).toBe("/api/artist-slugs/poison-the-well");
  });

  it("builds canonical artist paths from slugs", () => {
    expect(artistPagePath({ artistId: 7, artistSlug: "quicksand", artistName: "Quicksand" })).toBe("/artists/quicksand");
    expect(artistTopTracksPath({ artistId: 7, artistSlug: "quicksand", artistName: "Quicksand" })).toBe("/artists/quicksand/top-tracks");
  });

  it("builds nested album paths under the artist when the slug is not reserved", () => {
    const path = albumPagePath({
      albumId: 9,
      artistSlug: "quicksand",
      albumSlug: "quicksand-slip",
      artistName: "Quicksand",
      albumName: "Slip",
    });

    expect(path).toBe("/artists/quicksand/slip");
  });

  it("falls back to the legacy album route for reserved child slugs", () => {
    const path = albumPagePath({
      albumId: 9,
      artistSlug: "quicksand",
      albumSlug: "quicksand-top-tracks",
      artistName: "Quicksand",
      albumName: "Top Tracks",
    });

    expect(path).toBe("/albums/9/quicksand-top-tracks");
    expect(isReservedArtistChildSlug("top-tracks")).toBe(true);
  });

  it("resolves album API paths by artist and public album slug", () => {
    const path = albumApiPath({
      artistSlug: "quicksand",
      albumSlug: "quicksand-slip",
      artistName: "Quicksand",
      albumName: "Slip",
    });

    expect(path).toBe("/api/artist-slugs/quicksand/albums/slip");
  });

  it("falls back to entity UID album APIs and artwork when slugs and numeric ids are unavailable", () => {
    const path = albumApiPath({ albumEntityUid: "album-entity-42" });
    const cover = albumCoverApiUrl({ albumEntityUid: "album-entity-42" }, { size: 256 });

    expect(path).toBe("/api/albums/by-entity/album-entity-42");
    expect(cover).toBe("https://api.example.test/api/albums/by-entity/album-entity-42/cover?size=256&token=listen-token");
  });

  it("builds canonical track routes preferring entity_uid", () => {
    expect(trackInfoApiPath({ entityUid: "track-entity-1", libraryTrackId: 12 })).toBe(
      "/api/tracks/by-entity/track-entity-1/info",
    );
    expect(trackEqFeaturesApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/eq-features",
    );
    expect(trackGenreApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/genre",
    );
    expect(trackStreamApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/stream",
    );
    expect(trackDownloadApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/tracks/by-entity/track-entity-1/download",
    );
    expect(trackOfflineManifestApiPath({ entityUid: "track-entity-1" })).toBe(
      "/api/offline/tracks/by-entity/track-entity-1/manifest",
    );
  });

  it("falls back to id/path routes only when canonical identity is missing", () => {
    expect(trackInfoApiPath({ libraryTrackId: 12 })).toBe("/api/tracks/12/info");
    expect(trackStreamApiPath({ libraryTrackId: 12 })).toBe("/api/tracks/12/stream");
    expect(trackDownloadApiPath({ path: "Artist/Album/Track.flac" })).toBe("/api/download/track/Artist/Album/Track.flac");
  });
});
