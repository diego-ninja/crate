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
  artistName?: string | null;
  albumName?: string | null;
}

export interface ImageAssetOptions {
  size?: number | null;
  random?: boolean;
}

function safeSlug(slug: string | null | undefined, fallback: string) {
  return encPath(slug && slug.trim() ? slug : fallback);
}

function withAssetOptions(path: string, options?: ImageAssetOptions) {
  if (!options) return path;
  const params = new URLSearchParams();
  if (options.size != null) params.set("size", String(options.size));
  if (options.random) params.set("random", "1");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function artistPagePath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, input.artistName || "artist")}`;
  }
  return "/artists";
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, input.artistName || "artist")}/top-tracks`;
  }
  return "/artists";
}

export function artistApiPath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/api/artists/${input.artistId}`;
  }
  return "";
}

export function artistPhotoApiUrl(input: ArtistRouteInput, options?: ImageAssetOptions) {
  if (input.artistId != null) {
    return resolveAssetUrl(withAssetOptions(`/api/artists/${input.artistId}/photo`, options));
  }
  return "";
}

export function artistBackgroundApiUrl(input: ArtistRouteInput, options?: ImageAssetOptions) {
  if (input.artistId != null) {
    return resolveAssetUrl(withAssetOptions(`/api/artists/${input.artistId}/background`, options));
  }
  return "";
}

export function albumPagePath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${safeSlug(input.albumSlug, input.albumName || "album")}`;
  }
  return "/albums";
}

export function albumApiPath(input: AlbumRouteInput) {
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
    return resolveAssetUrl(withAssetOptions(`/api/albums/${input.albumId}/cover`, options));
  }
  return "";
}
