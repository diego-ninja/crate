import { buildAlbumPlayerTracks } from "@/pages/album-model";
import type { AlbumData } from "@/pages/album-types";
import type { Track } from "@/contexts/player-types";
import { albumApiPath, albumPagePath } from "@/lib/library-routes";

export function buildAlbumRequestPath({
  routeAlbumId,
  routeAlbumSlug,
  routeArtistSlug,
  routeGlobalAlbumUid,
}: {
  routeAlbumId?: number;
  routeAlbumSlug?: string;
  routeArtistSlug?: string;
  routeGlobalAlbumUid: string | null;
}) {
  if (routeGlobalAlbumUid) {
    return `/api/catalog/albums/${encodeURIComponent(routeGlobalAlbumUid)}`;
  }
  if (routeAlbumId != null) {
    return albumApiPath({ albumId: routeAlbumId });
  }
  if (routeArtistSlug && routeAlbumSlug) {
    return albumApiPath({
      artistSlug: routeArtistSlug,
      albumSlug: routeAlbumSlug,
    });
  }
  return null;
}

export function buildAlbumDataState({
  data,
  routeGlobalAlbumUid,
}: {
  data: AlbumData | null;
  routeGlobalAlbumUid: string | null;
}) {
  const selectionTracks =
    data?.tracks.filter((track) => track.is_available !== false) ?? [];
  const displayName = data?.display_name || data?.name || "";
  const albumId = typeof data?.id === "number" ? data.id : 0;
  const globalAlbumUid = data?.global_album_uid ?? data?.global_uid ?? null;
  const globalArtistUid = data?.global_artist_uid ?? null;
  const artistName = data?.artist ?? "";
  const isPreRelease = Boolean(data?.is_pre_release);
  const albumHref = data
    ? albumPagePath({
        albumId: typeof data.id === "number" ? data.id : undefined,
        albumEntityUid: data.entity_uid,
        globalAlbumUid,
        albumSlug: data.slug,
        artistEntityUid: data.artist_entity_uid,
        artistSlug: data.artist_slug,
        artistName: data.artist,
        albumName: displayName,
      })
    : "";
  const albumRadioSeed =
    !isPreRelease && (albumId > 0 || globalAlbumUid)
      ? albumId > 0
        ? albumId
        : globalAlbumUid
      : null;
  const playerTracks: Track[] = data ? buildAlbumPlayerTracks(data) : [];
  const canonicalPath = data?.name
    ? routeGlobalAlbumUid
      ? albumPagePath({
          albumId: typeof data.id === "number" ? data.id : undefined,
          albumEntityUid: data.entity_uid,
          globalAlbumUid: routeGlobalAlbumUid,
          albumSlug: data.slug,
          artistEntityUid: data.artist_entity_uid,
          artistSlug: data.artist_slug,
          artistName: data.artist,
          albumName: data.name,
        })
      : albumPagePath({
          albumId: data.id,
          albumSlug: data.slug,
          artistSlug: data.artist_slug,
          artistName: data.artist,
          albumName: data.name,
        })
    : null;

  return {
    albumHref,
    albumId,
    albumRadioSeed,
    artistName,
    canonicalPath,
    displayName,
    globalAlbumUid,
    globalArtistUid,
    isPreRelease,
    playerTracks,
    selectionTracks,
  };
}
