import { encPath } from "./utils";

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
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, "artist")}`;
  }
  if (input.artistName) {
    return `/artist/${encPath(input.artistName)}`;
  }
  return "/artists";
}

export function artistTopTracksPath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/artists/${input.artistId}/${safeSlug(input.artistSlug, "artist")}/top-tracks`;
  }
  if (input.artistName) {
    return `/artist/${encPath(input.artistName)}/top-tracks`;
  }
  return "/artists";
}

export function artistApiPath(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/api/artists/${input.artistId}`;
  }
  if (input.artistName) {
    return `/api/artist/${encPath(input.artistName)}`;
  }
  return "";
}

export function artistPhotoApiUrl(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/api/artists/${input.artistId}/photo`;
  }
  if (input.artistName) {
    return `/api/artist/${encPath(input.artistName)}/photo`;
  }
  return "";
}

export function artistBackgroundApiUrl(input: ArtistRouteInput) {
  if (input.artistId != null) {
    return `/api/artists/${input.artistId}/background`;
  }
  if (input.artistName) {
    return `/api/artist/${encPath(input.artistName)}/background`;
  }
  return "";
}

export function albumPagePath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/albums/${input.albumId}/${safeSlug(input.albumSlug, "album")}`;
  }
  if (input.artistName && input.albumName) {
    return `/album/${encPath(input.artistName)}/${encPath(input.albumName)}`;
  }
  return "/albums";
}

export function albumApiPath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}`;
  }
  if (input.artistName && input.albumName) {
    return `/api/album/${encPath(input.artistName)}/${encPath(input.albumName)}`;
  }
  return "";
}

export function albumRelatedApiPath(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}/related`;
  }
  if (input.artistName && input.albumName) {
    return `/api/album/${encPath(input.artistName)}/${encPath(input.albumName)}/related`;
  }
  return "";
}

export function albumCoverApiUrl(input: AlbumRouteInput) {
  if (input.albumId != null) {
    return `/api/albums/${input.albumId}/cover`;
  }
  if (input.artistName && input.albumName) {
    return `/api/cover/${encPath(input.artistName)}/${encPath(input.albumName)}`;
  }
  return "";
}
