import {
  artistApiPath as _artistApiPath,
  artistBackgroundApiUrl as _artistBackgroundApiUrl,
  artistPhotoApiUrl as _artistPhotoApiUrl,
  artistTopTracksPath as _artistTopTracksPath,
  albumApiPath as _albumApiPath,
  albumCoverApiUrl as _albumCoverApiUrl,
  albumRelatedApiPath as _albumRelatedApiPath,
  type AlbumRouteInput,
  type ArtistRouteInput,
} from "../../../shared/web/library-routes";

function slugSegment(value: string | null | undefined, fallback: string) {
  const normalized = (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return encodeURIComponent(slug || fallback);
}

function legacyArtistSlug(input: ArtistRouteInput) {
  return slugSegment(input.artistSlug, input.artistName || "artist");
}

function legacyAlbumSlug(input: AlbumRouteInput) {
  return slugSegment(input.albumSlug, input.albumName || "album");
}

export type { ArtistRouteInput, AlbumRouteInput };

export function artistPagePath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${legacyArtistSlug(input)}`;
  }
  return "/artists";
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${legacyArtistSlug(input)}/top-tracks`;
  }
  return "/artists";
}

export function albumPagePath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${legacyAlbumSlug(input)}`;
  }
  return "/albums";
}

export const artistApiPath = _artistApiPath;
export const albumApiPath = _albumApiPath;
export const albumRelatedApiPath = _albumRelatedApiPath;
export const artistPhotoApiUrl = _artistPhotoApiUrl;
export const artistBackgroundApiUrl = _artistBackgroundApiUrl;
export const albumCoverApiUrl = _albumCoverApiUrl;
