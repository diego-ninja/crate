import {
  artistApiPath as _artistApiPath,
  artistBackgroundApiUrl as _artistBackgroundApiUrl,
  artistPagePath as _artistPagePath,
  artistPhotoApiUrl as _artistPhotoApiUrl,
  artistTopTracksPath as _artistTopTracksPath,
  albumApiPath as _albumApiPath,
  albumCoverApiUrl as _albumCoverApiUrl,
  albumPagePath as _albumPagePath,
  albumRelatedApiPath as _albumRelatedApiPath,
  trackDownloadApiPath as _trackDownloadApiPath,
  type AlbumRouteInput,
  type ArtistRouteInput,
  type TrackRouteInput,
} from "../../../shared/web/library-routes";

export type { ArtistRouteInput, AlbumRouteInput, TrackRouteInput };

export interface AdminArtistRouteInput extends ArtistRouteInput {
  artistEntityUid?: string | null;
}

export interface AdminAlbumRouteInput extends AlbumRouteInput {
  albumEntityUid?: string | null;
  artistEntityUid?: string | null;
}

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

function encodeEntityUid(value: string | null | undefined) {
  return value ? encodeURIComponent(value) : "";
}

function appendSuffix(path: string, suffix: string | null | undefined) {
  if (!suffix) return path;
  return `${path}/${suffix.replace(/^\/+/, "")}`;
}

function legacyAlbumSlug(input: AlbumRouteInput) {
  return slugSegment(input.albumSlug, input.albumName || "album");
}

export function artistPagePath(input: ArtistRouteInput) {
  return _artistPagePath(input);
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  return _artistTopTracksPath(input);
}

export function albumPagePath(input: AlbumRouteInput) {
  const canonical = _albumPagePath(input);
  if (canonical !== "/albums") {
    return canonical;
  }
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${legacyAlbumSlug(input)}`;
  }
  return "/albums";
}

export function artistApiPath(input: AdminArtistRouteInput) {
  if (input.artistEntityUid) {
    return `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`;
  }
  return _artistApiPath(input);
}

export function albumApiPath(input: AdminAlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`;
  }
  return _albumApiPath(input);
}

export function albumRelatedApiPath(input: AdminAlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/related`;
  }
  return _albumRelatedApiPath(input);
}

export function artistPhotoApiUrl(input: AdminArtistRouteInput, options?: Parameters<typeof _artistPhotoApiUrl>[1]) {
  if (input.artistId == null && input.artistEntityUid) {
    const params = new URLSearchParams();
    if (options?.size != null) params.set("size", String(options.size));
    if (options?.random) params.set("random", "1");
    if (options?.version != null && String(options.version).trim()) params.set("v", String(options.version));
    if (options?.format) params.set("format", options.format);
    const query = params.toString();
    return query
      ? `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/photo?${query}`
      : `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/photo`;
  }
  return _artistPhotoApiUrl(input, options);
}

export function artistBackgroundApiUrl(input: AdminArtistRouteInput, options?: Parameters<typeof _artistBackgroundApiUrl>[1]) {
  if (input.artistId == null && input.artistEntityUid) {
    const params = new URLSearchParams();
    if (options?.size != null) params.set("size", String(options.size));
    if (options?.random) params.set("random", "1");
    if (options?.version != null && String(options.version).trim()) params.set("v", String(options.version));
    if (options?.format) params.set("format", options.format);
    const query = params.toString();
    return query
      ? `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/background?${query}`
      : `/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}/background`;
  }
  return _artistBackgroundApiUrl(input, options);
}

export function albumCoverApiUrl(input: AdminAlbumRouteInput, options?: Parameters<typeof _albumCoverApiUrl>[1]) {
  if (input.albumId == null && input.albumEntityUid) {
    const params = new URLSearchParams();
    if (options?.size != null) params.set("size", String(options.size));
    if (options?.random) params.set("random", "1");
    if (options?.version != null && String(options.version).trim()) params.set("v", String(options.version));
    if (options?.format) params.set("format", options.format);
    const query = params.toString();
    return query
      ? `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/cover?${query}`
      : `/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}/cover`;
  }
  return _albumCoverApiUrl(input, options);
}

export function artistActionApiPath(input: AdminArtistRouteInput, suffix?: string) {
  if (input.artistEntityUid) {
    return appendSuffix(`/api/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`, suffix);
  }
  if (input.artistId != null) {
    return appendSuffix(`/api/artists/${input.artistId}`, suffix);
  }
  return "";
}

export function artistManagementApiPath(input: AdminArtistRouteInput, suffix?: string) {
  if (input.artistEntityUid) {
    return appendSuffix(`/api/manage/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`, suffix);
  }
  if (input.artistId != null) {
    return appendSuffix(`/api/manage/artists/${input.artistId}`, suffix);
  }
  return "";
}

export function artistArtworkApiPath(input: AdminArtistRouteInput, suffix?: string) {
  if (input.artistEntityUid) {
    return appendSuffix(`/api/artwork/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`, suffix);
  }
  if (input.artistId != null) {
    return appendSuffix(`/api/artwork/artists/${input.artistId}`, suffix);
  }
  return "";
}

export function tidalMissingArtistApiPath(input: AdminArtistRouteInput) {
  if (input.artistEntityUid) {
    return `/api/tidal/missing/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`;
  }
  if (input.artistId != null) {
    return `/api/tidal/missing/artists/${input.artistId}`;
  }
  return "";
}

export function tidalDownloadMissingArtistApiPath(input: AdminArtistRouteInput) {
  if (input.artistEntityUid) {
    return `/api/tidal/download-missing/artists/by-entity/${encodeEntityUid(input.artistEntityUid)}`;
  }
  if (input.artistId != null) {
    return `/api/tidal/download-missing/artists/${input.artistId}`;
  }
  return "";
}

export function albumActionApiPath(input: AdminAlbumRouteInput, suffix?: string) {
  if (input.albumEntityUid) {
    return appendSuffix(`/api/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`, suffix);
  }
  if (input.albumId != null) {
    return appendSuffix(`/api/albums/${input.albumId}`, suffix);
  }
  return "";
}

export function albumManagementApiPath(input: AdminAlbumRouteInput, suffix?: string) {
  if (input.albumEntityUid) {
    return appendSuffix(`/api/manage/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`, suffix);
  }
  if (input.albumId != null) {
    return appendSuffix(`/api/manage/albums/${input.albumId}`, suffix);
  }
  return "";
}

export function albumArtworkApiPath(input: AdminAlbumRouteInput, suffix?: string) {
  if (input.albumEntityUid) {
    return appendSuffix(`/api/artwork/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`, suffix);
  }
  if (input.albumId != null) {
    return appendSuffix(`/api/artwork/albums/${input.albumId}`, suffix);
  }
  return "";
}

export function albumMatchApiPath(input: AdminAlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/match/albums/by-entity/${encodeEntityUid(input.albumEntityUid)}`;
  }
  if (input.albumId != null) {
    return `/api/match/albums/${input.albumId}`;
  }
  return "";
}

export function albumReanalyzeApiPath(input: AdminAlbumRouteInput) {
  if (input.albumEntityUid) {
    return `/api/manage/reanalyze-album/by-entity/${encodeEntityUid(input.albumEntityUid)}`;
  }
  if (input.albumId != null) {
    return `/api/manage/reanalyze-album/${input.albumId}`;
  }
  return "";
}

export function trackDownloadApiPath(input: TrackRouteInput) {
  return _trackDownloadApiPath(input);
}
