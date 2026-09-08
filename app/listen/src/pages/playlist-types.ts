import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";

export interface PlaylistTrack {
  id: number;
  playlist_id: number;
  global_track_uid?: string;
  global_artist_uid?: string;
  global_album_uid?: string;
  track_id?: number;
  track_entity_uid?: string;
  track_path: string;
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
  added_at: string;
}

export interface PlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  visibility?: "public" | "private";
  is_collaborative?: boolean;
  user_id: number;
  is_smart: boolean;
  smart_rules?: unknown;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  artwork_tracks?: PlaylistArtworkTrack[];
  members?: PlaylistMember[];
  tracks: PlaylistTrack[];
}

export interface PlaylistMember {
  playlist_id: number;
  user_id: number;
  role: "owner" | "collab";
  invited_by?: number | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

export interface PlaylistInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

export interface PlaylistSavePayload {
  name: string;
  description: string;
  coverDataUrl: string | null;
  visibility: "public" | "private";
  isCollaborative: boolean;
  tracks: PlaylistComposerTrack[];
}
