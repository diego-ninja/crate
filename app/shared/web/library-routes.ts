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

function safeSlug(slug: string | null | undefined, fallback: string) {
  return encPath(slug && slug.trim() ? slug : fallback);
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

export function artistPhotoApiUrl(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return resolveAssetUrl(`/api/artists/${input.artistId}/photo`);
  }
  return "";
}

export function artistBackgroundApiUrl(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return resolveAssetUrl(`/api/artists/${input.artistId}/background`);
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

export function albumCoverApiUrl(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return resolveAssetUrl(`/api/albums/${input.albumId}/cover`);
  }
  return "";
}
