import type {
  UpcomingItem,
  UpcomingResponse,
  GenreShowsResponse,
} from "@/pages/shows-page-types";
import { itemKey } from "@/components/upcoming/UpcomingRows";

export type ShowsFilter = "all" | "shows" | "releases";

export interface ShowsPageModel {
  attendingShows: UpcomingItem[];
  comingUp: UpcomingItem[];
  featuredShow: UpcomingItem | null;
  filtered: UpcomingItem[];
  hasFollowedArtists: boolean;
  isGenreRadar: boolean;
  items: UpcomingItem[];
  loading: boolean;
  recentlyReleased: UpcomingItem[];
  summary: UpcomingResponse["summary"] | undefined;
}

export interface ShowsPageModelInput {
  data: UpcomingResponse | null | undefined;
  filter: ShowsFilter;
  focusShowId: string | null;
  genreData: GenreShowsResponse | null | undefined;
  genreLoading: boolean;
  genreSlug: string | null;
  search: string;
  today: string;
  upcomingLoading: boolean;
}

export function buildShowsPageModel({
  data,
  filter,
  focusShowId,
  genreData,
  genreLoading,
  genreSlug,
  search,
  today,
  upcomingLoading,
}: ShowsPageModelInput): ShowsPageModel {
  const isGenreRadar = Boolean(genreSlug);
  const items = isGenreRadar ? genreData?.shows ?? [] : data?.items ?? [];
  const loading = isGenreRadar ? genreLoading : upcomingLoading;
  const summary = isGenreRadar
    ? {
        followed_artists: 0,
        show_count: items.length,
        release_count: 0,
        attending_count: 0,
        insight_count: 0,
      }
    : data?.summary;
  const filtered = filterShows(items, filter, search);
  const attendingShows = items.filter(
    (item) => item.type === "show" && item.user_attending,
  );
  const nextAttendingShow = attendingShows
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const focusedGenreShow = isGenreRadar
    ? items.find(
        (item) => item.type === "show" && String(item.id) === focusShowId,
      ) || items.find((item) => item.type === "show")
    : null;
  const featuredCandidate = focusedGenreShow || nextAttendingShow || null;
  const featuredShow =
    featuredCandidate &&
    filter !== "releases" &&
    filtered.some((item) => isSameUpcomingItem(item, featuredCandidate))
      ? featuredCandidate
      : null;
  const comingUp = filtered.filter(
    (item) =>
      (item.is_upcoming || item.date >= today) &&
      (!featuredShow || !isSameUpcomingItem(item, featuredShow)),
  );
  const recentlyReleased = filtered
    .filter(
      (item) =>
        item.type === "release" && !item.is_upcoming && item.date < today,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    attendingShows,
    comingUp,
    featuredShow,
    filtered,
    hasFollowedArtists: isGenreRadar || (summary?.followed_artists ?? 0) > 0,
    isGenreRadar,
    items,
    loading,
    recentlyReleased,
    summary,
  };
}

function filterShows(
  items: UpcomingItem[],
  filter: ShowsFilter,
  search: string,
): UpcomingItem[] {
  let next = items;
  if (search.trim()) {
    const query = search.trim().toLowerCase();
    next = next.filter(
      (item) =>
        item.artist.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query),
    );
  }
  if (filter === "shows") return next.filter((item) => item.type === "show");
  if (filter === "releases") {
    return next.filter((item) => item.type === "release");
  }
  return next;
}

export function isSameUpcomingItem(
  left: UpcomingItem,
  right: UpcomingItem,
): boolean {
  if (left.event_key && right.event_key) {
    return left.event_key === right.event_key;
  }
  if (left.id != null && right.id != null && left.type === right.type) {
    return left.id === right.id;
  }
  return itemKey(left, 0) === itemKey(right, 0);
}
