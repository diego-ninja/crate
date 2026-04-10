import {
  artistPagePath as _artistPagePath,
  artistTopTracksPath as _artistTopTracksPath,
  artistApiPath as _artistApiPath,
  artistPhotoApiUrl as _artistPhotoApiUrl,
  artistBackgroundApiUrl as _artistBackgroundApiUrl,
  albumPagePath as _albumPagePath,
  albumApiPath as _albumApiPath,
  albumRelatedApiPath as _albumRelatedApiPath,
  albumCoverApiUrl as _albumCoverApiUrl,
} from "../../../shared/web/library-routes";
export type { ArtistRouteInput, AlbumRouteInput } from "../../../shared/web/library-routes";

import { API_BASE, getAuthToken } from "@/lib/api";

// Page routes — no prefix needed (local navigation)
export const artistPagePath = _artistPagePath;
export const artistTopTracksPath = _artistTopTracksPath;
export const albumPagePath = _albumPagePath;

// Image/media URLs — prefix with API_BASE + append ?token= for <img> elements that can't send headers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function authedUrl<F extends (...args: any[]) => string>(fn: F): F {
  return ((...args: Parameters<F>) => {
    const path = fn(...args);
    if (!path) return path;
    const url = `${API_BASE}${path}`;
    if (!API_BASE) return url;
    const token = getAuthToken();
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  }) as F;
}

// These are passed to useApi/api() which already prepends API_BASE — no prefix here
export const artistApiPath = _artistApiPath;
export const albumApiPath = _albumApiPath;
export const albumRelatedApiPath = _albumRelatedApiPath;

export const artistPhotoApiUrl = authedUrl(_artistPhotoApiUrl);
export const artistBackgroundApiUrl = authedUrl(_artistBackgroundApiUrl);
export const albumCoverApiUrl = authedUrl(_albumCoverApiUrl);
