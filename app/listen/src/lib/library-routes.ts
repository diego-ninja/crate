import {
  artistPagePath as _artistPagePath,
  globalArtistPagePath as _globalArtistPagePath,
  globalArtistUidFromRouteRef as _globalArtistUidFromRouteRef,
  artistSharePath as _artistSharePath,
  artistTopTracksPath as _artistTopTracksPath,
  artistApiPath as _artistApiPath,
  artistPhotoAssetPath as _artistPhotoAssetPath,
  artistBackgroundAssetPath as _artistBackgroundAssetPath,
  artistHeroAssetPath as _artistHeroAssetPath,
  albumPagePath as _albumPagePath,
  globalAlbumPagePath as _globalAlbumPagePath,
  globalAlbumUidFromRouteRef as _globalAlbumUidFromRouteRef,
  albumSharePath as _albumSharePath,
  albumApiPath as _albumApiPath,
  albumDownloadApiPath as _albumDownloadApiPath,
  albumRelatedApiPath as _albumRelatedApiPath,
  albumCoverAssetPath as _albumCoverAssetPath,
  genreCoverAssetPath as _genreCoverAssetPath,
  trackDownloadApiPath as _trackDownloadApiPath,
  trackEffectiveEqApiPath as _trackEffectiveEqApiPath,
  trackEqFeaturesApiPath as _trackEqFeaturesApiPath,
  trackEqPresetApiPath as _trackEqPresetApiPath,
  trackGenreApiPath as _trackGenreApiPath,
  trackInfoApiPath as _trackInfoApiPath,
  trackPlaybackApiPath as _trackPlaybackApiPath,
  trackSharePath as _trackSharePath,
  trackOfflineManifestApiPath as _trackOfflineManifestApiPath,
  trackStreamApiPath as _trackStreamApiPath,
  isReservedArtistChildSlug as _isReservedArtistChildSlug,
  recordAssetInvalidationScope as _recordAssetInvalidationScope,
} from "../../../shared/web/library-routes";
export type {
  ArtistRouteInput,
  AlbumRouteInput,
  TrackRouteInput,
} from "../../../shared/web/library-routes";

import { apiAssetUrl, getApiBase, getAuthToken } from "@/lib/api";

// Page routes — no prefix needed (local navigation)
export const artistPagePath = _artistPagePath;
export const globalArtistPagePath = _globalArtistPagePath;
export const globalArtistUidFromRouteRef = _globalArtistUidFromRouteRef;
export const artistSharePath = _artistSharePath;
export const artistTopTracksPath = _artistTopTracksPath;
export const albumPagePath = _albumPagePath;
export const globalAlbumPagePath = _globalAlbumPagePath;
export const globalAlbumUidFromRouteRef = _globalAlbumUidFromRouteRef;
export const albumSharePath = _albumSharePath;
export const isReservedArtistChildSlug = _isReservedArtistChildSlug;

function artworkUrl<TArgs extends unknown[], TResult extends string>(
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return ((...args: TArgs) => {
    const path = fn(...args);
    return path ? apiAssetUrl(path) : path;
  }) as (...args: TArgs) => TResult;
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

type ImageOptions = Parameters<typeof _albumCoverAssetPath>[1];

function preferModernImageFormat(options?: ImageOptions): ImageOptions {
  if (
    !options ||
    options.size == null ||
    Object.prototype.hasOwnProperty.call(options, "format")
  )
    return options;
  return { ...options, format: "webp" };
}

export function responsiveImageSrcSet(
  widths: readonly number[],
  buildUrl: (size: number) => string,
): string | undefined {
  const candidates = [...new Set(widths)]
    .reduce<Array<readonly [number, string]>>((items, width) => {
      if (!Number.isFinite(width) || width <= 0) return items;
      const roundedWidth = Math.round(width);
      const url = buildUrl(roundedWidth);
      if (url) items.push([roundedWidth, url]);
      return items;
    }, [])
    .sort(([left], [right]) => left - right);

  return candidates.length
    ? candidates.map(([width, url]) => `${url} ${width}w`).join(", ")
    : undefined;
}

// These are passed to useApi/api() which already prepends the active API base.
export const artistApiPath = _artistApiPath;
export const albumApiPath = _albumApiPath;
export const albumDownloadApiPath = _albumDownloadApiPath;
export const albumRelatedApiPath = _albumRelatedApiPath;
export const trackInfoApiPath = _trackInfoApiPath;
export const trackPlaybackApiPath = _trackPlaybackApiPath;
export const trackEffectiveEqApiPath = _trackEffectiveEqApiPath;
export const trackEqFeaturesApiPath = _trackEqFeaturesApiPath;
export const trackEqPresetApiPath = _trackEqPresetApiPath;
export const trackGenreApiPath = _trackGenreApiPath;
export const trackOfflineManifestApiPath = _trackOfflineManifestApiPath;

export const artistPhotoAssetPath = ((input, options) =>
  _artistPhotoAssetPath(
    input,
    preferModernImageFormat(options),
  )) as typeof _artistPhotoAssetPath;
export const artistBackgroundAssetPath = ((input, options) =>
  _artistBackgroundAssetPath(
    input,
    preferModernImageFormat(options),
  )) as typeof _artistBackgroundAssetPath;
export const artistHeroAssetPath = ((input, composition, options) =>
  _artistHeroAssetPath(
    input,
    composition,
    preferModernImageFormat(options),
  )) as typeof _artistHeroAssetPath;
export const albumCoverAssetPath = ((input, options) =>
  _albumCoverAssetPath(
    input,
    preferModernImageFormat(options),
  )) as typeof _albumCoverAssetPath;
export const genreCoverAssetPath = ((slug, options) =>
  _genreCoverAssetPath(
    slug,
    preferModernImageFormat(options),
  )) as typeof _genreCoverAssetPath;

export const artistPhotoApiUrl = artworkUrl(artistPhotoAssetPath);
export const artistBackgroundApiUrl = artworkUrl(artistBackgroundAssetPath);
export const artistHeroApiUrl = artworkUrl(artistHeroAssetPath);
export const albumCoverApiUrl = artworkUrl(albumCoverAssetPath);
export const genreCoverApiUrl = artworkUrl(genreCoverAssetPath);

export const trackStreamApiPath = _trackStreamApiPath;
export const trackDownloadApiPath = _trackDownloadApiPath;
export const trackSharePath = _trackSharePath;
export const recordAssetInvalidationScope = _recordAssetInvalidationScope;

export function downloadApiUrl(path: string) {
  if (!path) return "";
  if (!path.startsWith("/api/")) return path;
  return withAssetAuth(path);
}
