import { encPath } from "./utils";

function resolveAssetUrl(path: string) {
  if (typeof window === "undefined") return path;
  const resolver = (window as Window & typeof globalThis & {
    __crateResolveApiAssetUrl?: (nextPath: string) => string;
  }).__crateResolveApiAssetUrl;
  return typeof resolver === "function" ? resolver(path) : path;
}

export interface ArtistRouteInput {
  artistId?: number | null;
  artistSlug?: string | null;
  artistName?: string | null;
}

export interface AlbumRouteInput {
  albumId?: number | null;
  albumSlug?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
  albumName?: string | null;
}

export interface ImageAssetOptions {
  size?: number | null;
  random?: boolean;
  version?: string | number | null;
}

const artistAssetVersions = new Map<number, string>();
const albumAssetVersions = new Map<number, string>();
let globalArtistAssetVersion: string | null = null;
let globalAlbumAssetVersion: string | null = null;

const RESERVED_ARTIST_CHILD_SLUGS = new Set([
  "top-tracks",
  "shows",
  "radio",
]);

function slugifySegment(value: string | null | undefined, fallback: string) {
  const normalized = (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function safeSlug(slug: string | null | undefined, fallback: string) {
  return encPath(slugifySegment(slug && slug.trim() ? slug : fallback, fallback));
}

function publicArtistSlug(input: ArtistRouteInput) {
  if (input.artistSlug && input.artistSlug.trim()) {
    return slugifySegment(input.artistSlug, "artist");
  }
  if (input.artistName && input.artistName.trim()) {
    return slugifySegment(input.artistName, "artist");
  }
  return null;
}

function publicAlbumSlug(input: AlbumRouteInput) {
  if (input.albumName && input.albumName.trim()) {
    return slugifySegment(input.albumName, "album");
  }
  if (input.albumSlug && input.albumSlug.trim()) {
    const normalizedAlbumSlug = slugifySegment(input.albumSlug, "album");
    const normalizedArtistSlug = input.artistSlug ? slugifySegment(input.artistSlug, "artist") : null;
    if (normalizedArtistSlug && normalizedAlbumSlug.startsWith(`${normalizedArtistSlug}-`)) {
      return normalizedAlbumSlug.slice(normalizedArtistSlug.length + 1);
    }
    return normalizedAlbumSlug;
  }
  return null;
}

export function isReservedArtistChildSlug(slug: string | null | undefined) {
  return slug ? RESERVED_ARTIST_CHILD_SLUGS.has(slugifySegment(slug, "")) : false;
}

function withAssetOptions(path: string, options?: ImageAssetOptions) {
  if (!options) return path;
  const params = new URLSearchParams();
  if (options.size != null) params.set("size", String(options.size));
  if (options.random) params.set("random", "1");
  if (options.version != null && String(options.version).trim()) params.set("v", String(options.version));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function resolveAssetVersion(
  explicitVersion: string | number | null | undefined,
  runtimeVersion: string | null | undefined,
) {
  if (runtimeVersion && String(runtimeVersion).trim()) {
    return runtimeVersion;
  }
  if (explicitVersion != null && String(explicitVersion).trim()) {
    return explicitVersion;
  }
  return undefined;
}

export function recordAssetInvalidationScope(scope: string, version: string | number = Date.now()) {
  if (scope === "library" || scope === "home" || scope === "shows" || scope === "upcoming") {
    globalArtistAssetVersion = String(version);
    globalAlbumAssetVersion = String(version);
  }
  if (scope.startsWith("artist:")) {
    const artistId = Number(scope.slice("artist:".length));
    if (Number.isFinite(artistId)) {
      artistAssetVersions.set(artistId, String(version));
    }
    return;
  }
  if (scope.startsWith("album:")) {
    const albumId = Number(scope.slice("album:".length));
    if (Number.isFinite(albumId)) {
      albumAssetVersions.set(albumId, String(version));
    }
  }
}

export function artistPagePath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  if (slug) {
    return `/artists/${encPath(slug)}`;
  }
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, input.artistName || "artist")}`;
  }
  return "/artists";
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  if (slug) {
    return `/artists/${encPath(slug)}/top-tracks`;
  }
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, input.artistName || "artist")}/top-tracks`;
  }
  return "/artists";
}

export function artistApiPath(input: ArtistRouteInput) {
  const slug = publicArtistSlug(input);
  if (slug) {
    return `/api/artist-slugs/${encPath(slug)}`;
  }
  if (input.artistId != null) {
    const params = new URLSearchParams();
    if (input.artistSlug && input.artistSlug.trim()) {
      params.set("slug", input.artistSlug.trim());
    }
    const query = params.toString();
    return query ? `/api/artists/${input.artistId}?${query}` : `/api/artists/${input.artistId}`;
  }
  return "";
}

export function artistPhotoApiUrl(input: ArtistRouteInput, options?: ImageAssetOptions) {
  if (input.artistId != null) {
    const runtimeVersion = artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion;
    return resolveAssetUrl(
      withAssetOptions(`/api/artists/${input.artistId}/photo`, { ...options, version: resolveAssetVersion(options?.version, runtimeVersion) }),
    );
  }
  return "";
}

export function artistBackgroundApiUrl(input: ArtistRouteInput, options?: ImageAssetOptions) {
  if (input.artistId != null) {
    const runtimeVersion = artistAssetVersions.get(input.artistId) ?? globalArtistAssetVersion;
    return resolveAssetUrl(
      withAssetOptions(`/api/artists/${input.artistId}/background`, { ...options, version: resolveAssetVersion(options?.version, runtimeVersion) }),
    );
  }
  return "";
}

export function albumPagePath(input: AlbumRouteInput) {
  const artistSlug = publicArtistSlug({
    artistId: null,
    artistSlug: input.artistSlug,
    artistName: input.artistName,
  });
  const albumSlug = publicAlbumSlug(input);
  if (artistSlug && albumSlug && !isReservedArtistChildSlug(albumSlug)) {
    return `/artists/${encPath(artistSlug)}/${encPath(albumSlug)}`;
  }
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${safeSlug(input.albumSlug, input.albumName || "album")}`;
  }
  return "/albums";
}

export function albumApiPath(input: AlbumRouteInput) {
  const artistSlug = publicArtistSlug({
    artistId: null,
    artistSlug: input.artistSlug,
    artistName: input.artistName,
  });
  const albumSlug = publicAlbumSlug(input);
  if (artistSlug && albumSlug) {
    return `/api/artist-slugs/${encPath(artistSlug)}/albums/${encPath(albumSlug)}`;
  }
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}`;
  }
  return "";
}

export function albumRelatedApiPath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}/related`;
  }
  return "";
}

export function albumCoverApiUrl(input: AlbumRouteInput, options?: ImageAssetOptions) {
  if (input.albumId != null) {
    const runtimeVersion = albumAssetVersions.get(input.albumId) ?? globalAlbumAssetVersion;
    return resolveAssetUrl(
      withAssetOptions(`/api/albums/${input.albumId}/cover`, { ...options, version: resolveAssetVersion(options?.version, runtimeVersion) }),
    );
  }
  return "";
}
