import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface Playlist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  is_smart: boolean;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  total_duration: number;
  created_at: string;
}

export interface PlaylistTrack {
  id: number;
  track_id?: number;
  global_track_uid?: string;
  globalTrackUid?: string;
  track_entity_uid?: string;
  track_path?: string | null;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  position: number;
}

export interface PlaylistDetail extends Playlist {
  tracks: PlaylistTrack[];
}

export interface CuratedPlaylist {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_smart: boolean;
  category?: string | null;
}

export interface LibraryPlaylistsPageData {
  playlists: Playlist[];
  followed_curated_playlists: CuratedPlaylist[];
}
