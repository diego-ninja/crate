import { resolveMaybeApiAssetUrl } from "@/lib/api";

export interface UpcomingItem {
  id?: number;
  event_key?: string;
  type: "release" | "show";
  date: string;
  time?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  tidal_url?: string;
  release_id?: number;
  url?: string;
  venue?: string;
  address_line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  lineup?: string[];
  genres?: string[];
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}

export interface ArtistShowEvent {
  id: string;
  show_id?: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  date: string;
  local_time?: string;
  venue: string;
  address_line1?: string;
  city: string;
  region?: string;
  postal_code?: string;
  country: string;
  country_code: string;
  url?: string;
  image_url?: string;
  lineup?: string[];
  artist_genres?: string[];
  latitude?: number;
  longitude?: number;
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}

export function artistShowToUpcomingItem(show: ArtistShowEvent): UpcomingItem {
  return {
    id: show.show_id,
    event_key: show.id,
    type: "show",
    date: show.date,
    time: show.local_time,
    artist: show.artist_name,
    artist_id: show.artist_id,
    artist_slug: show.artist_slug,
    title: show.venue || "",
    subtitle: [show.city, show.country].filter(Boolean).join(", "),
    cover_url: resolveMaybeApiAssetUrl(show.image_url) || null,
    status: "onsale",
    url: show.url,
    venue: show.venue,
    address_line1: show.address_line1,
    city: show.city,
    region: show.region,
    postal_code: show.postal_code,
    country: show.country,
    country_code: show.country_code,
    latitude: show.latitude,
    longitude: show.longitude,
    lineup: show.lineup,
    genres: show.artist_genres || [],
    probable_setlist: show.probable_setlist || [],
    user_attending: show.user_attending,
    is_upcoming: true,
  };
}

export function itemKey(item: UpcomingItem, index: number): string {
  return item.event_key || `${item.type}-${item.artist}-${item.release_id ?? item.venue ?? index}-${item.date}-${item.time ?? ""}`;
}

export function groupByMonth(items: UpcomingItem[]): [string, UpcomingItem[]][] {
  const groups = new Map<string, UpcomingItem[]>();
  for (const item of items) {
    const month = (item.date || "").slice(0, 7) || "Unknown";
    const existing = groups.get(month) || [];
    existing.push(item);
    groups.set(month, existing);
  }
  return [...groups.entries()];
}

export function formatMonthLabel(month: string) {
  if (month === "Unknown") return "Unknown Date";
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
