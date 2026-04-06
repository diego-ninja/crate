export interface ArtistData {
  id?: number;
  slug?: string;
  name: string;
  albums: ArtistAlbumSummary[];
  genres?: string[];
  total_tracks?: number;
  total_size_mb?: number;
  primary_format?: string;
  issue_count?: number;
}

export interface ArtistAlbumSummary {
  id?: number;
  slug?: string;
  name: string;
  display_name?: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
}

export type TabKey =
  | "overview"
  | "top-tracks"
  | "discography"
  | "setlist"
  | "shows"
  | "similar"
  | "stats"
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
