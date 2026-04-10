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

import { API_BASE } from "@/lib/api";

// Page routes — no prefix needed (local navigation)
export const artistPagePath = _artistPagePath;
export const artistTopTracksPath = _artistTopTracksPath;
export const albumPagePath = _albumPagePath;

// API routes — prefix with API_BASE for Capacitor (absolute URL needed for images)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function prefixed<F extends (...args: any[]) => string>(fn: F): F {
  return ((...args: Parameters<F>) => {
    const path = fn(...args);
    return path ? `${API_BASE}${path}` : path;
  }) as F;
}

export const artistApiPath = prefixed(_artistApiPath);
export const artistPhotoApiUrl = prefixed(_artistPhotoApiUrl);
export const artistBackgroundApiUrl = prefixed(_artistBackgroundApiUrl);
export const albumApiPath = prefixed(_albumApiPath);
export const albumRelatedApiPath = prefixed(_albumRelatedApiPath);
export const albumCoverApiUrl = prefixed(_albumCoverApiUrl);
