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
  artistEntityUid?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
}

export interface AlbumRouteInput {
  albumId?: number | null;
  albumEntityUid?: string | null;
  artistEntityUid?: string | null;
  albumSlug?: string | null;
  artistSlug?: string | null;
  artistName?: string | null;
  albumName?: string | null;
}

export interface TrackRouteInput {
  id?: string | number | null;
  trackId?: number | null;
  libraryTrackId?: number | null;
  entityUid?: string | null;
  trackEntityUid?: string | null;
  path?: string | null;
  trackPath?: string | null;
}

export interface ImageAssetOptions {
  size?: number | null;
  random?: boolean;
  version?: string | number | null;
  format?: "webp" | null;
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

function encodeEntityUid(value: string | null | undefined) {
  return value ? encodeURIComponent(value) : "";
}

function resolveTrackEntityUid(input: TrackRouteInput) {
  return input.entityUid || input.trackEntityUid || null;
}

function resolveTrackLibraryId(input: TrackRouteInput) {
  if (input.libraryTrackId != null) return input.libraryTrackId;
  if (input.trackId != null) return input.trackId;
  if (typeof input.id === "number") return input.id;
  if (typeof input.id === "string" && /^\d+$/.test(input.id)) return Number(input.id);
  return null;
}

function resolveTrackPath(input: TrackRouteInput) {
  if (input.trackPath && input.trackPath.trim()) return input.trackPath;
  if (input.path && input.path.trim()) return input.path;
  if (typeof input.id === "string" && input.id.includes("/")) return input.id;
  return null;
}

function resolveAlbumEntityUid(input: AlbumRouteInput) {
  return input.albumEntityUid || null;
}

function resolveAlbumLibraryId(input: AlbumRouteInput) {
  return input.albumId ?? null;
}

function encodeTrackPath(path: string) {
  const normalized = path.startsWith("/music/") ? path.slice(7) : path;
  return encodeURIComponent(normalized).replace(/%2F/g, "/");
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
  if (options.format) params.set("format", options.format);
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
  if (input.artistEntityUid) {
    return `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`;
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
  if (input.artistEntityUid) {
    return resolveAssetUrl(
      withAssetOptions(
        `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/photo`,
        { ...options, version: resolveAssetVersion(options?.version, globalArtistAssetVersion) },
      ),
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
  if (input.artistEntityUid) {
    return resolveAssetUrl(
      withAssetOptions(
        `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/background`,
        { ...options, version: resolveAssetVersion(options?.version, globalArtistAssetVersion) },
      ),
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
    artistEntityUid: input.artistEntityUid,
    artistSlug: input.artistSlug,
    artistName: input.artistName,
  });
  const albumSlug = publicAlbumSlug(input);
  if (artistSlug && albumSlug) {
    return `/api/artist-slugs/${encPath(artistSlug)}/albums/${encPath(albumSlug)}`;
  }
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`;
  }
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}`;
  }
  return "";
}

export function albumRelatedApiPath(input: AlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/related`;
  }
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}/related`;
  }
  return "";
}

export function trackInfoApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/info`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/info`;

  const path = resolveTrackPath(input);
  if (path) return `/api/track-info/${encodeTrackPath(path)}`;

  return "";
}

export function trackPlaybackApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/playback`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/playback`;

  return "";
}

export function trackEqFeaturesApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/eq-features`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/eq-features`;

  return "";
}

export function trackGenreApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/genre`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/genre`;

  return "";
}

export function trackStreamApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/stream`;

  const trackId = resolveTrackLibraryId(input);
  if (trackId != null) return `/api/tracks/${trackId}/stream`;

  const path = resolveTrackPath(input);
  if (path) return `/api/stream/${encodeTrackPath(path)}`;

  return "";
}

export function trackDownloadApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/tracks/by-entity/${encodeEntityUid(entityUid)}/download`;

  const path = resolveTrackPath(input);
  if (path) return `/api/download/track/${encodeTrackPath(path)}`;

  return "";
}

export function albumDownloadApiPath(input: AlbumRouteInput) {
  const entityUid = resolveAlbumEntityUid(input);
  if (entityUid) return `/api/albums/by-entity/${encodeEntityUid(entityUid)}/download`;

  const albumId = resolveAlbumLibraryId(input);
  if (albumId != null) return `/api/albums/${albumId}/download`;

  return "";
}

export function trackOfflineManifestApiPath(input: TrackRouteInput) {
  const entityUid = resolveTrackEntityUid(input);
  if (entityUid) return `/api/offline/tracks/by-entity/${encodeEntityUid(entityUid)}/manifest`;

  return "";
}

export function albumCoverApiUrl(input: AlbumRouteInput, options?: ImageAssetOptions) {
  if (input.albumId != null) {
    const runtimeVersion = albumAssetVersions.get(input.albumId) ?? globalAlbumAssetVersion;
    return resolveAssetUrl(
      withAssetOptions(`/api/albums/${input.albumId}/cover`, { ...options, version: resolveAssetVersion(options?.version, runtimeVersion) }),
    );
  }
  if (input.albumEntityUid) {
    return resolveAssetUrl(
      withAssetOptions(
        `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/cover`,
        { ...options, version: resolveAssetVersion(options?.version, globalAlbumAssetVersion) },
      ),
    );
  }
  return "";
}
