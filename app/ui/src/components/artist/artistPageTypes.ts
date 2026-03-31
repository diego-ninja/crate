export interface ArtistData {
  name: string;
  albums: {
    name: string;
    display_name?: string;
    tracks: number;
    formats: string[];
    size_mb: number;
    year: string;
    has_cover: boolean;
  }[];
  genres?: string[];
  total_tracks?: number;
  total_size_mb?: number;
  primary_format?: string;
  issue_count?: number;
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

export interface ArtistSimilarArtist {
  name: string;
  image?: string;
  genres?: string[];
  popularity?: number;
}
