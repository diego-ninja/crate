import type { GenreProfileItem } from "@/components/genres/GenrePill";

export interface ArtistData {
  id?: number;
  entity_uid?: string;
  slug?: string;
  name: string;
  updated_at?: string | null;
  albums: ArtistAlbumSummary[];
  genres?: string[];
  genre_profile?: GenreProfileItem[];
  manual_genres?: string[];
  total_tracks?: number;
  total_size_mb?: number;
  primary_format?: string;
  issue_count?: number;
  is_v2?: boolean;
  popularity?: number | null;
  popularity_score?: number | null;
  popularity_confidence?: number | null;
  bio?: string | null;
  tags_json?: string[];
  urls_json?: Record<string, string>;
  mbid?: string | null;
  country?: string | null;
  area?: string | null;
  formed?: string | null;
  ended?: string | null;
  artist_type?: string | null;
  bandcamp_url?: string | null;
}

export interface ArtistAlbumSummary {
  id?: number;
  entity_uid?: string;
  slug?: string;
  name: string;
  display_name?: string;
  tracks: number;
  formats: string[];
  bit_depth?: number | null;
  sample_rate?: number | null;
  size_mb: number;
  year: string;
  has_cover: boolean;
  popularity?: number | null;
  popularity_score?: number | null;
  popularity_confidence?: number | null;
}

export type TabKey =
  | "overview"
  | "top-tracks"
  | "discography"
  | "setlist"
  | "shows"
  | "similar"
  | "stats"
  | "artwork"
  | "about";

export interface ArtistExternalLink {
  label: string;
  url: string;
  color: string;
}

export interface MusicBrainzMember {
  name: string;
  type?: string;
  begin?: string;
  end?: string | null;
  attributes?: string[];
}

export interface MusicBrainzData {
  mbid?: string;
  type?: string;
  begin_date?: string;
  end_date?: string;
  country?: string;
  area?: string;
  members?: MusicBrainzMember[];
  urls?: Record<string, string>;
}

export interface LastfmData {
  listeners?: number;
  playcount?: number;
}

export interface SpotifyData {
  followers?: number;
  popularity?: number;
}

export interface ArtistSimilarArtist {
  id?: number;
  slug?: string;
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}
