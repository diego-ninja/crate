import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

export type EndpointType = "artist" | "genre" | "album" | "track";
export type StationSeedType = "artist" | "genre";
export type RadioMode = "seeded" | "discovery";

export interface PersonalizedRadioStation {
  type: StationSeedType;
  seed_type: StationSeedType;
  seed_value: string;
  seed_label: string;
  seed_subtitle?: string | null;
  title: string;
  subtitle?: string | null;
  play_count?: number;
  minutes_listened?: number;
  artist_id?: number | null;
  global_artist_uid?: string | null;
  artist_entity_uid?: string | null;
  artist_slug?: string | null;
  artist_name?: string | null;
  genre_slug?: string | null;
  genre_name?: string | null;
  cover_url?: string | null;
}

export interface PersonalizedRadioStationsResponse {
  artist_stations: PersonalizedRadioStation[];
  genre_stations: PersonalizedRadioStation[];
}

export interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
}

export interface RadioSearchResponse {
  artists?: {
    id: number;
    entity_uid?: string;
    name: string;
    slug?: string;
  }[];
  albums?: {
    id: number;
    entity_uid?: string;
    name: string;
    artist: string;
    artist_entity_uid?: string;
    slug?: string;
  }[];
}

export interface RadioGenre {
  slug: string;
  name: string;
}

export type RadioState = {
  discoveryAvailable: boolean;
  starting: boolean;
  activeSession: string | null;
  activeMode: RadioMode | null;
  seedLabel: string;
  query: string;
  results: SearchResult[];
  searching: boolean;
};

export type RadioAction =
  | { type: "set-discovery-available"; value: boolean }
  | { type: "start-request" }
  | { type: "start-failed" }
  | {
      type: "radio-started";
      sessionId: string;
      mode: RadioMode;
      seedLabel: string;
    }
  | { type: "set-query"; value: string }
  | { type: "search-started" }
  | { type: "search-cleared" }
  | { type: "search-succeeded"; value: SearchResult[] }
  | { type: "search-failed" }
  | { type: "search-finished" };

export const initialRadioState: RadioState = {
  discoveryAvailable: false,
  starting: false,
  activeSession: null,
  activeMode: null,
  seedLabel: "",
  query: "",
  results: [],
  searching: false,
};

export function radioReducer(
  state: RadioState,
  action: RadioAction,
): RadioState {
  switch (action.type) {
    case "set-discovery-available":
      return { ...state, discoveryAvailable: action.value };
    case "start-request":
      return { ...state, starting: true };
    case "start-failed":
      return { ...state, starting: false };
    case "radio-started":
      return {
        ...state,
        starting: false,
        activeSession: action.sessionId,
        activeMode: action.mode,
        seedLabel: action.seedLabel,
      };
    case "set-query":
      return { ...state, query: action.value };
    case "search-started":
      return { ...state, searching: true };
    case "search-cleared":
      return { ...state, results: [], searching: false };
    case "search-succeeded":
      return { ...state, results: action.value, searching: false };
    case "search-failed":
      return { ...state, results: [], searching: false };
    case "search-finished":
      return { ...state, searching: false };
  }
}

export function stationTypeLabelKey(station: PersonalizedRadioStation): string {
  return station.seed_type === "genre"
    ? "radio.stationType.genre"
    : "radio.stationType.artist";
}

export function stationLabel(station: PersonalizedRadioStation): string {
  return (
    station.seed_label ||
    station.genre_name ||
    station.artist_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

export function stationArtwork(
  station: PersonalizedRadioStation,
): string | null {
  if (station.type === "genre") {
    return resolveMaybeApiAssetUrl(station.cover_url) || null;
  }
  const explicitCover = resolveMaybeApiAssetUrl(station.cover_url);
  if (explicitCover) return explicitCover;
  return (
    artistPhotoApiUrl(
      {
        artistId: station.artist_id,
        globalArtistUid: station.global_artist_uid,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name || station.seed_label,
      },
      { size: 320 },
    ) || null
  );
}

export function buildSearchResults(
  searchData: RadioSearchResponse,
  genresData: RadioGenre[],
  query: string,
): SearchResult[] {
  const items: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const genre of genresData
    .filter((item) => item.name.toLowerCase().includes(queryLower))
    .slice(0, 3)) {
    items.push({ type: "genre", value: genre.slug, label: genre.name });
  }
  for (const artist of searchData.artists?.slice(0, 3) ?? []) {
    items.push({
      type: "artist",
      value: artist.entity_uid || String(artist.id),
      label: artist.name,
      imageUrl: artistPhotoApiUrl(
        {
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          artistSlug: artist.slug,
          artistName: artist.name,
        },
        { size: 128 },
      ),
    });
  }
  for (const album of searchData.albums?.slice(0, 3) ?? []) {
    items.push({
      type: "album",
      value: album.entity_uid || String(album.id ?? 0),
      label: `${album.name} — ${album.artist}`,
      imageUrl: albumCoverApiUrl(
        {
          albumId: album.id,
          albumEntityUid: album.entity_uid,
          artistEntityUid: album.artist_entity_uid,
          albumSlug: album.slug,
          albumName: album.name,
          artistName: album.artist,
        },
        { size: 128 },
      ),
    });
  }
  return items;
}

export function stationSeedValue(station: PersonalizedRadioStation): string {
  return (
    station.seed_value ||
    station.genre_slug ||
    (station.artist_id != null ? String(station.artist_id) : "")
  );
}
