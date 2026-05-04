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
    const base = getApiBase();
    const url = `${base}${path}`;
    if (!base) return url;
    const token = getAuthToken();
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }) as F;
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

export const artistPhotoApiUrl = authedUrl(_artistPhotoApiUrl);
export const artistBackgroundApiUrl = authedUrl(_artistBackgroundApiUrl);
export const albumCoverApiUrl = authedUrl(_albumCoverApiUrl);
export const trackStreamApiPath = _trackStreamApiPath;
export const trackDownloadApiPath = _trackDownloadApiPath;
export const recordAssetInvalidationScope = _recordAssetInvalidationScope;

export function downloadApiUrl(path: string) {
  if (!path) return "";
  const base = getApiBase();
  const url = `${base}${path}`;
  const token = getAuthToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
