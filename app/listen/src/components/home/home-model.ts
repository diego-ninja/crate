import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface SavedAlbum {
  id: number;
  artist: string;
  name: string;
  year?: string;
  has_cover?: boolean;
  track_count?: number;
  saved_at?: string;
}

export interface LibraryAddition {
  type: "album" | "playlist" | "system_playlist";
  added_at: string;
  album_id?: number;
  album_name?: string;
  album_artist?: string;
  album_year?: string;
  playlist_id?: number;
  playlist_name?: string;
  playlist_description?: string;
  playlist_tracks?: PlaylistArtworkTrack[];
  playlist_cover_data_url?: string | null;
  playlist_track_count?: number;
  playlist_follower_count?: number;
  playlist_badge?: string;
}

export interface UserPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  updated_at?: string;
  created_at?: string;
}

export interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  category?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_followed: boolean;
  is_smart: boolean;
  followed_at?: string;
  updated_at?: string;
}

export interface GlobalArtist {
  name: string;
  albums?: number;
  tracks?: number;
  album_count?: number;
  track_count?: number;
  has_photo: boolean;
}

export interface PaginatedArtistsResponse {
  items: GlobalArtist[];
  total: number;
  page: number;
  per_page: number;
}

export interface HomeUpcomingItem {
  id?: number;
  type: "release" | "show";
  date: string;
  artist: string;
  title: string;
  subtitle: string;
  is_upcoming: boolean;
  user_attending?: boolean;
}

export interface HomeUpcomingInsight {
  type: "one_month" | "one_week" | "show_prep";
  show_id: number;
  artist: string;
  date: string;
  title: string;
  subtitle: string;
  message: string;
  has_setlist?: boolean;
  weight?: "normal" | "high";
}

export interface HomeUpcomingResponse {
  items: HomeUpcomingItem[];
  insights: HomeUpcomingInsight[];
  summary: {
    followed_artists: number;
    show_count: number;
    release_count: number;
    attending_count: number;
    insight_count: number;
  };
}

export interface ReplayTrack {
  track_id: number | null;
  track_path: string | null;
  title: string;
  artist: string;
  album: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface ReplayMix {
  window: string;
  title: string;
  subtitle: string;
  track_count: number;
  minutes_listened: number;
  items: ReplayTrack[];
}

export interface PlaylistDetailTrack {
  id?: number;
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  navidrome_id?: string;
}

export interface PlaylistDetailData {
  id: number;
  name: string;
  cover_data_url?: string | null;
  tracks: PlaylistDetailTrack[];
}
