import type { HomeUpcomingItem } from "./home-types";

export type * from "./home-types";

export function homeUpcomingAlbumKey(artist: string, album: string): string {
  return `${artist.trim().toLocaleLowerCase()}::${album
    .trim()
    .toLocaleLowerCase()}`;
}

export function selectHomeRadarItems(
  items: HomeUpcomingItem[],
  upcomingAlbumKeys: ReadonlySet<string>,
  limit = 4,
): HomeUpcomingItem[] {
  const upcomingItems = [...items].filter((item) => item.is_upcoming);
  const deduplicatedItems = upcomingItems.filter(
    (item) =>
      item.type !== "release" ||
      !upcomingAlbumKeys.has(homeUpcomingAlbumKey(item.artist, item.title)),
  );
  const radarItems = deduplicatedItems.length
    ? deduplicatedItems
    : upcomingItems;

  return radarItems
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, Math.max(0, limit));
}
