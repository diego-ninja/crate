import type { TFunction } from "i18next";

import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import {
  canOpenUpcomingRelease,
  upcomingCountdown,
  type UpcomingItem,
} from "./upcoming-model";

export interface UpcomingEventRowModel {
  albumPath: string | null;
  artistPath: string;
  badgeLabel: string;
  countdown: ReturnType<typeof upcomingCountdown>;
  coverUrl: string | undefined;
  dateLabel: string;
}

export function buildUpcomingEventRowModel(
  item: UpcomingItem,
  language: string,
  t: TFunction,
): UpcomingEventRowModel {
  const dateObj = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString(language, {
        month: "short",
        day: "numeric",
      })
    : "";
  const coverUrl =
    resolveMaybeApiAssetUrl(item.cover_url) ||
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 800 },
    ) ||
    undefined;
  const useVirtualAlbumRoute =
    !item.album_id && item.release_id != null && item.release_id > 0;
  const virtualAlbumId = useVirtualAlbumRoute ? item.release_id : null;
  const albumPath =
    canOpenUpcomingRelease(item) &&
    (item.album_id || item.album_slug || item.release_id)
      ? albumPagePath({
          albumId:
            item.album_id ??
            (virtualAlbumId != null ? -virtualAlbumId : undefined),
          albumSlug: useVirtualAlbumRoute ? undefined : item.album_slug,
          albumName: item.title,
          artistSlug: useVirtualAlbumRoute ? undefined : item.artist_slug,
          artistName: item.artist,
        })
      : null;

  return {
    albumPath,
    artistPath: artistPagePath({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    }),
    badgeLabel: item.is_upcoming
      ? t("radar.release.preRelease")
      : t("radar.release.released"),
    countdown: upcomingCountdown(item.date, item.time),
    coverUrl,
    dateLabel,
  };
}
