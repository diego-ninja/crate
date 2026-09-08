import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { HomeRecentItem } from "./home-model";

export function recentArtwork(item: HomeRecentItem): string | null {
  if (item.type === "playlist") return null;
  if (item.type === "artist") {
    return (
      artistPhotoApiUrl(
        {
          artistId: item.artist_id,
          artistEntityUid: item.artist_entity_uid,
          globalArtistUid: item.global_artist_uid,
          artistSlug: item.artist_slug,
          artistName: item.artist_name,
        },
        { size: 192 },
      ) || null
    );
  }
  return (
    albumCoverApiUrl(
      {
        albumId: item.album_id,
        albumEntityUid: item.album_entity_uid,
        globalAlbumUid: item.global_album_uid,
        artistEntityUid: item.artist_entity_uid,
        albumSlug: item.album_slug,
        artistName: item.artist_name,
        albumName: item.album_name,
      },
      { size: 192 },
    ) || null
  );
}

export function recentTitle(item: HomeRecentItem): string {
  if (item.type === "playlist") return item.playlist_name;
  if (item.type === "artist") return item.artist_name;
  return item.album_name;
}

export function recentSubtitle(item: HomeRecentItem): string | undefined {
  if (item.type === "playlist") {
    return item.playlist_description || item.subtitle;
  }
  if (item.type === "artist") return item.subtitle;
  return item.artist_name;
}

export function openRecentItemPath(item: HomeRecentItem): string {
  if (item.type === "playlist") {
    return item.playlist_scope === "system"
      ? `/curation/playlist/${item.playlist_id}`
      : `/playlist/${item.playlist_id}`;
  }
  if (item.type === "artist") {
    return artistPagePath({
      artistId: item.artist_id,
      artistEntityUid: item.artist_entity_uid,
      globalArtistUid: item.global_artist_uid,
      artistSlug: item.artist_slug,
      artistName: item.artist_name,
    });
  }
  return albumPagePath({
    albumId: item.album_id,
    albumEntityUid: item.album_entity_uid,
    globalAlbumUid: item.global_album_uid,
    artistEntityUid: item.artist_entity_uid,
    albumSlug: item.album_slug,
    artistName: item.artist_name,
    albumName: item.album_name,
  });
}

export function recentPlaylistArtwork(
  item: Extract<HomeRecentItem, { type: "playlist" }>,
) {
  return resolveMaybeApiAssetUrl(item.playlist_cover_data_url);
}
