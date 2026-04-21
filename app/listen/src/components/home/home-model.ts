import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface SavedAlbum {
  id: number;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
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
  album_slug?: string;
  album_name?: string;
  album_artist?: string;
  album_artist_id?: number;
  album_artist_slug?: string;
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
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_followed: boolean;
  is_smart: boolean;
  followed_at?: string;
  updated_at?: string;
}

export interface GlobalArtist {
  id?: number;
  slug?: string;
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
  artist_id?: number;
  artist_slug?: string;
  title: string;
  subtitle: string;
  is_upcoming: boolean;
  user_attending?: boolean;
}

export interface HomeUpcomingInsight {
  type: "one_month" | "one_week" | "show_prep";
  show_id: number;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
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
  track_storage_id?: string | null;
  track_path: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album: string;
  album_id?: number | null;
  album_slug?: string | null;
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
  track_storage_id?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
}

export interface PlaylistDetailData {
  id: number;
  name: string;
  cover_data_url?: string | null;
  tracks: PlaylistDetailTrack[];
}

export interface HomeHeroArtist {
  id: number;
  slug?: string;
  name: string;
  listeners: number;
  scrobbles: number;
  album_count: number;
  track_count: number;
  bio: string;
}

export interface HomeRecentPlaylistItem {
  type: "playlist";
  playlist_id: number;
  playlist_name: string;
  playlist_description?: string;
  playlist_scope?: "user" | "system";
  playlist_cover_data_url?: string | null;
  playlist_tracks?: PlaylistArtworkTrack[];
  subtitle?: string;
  played_at?: string;
}

export interface HomeRecentArtistItem {
  type: "artist";
  artist_id?: number;
  artist_slug?: string;
  artist_name: string;
  subtitle?: string;
  played_at?: string;
}

export interface HomeRecentAlbumItem {
  type: "album";
  album_id?: number;
  album_slug?: string;
  album_name: string;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  subtitle?: string;
  played_at?: string;
}

export type HomeRecentItem =
  | HomeRecentPlaylistItem
  | HomeRecentArtistItem
  | HomeRecentAlbumItem;

export interface HomeGeneratedPlaylistSummary {
  id: string;
  name: string;
  description: string;
  artwork_tracks: PlaylistArtworkTrack[];
  artwork_artists: HomeArtworkArtist[];
  track_count: number;
  badge: string;
  kind: "mix" | "core";
}

export interface HomeArtworkArtist {
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
}

export interface HomeSuggestedAlbum {
  album_id?: number;
  album_slug?: string;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_name: string;
  year?: string;
  release_date?: string;
  release_type?: string;
}

export interface HomeRecommendedTrack {
  track_id?: number | null;
  track_storage_id?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  duration?: number | null;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
}

export interface HomeRadioStation {
  type: "artist" | "album";
  title: string;
  subtitle: string;
  play_count: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_name?: string;
  album_id?: number;
  album_slug?: string;
}

export interface HomeFavoriteArtist {
  artist_id?: number;
  artist_slug?: string;
  artist_name: string;
  play_count: number;
  minutes_listened: number;
}

export interface HomeDiscoveryPayload {
  hero: HomeHeroArtist | null;
  recently_played: HomeRecentItem[];
  custom_mixes: HomeGeneratedPlaylistSummary[];
  suggested_albums: HomeSuggestedAlbum[];
  recommended_tracks: HomeRecommendedTrack[];
  radio_stations: HomeRadioStation[];
  favorite_artists: HomeFavoriteArtist[];
  essentials: HomeGeneratedPlaylistSummary[];
}

export interface HomeGeneratedPlaylistDetail {
  id: string;
  name: string;
  description: string;
  artwork_tracks: PlaylistArtworkTrack[];
  artwork_artists: HomeArtworkArtist[];
  track_count: number;
  total_duration: number;
  badge: string;
  kind: "mix" | "core";
  tracks: HomeRecommendedTrack[];
}

export type HomeSectionId =
  | "recently-played"
  | "custom-mixes"
  | "suggested-albums"
  | "recommended-tracks"
  | "radio-stations"
  | "favorite-artists"
  | "core-tracks";

interface HomeSectionBase<TId extends HomeSectionId, TItems> {
  id: TId;
  title: string;
  subtitle: string;
  items: TItems[];
}

export type HomeSectionDetailPayload =
  | HomeSectionBase<"recently-played", HomeRecentItem>
  | HomeSectionBase<"custom-mixes", HomeGeneratedPlaylistSummary>
  | HomeSectionBase<"suggested-albums", HomeSuggestedAlbum>
  | HomeSectionBase<"recommended-tracks", HomeRecommendedTrack>
  | HomeSectionBase<"radio-stations", HomeRadioStation>
  | HomeSectionBase<"favorite-artists", HomeFavoriteArtist>
  | HomeSectionBase<"core-tracks", HomeGeneratedPlaylistSummary>;
