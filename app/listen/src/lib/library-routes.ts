import {
  artistPagePath as _artistPagePath,
  artistTopTracksPath as _artistTopTracksPath,
  artistApiPath as _artistApiPath,
  artistPhotoApiUrl as _artistPhotoApiUrl,
  artistBackgroundApiUrl as _artistBackgroundApiUrl,
  albumPagePath as _albumPagePath,
  albumApiPath as _albumApiPath,
  albumDownloadApiPath as _albumDownloadApiPath,
  albumRelatedApiPath as _albumRelatedApiPath,
  albumCoverApiUrl as _albumCoverApiUrl,
  trackDownloadApiPath as _trackDownloadApiPath,
  trackEqFeaturesApiPath as _trackEqFeaturesApiPath,
  trackGenreApiPath as _trackGenreApiPath,
  trackInfoApiPath as _trackInfoApiPath,
  trackPlaybackApiPath as _trackPlaybackApiPath,
  trackOfflineManifestApiPath as _trackOfflineManifestApiPath,
  trackStreamApiPath as _trackStreamApiPath,
  isReservedArtistChildSlug as _isReservedArtistChildSlug,
  recordAssetInvalidationScope as _recordAssetInvalidationScope,
} from "../../../shared/web/library-routes";
export type { ArtistRouteInput, AlbumRouteInput, TrackRouteInput } from "../../../shared/web/library-routes";

import { getApiBase, getAuthToken } from "@/lib/api";

// Page routes — no prefix needed (local navigation)
export const artistPagePath = _artistPagePath;
export const artistTopTracksPath = _artistTopTracksPath;
export const albumPagePath = _albumPagePath;
export const isReservedArtistChildSlug = _isReservedArtistChildSlug;

// Image/media URLs — prefix with the active API base + append ?token=
// for <img> elements that can't send headers.
function authedUrl<F extends (...args: any[]) => string>(fn: F): F {
  return ((...args: Parameters<F>) => {
    const path = fn(...args);
    if (!path) return path;
    if (!path.startsWith("/api/")) return path;
    return withAssetAuth(path);
  }) as F;
}

function withAssetAuth(path: string): string {
  const base = getApiBase();
  const url = `${base}${path}`;
  if (!base) return url;
  const token = getAuthToken();
  if (!token || /[?&]token=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

type ImageOptions = Parameters<typeof _albumCoverApiUrl>[1];

function preferModernImageFormat(options?: ImageOptions): ImageOptions {
  if (!options || options.size == null || Object.prototype.hasOwnProperty.call(options, "format")) return options;
  return { ...options, format: "webp" };
}

// These are passed to useApi/api() which already prepends the active API base.
export const artistApiPath = _artistApiPath;
export const albumApiPath = _albumApiPath;
export const albumDownloadApiPath = _albumDownloadApiPath;
export const albumRelatedApiPath = _albumRelatedApiPath;
export const trackInfoApiPath = _trackInfoApiPath;
export const trackPlaybackApiPath = _trackPlaybackApiPath;
export const trackEqFeaturesApiPath = _trackEqFeaturesApiPath;
export const trackGenreApiPath = _trackGenreApiPath;
export const trackOfflineManifestApiPath = _trackOfflineManifestApiPath;

export const artistPhotoApiUrl = authedUrl(((input, options) => (
  _artistPhotoApiUrl(input, preferModernImageFormat(options))
)) as typeof _artistPhotoApiUrl);
export const artistBackgroundApiUrl = authedUrl(((input, options) => (
  _artistBackgroundApiUrl(input, preferModernImageFormat(options))
)) as typeof _artistBackgroundApiUrl);
export const albumCoverApiUrl = authedUrl(((input, options) => (
  _albumCoverApiUrl(input, preferModernImageFormat(options))
)) as typeof _albumCoverApiUrl);
export const trackStreamApiPath = _trackStreamApiPath;
export const trackDownloadApiPath = _trackDownloadApiPath;
export const recordAssetInvalidationScope = _recordAssetInvalidationScope;

export function downloadApiUrl(path: string) {
  if (!path) return "";
  if (!path.startsWith("/api/")) return path;
  return withAssetAuth(path);
}
