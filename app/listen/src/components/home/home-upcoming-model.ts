import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumPagePath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { HomeUpcomingItem } from "./home-model";

export function formatUpcomingDate(
  date: string | undefined,
  locale: string,
): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
  });
}

export function buildUpcomingPresentation(
  item: HomeUpcomingItem,
  locale: string,
) {
  const isShow = item.type === "show";
  const date = formatUpcomingDate(item.date, locale);
  const artistImage =
    resolveMaybeApiAssetUrl(item.cover_url) ||
    artistBackgroundApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 1200 },
    ) ||
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 800 },
    );
  const releasePath =
    !isShow && (item.album_id || item.release_id || item.album_slug)
      ? albumPagePath({
          albumId: item.album_id
            ? item.album_id
            : item.release_id
              ? -item.release_id
              : undefined,
          albumSlug: item.album_id ? item.album_slug : undefined,
          albumName: item.title,
          artistSlug: item.album_id ? item.artist_slug : undefined,
          artistName: item.artist,
        })
      : null;

  return {
    isShow,
    date,
    artistImage,
    releasePath,
    artistPath: artistPagePath({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    }),
  };
}
